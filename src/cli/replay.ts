import "../env.ts";
/**
 * Replay the real schedule through the agent: every game goes final in order, the agent decides,
 * PayPal pays, and the gap from buzzer to payout is recorded for each one.
 *
 *   node src/cli/replay.ts                        # all 88 games, live sandbox payouts
 *   node src/cli/replay.ts --day 2026-05-16        # Saturday only
 *   node src/cli/replay.ts --paypal off            # ablation: PayPal removed
 *   node src/cli/replay.ts --scripted              # ablation: fixed rule instead of the model
 *   node src/cli/replay.ts --limit 5 --paypal dry  # a quick look, nothing sent
 *
 * Results: results/buzzer-replay.json (live), results/ablation-no-paypal.json, results/ablation-scripted.json.
 * Progress is written after every game, so a stopped run can resume with --from <game number>.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadFromFile } from "../app/feed.ts";
import { loadSheet, loadRateCard } from "../agent/sheet.ts";
import { loadLedger, saveLedger } from "../ledger.ts";
import { runBuzzer, type BuzzerResult, type PayPalMode } from "../agent/buzzer.ts";
import { summarise, median, percentile } from "./report.ts";

const args = parse(process.argv.slice(2));
const paypal = ((args.paypal as string) ?? "live") as PayPalMode;
const scripted = Boolean(args.scripted);
const day = (args.day as string) ?? "all";
const limit = Number(args.limit ?? 0);
const from = Number(args.from ?? 0);
const runId = (args["run-id"] as string) ?? process.env.RUN_ID ?? stamp();
const mode = scripted ? "scripted" : paypal === "off" ? "no-paypal" : paypal === "dry" ? "dry" : "live";
const outPath = (args.out as string) ?? (mode === "live" ? "results/buzzer-replay.json" : `results/ablation-${mode}.json`);
const ledgerPath = (args.ledger as string) ?? (mode === "live" ? "results/ledger.json" : `results/ledger-${mode}.json`);

const t = await loadFromFile((args.file as string) ?? "data/tournament-2026.json");
const sheet = await loadSheet(); const card = await loadRateCard();
const ledger = await loadLedger(ledgerPath, t.slug);
let games = t.games.filter((g) => day === "all" || g.start.startsWith(day));
if (from) games = games.filter((g) => g.number >= from);
if (limit) games = games.slice(0, limit);

const prior: BuzzerResult[] = from ? await readFile(outPath, "utf8").then((s) => JSON.parse(s).per_game ?? [], () => []) : [];
const results: BuzzerResult[] = [...prior];
const started = new Date().toISOString();
await mkdir("results/trace", { recursive: true });
console.log(`replay ${mode}: ${games.length} games, run ${runId}, model ${scripted ? "scripted" : process.env.AGENT_MODEL ?? "claude-opus-5-5"}`);

for (const g of games) {
  const previousStatus = g.status;
  if (g.id === sheet.staged.forfeit.gameId) { g.status = "forfeit"; g.hs = 20; g.as = 0; g.note = "forfeit (staged for the replay)"; }
  else { g.status = "final"; g.hs = 40 + (g.number % 23); g.as = 30 + (g.number % 19); }
  const finalAt = new Date();
  const r = await runBuzzer({ tournament: t, game: g, sheet, card, ledger, finalAt, runId, paypal, previousStatus, scripted });
  results.push(r);
  await saveLedger(ledgerPath, ledger);
  await writeFile(`results/trace/${mode}-g${g.number}.json`, JSON.stringify(r, null, 2) + "\n");
  console.log(`${String(g.number).padStart(2)}  ${r.outcome.padEnd(7)}  ${summarise(r)}`);
  await write(false);
}
await write(true);

async function write(finished: boolean) {
  const paid = results.filter((r) => r.outcome === "paid");
  const secs = paid.map((r) => r.payout!.secondsFromBuzzer!).filter((x) => x !== null && x !== undefined);
  const dollars = paid.reduce((s, r) => s + r.payout!.items.reduce((a, i) => a + Number(i.amount), 0), 0);
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const usage = results.reduce((a, r) => ({ calls: a.calls + r.loop.calls, input_tokens: a.input_tokens + r.loop.input_tokens, output_tokens: a.output_tokens + r.loop.output_tokens }), { calls: 0, input_tokens: 0, output_tokens: 0 });
  const summary = {
    run_id: runId, mode, finished, started, updated: new Date().toISOString(),
    model: scripted ? "scripted" : (results.find((r) => r.loop.model !== "scripted")?.loop.model ?? null),
    paypal: paypal === "live" ? "sandbox" : paypal,
    tournament: { slug: t.slug, name: t.name, version: t.version },
    games_run: results.length,
    outcomes: counts,
    payouts: { games_paid: paid.length, officials_paid: paid.reduce((s, r) => s + r.payout!.items.length, 0), dollars: Math.round(dollars * 100) / 100, currency: process.env.PAYOUT_CURRENCY || card.currency },
    seconds_from_buzzer: { n: secs.length, median: median(secs), p90: percentile(secs, 90), min: secs.length ? Math.min(...secs) : null, max: secs.length ? Math.max(...secs) : null, how: "PayPal's batch time_completed (or the last item's time_processed) minus the moment the score was saved" },
    holds: results.filter((r) => r.outcome === "held" || r.outcome === "blocked").map((r) => ({ number: r.game.number, by: r.blockedBy ?? "agent", reason: r.hold?.reason, question: r.hold?.question })),
    folds: Object.values(ledger.folds).reduce((s, f) => s + f.length, 0),
    guard_blocks: results.filter((r) => r.blockedBy === "guard").map((r) => ({ number: r.game.number, reason: r.guard?.reason ?? r.hold?.reason })),
    errors: results.filter((r) => r.outcome === "error").map((r) => ({ number: r.game.number, message: typeof r.error === "string" ? r.error : r.error?.message })),
    model_usage: usage,
    staged: sheet.staged,
    rate_card: { provisional: card.provisional, source: card.source, per_game: card.per_game },
    note: "Scores are replay values. Every payout is sandbox test money. Officials are labelled A to X with sandbox addresses.",
    per_game: results,
  };
  await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n");
  if (finished) {
    console.log(`\n${mode}: ${paid.length} of ${results.length} games paid, $${summary.payouts.dollars} ${summary.payouts.currency}, median ${summary.seconds_from_buzzer.median ?? "?"} s from buzzer to payout, ${summary.holds.length} held, ${summary.folds} fold(s), ${summary.errors.length} error(s)`);
    console.log(`written ${outPath}`);
  }
}

function parse(argv: string[]): Record<string, string | boolean> {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith("--")) continue;
    const k = a.slice(2), v = argv[i + 1];
    if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true;
  }
  return o;
}
function stamp(): string { return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-"); }
