/**
 * A gym closes: re-plan the rest of its day and settle the money for what cannot be played.
 *
 *   node --env-file=.env src/cli/replan.ts --court "Gym D" --from 14:00 --day 2026-05-16
 *   node --env-file=.env src/cli/replan.ts --court "Gym D" --from 14:00 --paypal dry
 *
 * Writes results/replan.json: the agent's plan, every move re-checked by the schedule's rules,
 * the games that cannot be played with each team's pro-rata refund, and what PayPal did with it.
 * A refund goes back through the team's PayPal invoice when it was paid on PayPal (create_refund
 * through the MCP server) and as a payout to the manager when it was paid by e-transfer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadFromFile } from "../app/feed.ts";
import { loadSheet } from "../agent/sheet.ts";
import { runReplan, refundFor } from "../agent/replan.ts";
import { createPayout, waitForPayout, isPayoutError } from "../paypal/payouts.ts";
import { getInvoiceRest } from "../paypal/invoicing.ts";
import { connectPayPalMcp } from "../paypal/mcp.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []).filter((x) => x.length));
const closure = { day: String(args.day ?? "2026-05-16"), court: String(args.court ?? "Gym D"), from: String(args.from ?? "14:00") };
const paypal = String(args.paypal ?? "live");
const runId = String(args["run-id"] ?? process.env.RUN_ID ?? "replan");

const t = await loadFromFile(String(args.file ?? "data/tournament-2026.json"));
const doc = JSON.parse(await readFile(String(args.file ?? "data/tournament-2026.json"), "utf8"));
const courts = doc.courts.map((c: any) => ({ id: c.id, name: /^\d+$/.test(c.name) ? `Lakeside ${c.name}` : c.name, venue: c.venue ?? "" }));
const sheet = await loadSheet();
const fees = JSON.parse(await readFile("data/fees.json", "utf8"));
const teams = JSON.parse(await readFile("data/teams-2026.json", "utf8"));
const invoices = await readFile("results/invoices.json", "utf8").then((s) => JSON.parse(s).records, () => ({}));

console.log(`${closure.court} closes at ${closure.from} on ${closure.day}`);
const r = await runReplan({ tournament: t, sheet, courts, closure, onStep: (s) => { if (s.kind === "tool") console.log(`  ${String(s.ms).padStart(6)} ms  ${s.name}${s.name === "check_move" ? " " + JSON.stringify(s.input) + " -> " + ((s.output as any).ok ? "ok" : (s.output as any).problems?.[0] ?? "no") : ""}`); } });
for (const m of r.applied) console.log(`moved game ${m.game_number}: ${m.from.court} ${m.from.start} -> ${m.to.court} ${m.to.start}${m.reassigned.length ? " (officials " + m.reassigned.join(", ") + ")" : ""}`);
for (const x of r.rejected) console.log(`rejected move for game ${x.game_number} to ${x.wanted.court} ${x.wanted.start}: ${x.problems.join("; ")}`);

// the money: pro rata per team for each game that cannot be played
const refunds: any[] = [];
let mcp: Awaited<ReturnType<typeof connectPayPalMcp>> | null = null;
try {
  for (const u of r.unplayable) {
    const g = t.games.find((x) => x.number === u.game_number)!;
    console.log(`cannot be played: game ${u.game_number}, ${u.teams.join(" v ")}: ${u.reason}`);
    for (const team of u.teams) {
      const rule = refundFor(t, team, g.division, fees.entry_fee_per_team);
      const rec = Object.values(invoices as Record<string, any>).find((x) => x.team === team && x.division === g.division);
      const manager = teams.teams.find((x: any) => x.name === team && x.division === g.division);
      const entry: any = { game_number: u.game_number, team, division: g.division, rule: `${fees.currency} ${fees.entry_fee_per_team} / ${rule.gamesScheduled} games`, amount: rule.perGame.toFixed(2), currency: fees.currency, provisional_fee: fees.provisional, via: null, status: "NOT_SENT" };
      if (paypal !== "live") { entry.status = "DRY_RUN"; refunds.push(entry); continue; }
      // paid on PayPal (a capture on the invoice) -> refund through the invoice; paid by e-transfer -> payout to the manager
      let captureId: string | null = null;
      if (rec?.invoice_id) { const v = await getInvoiceRest(rec.invoice_id); if (!("isError" in v) && v.paid) captureId = (v as any).raw?.payments?.transactions?.[0]?.payment_id ?? null; }
      if (captureId) {
        mcp ??= await connectPayPalMcp(["payments.createRefund"]);
        const res: any = await mcp.call("create_refund", { capture_id: captureId, amount: { currency_code: fees.currency, value: rule.perGame.toFixed(2) }, note_to_payer: `Game ${u.game_number} could not be played (${closure.court} closed). Pro-rata refund by the association's rule.` });
        entry.via = "create_refund"; entry.status = res?.isError ? `ERROR: ${res.message}` : (res.status ?? "SENT"); entry.ref = res?.id ?? null;
      } else {
        const sbid = `${t.slug}-${runId}-refund-g${u.game_number}-${(manager?.id ?? team).toString().slice(0, 40)}`;
        const created = await createPayout(sbid, [{ receiver: manager?.manager_email ?? `team@example.com`, amount: rule.perGame.toFixed(2), currency: fees.currency, note: `Game ${u.game_number} could not be played (${closure.court} closed at ${closure.from}). Pro-rata refund: ${entry.rule}.`, senderItemId: sbid }], "Northside Youth Basketball: game refund", "A game could not be played; here is the pro-rata refund.");
        if (isPayoutError(created)) { entry.via = "payout"; entry.status = `ERROR: ${created.message}`; }
        else { const fin = await waitForPayout(created.batchId, { timeoutMs: 60_000 }); entry.via = "payout"; entry.ref = created.batchId; entry.status = "isError" in fin ? created.status : fin.status; }
      }
      refunds.push(entry);
      console.log(`  refund ${team}: $${entry.amount} via ${entry.via}: ${entry.status}`);
    }
  }
} finally { await mcp?.close(); }

await mkdir("results", { recursive: true });
const out = { at: new Date().toISOString(), paypal: paypal === "live" ? "sandbox" : paypal, closure, affected: r.affected, summary: r.decision?.summary ?? null, applied: r.applied, rejected: r.rejected, unplayable: r.unplayable, refunds, fee_rule: fees.refund_policy, loop: r.loop, trace: r.trace, schedule_after: r.applied.map((m) => { const g = t.games.find((x) => x.number === m.game_number)!; return { id: g.id, number: g.number, court: g.court, start: g.start, note: g.note }; }) };
await writeFile("results/replan.json", JSON.stringify(out, null, 2) + "\n");
console.log(`\n${r.applied.length} moved, ${r.unplayable.length} cannot be played, ${refunds.length} refund(s) (${paypal}). ${r.decision?.summary ?? ""}\nwritten results/replan.json`);
