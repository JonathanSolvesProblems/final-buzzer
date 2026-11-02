import "../env.ts";
/**
 * A gym closes: re-plan the rest of its day and settle the money for what cannot be played.
 *
 *   node src/cli/replan.ts --court "Gym D" --from 14:00 --day 2026-05-16
 *   node src/cli/replan.ts --court "Gym D" --from 14:00 --paypal dry
 *   node src/cli/replan.ts --court "Gym D" --from 14:00 --apply      # also write the moves into the document
 *
 * Writes results/replan.json: the agent's plan, every move re-checked by the schedule's rules,
 * the games that cannot be played with each team's pro-rata refund, and what PayPal did with it.
 */
import { runClosure } from "../agent/closure.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []).filter((x) => x.length));
const closure = { day: String(args.day ?? "2026-05-16"), court: String(args.court ?? "Gym D"), from: String(args.from ?? "14:00") };
const paypal = (String(args.paypal ?? (process.env.PAYPAL_CLIENT_ID ? "live" : "dry"))) as "live" | "dry";

console.log(`${closure.court} closes at ${closure.from} on ${closure.day} (paypal ${paypal}${args.apply ? ", writing the moves into the document" : ""})`);
const r = await runClosure({ closure, paypal, runId: String(args["run-id"] ?? process.env.RUN_ID ?? "replan"), apply: Boolean(args.apply),
  onStep: (s) => { if (s.kind === "tool") console.log(`  ${String(s.ms).padStart(6)} ms  ${s.name}${s.name === "check_move" ? " " + JSON.stringify(s.input) + " -> " + ((s.output as any).ok ? "ok" : (s.output as any).problems?.[0] ?? "no") : ""}`); } });
for (const m of r.applied) console.log(`moved game ${m.game_number}: ${m.from.court} ${m.from.start} -> ${m.to.court} ${m.to.start}${m.reassigned.length ? " (officials " + m.reassigned.join(", ") + ")" : ""}`);
for (const x of r.rejected) console.log(`rejected move for game ${x.game_number} to ${x.wanted.court} ${x.wanted.start}: ${x.problems.join("; ")}`);
for (const u of r.unplayable) console.log(`cannot be played: game ${u.game_number}, ${u.teams.join(" v ")}: ${u.reason}`);
for (const f of r.refunds) console.log(`  refund ${f.team}: $${f.amount} ${f.currency} via ${f.via ?? "nothing sent"}: ${f.status}`);
console.log(`\n${r.applied.length} moved, ${r.unplayable.length} cannot be played, ${r.refunds.length} refund(s). ${r.summary ?? ""}\nwritten results/replan.json`);
