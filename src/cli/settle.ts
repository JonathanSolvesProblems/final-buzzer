/**
 * The end-of-day batch: every official who asked to be paid once a day gets one PayPal payout
 * for the games the agent folded. One batch per official per day, so a second run cannot pay twice.
 *
 *   node --env-file=.env src/cli/settle.ts --day 2026-05-16 --run-id <same run id as the replay>
 *   node --env-file=.env src/cli/settle.ts --day 2026-05-16 --paypal dry
 */
import { mkdir, writeFile } from "node:fs/promises";
import { loadFromFile } from "../app/feed.ts";
import { loadSheet, loadRateCard, money } from "../agent/sheet.ts";
import { loadLedger, saveLedger, event } from "../ledger.ts";
import { emailFor } from "../agent/buzzer.ts";
import { LIMITS } from "../agent/guards.ts";
import { createPayout, waitForPayout, isPayoutError } from "../paypal/payouts.ts";

const args = parse(process.argv.slice(2));
const day = String(args.day ?? "2026-05-16");
const paypal = String(args.paypal ?? "live");
const runId = String(args["run-id"] ?? process.env.RUN_ID ?? "");
if (!runId) throw new Error("--run-id must match the replay that folded the games");
const ledgerPath = String(args.ledger ?? (paypal === "live" ? "results/ledger.json" : `results/ledger-${paypal}.json`));

const t = await loadFromFile(String(args.file ?? "data/tournament-2026.json"));
const sheet = await loadSheet(); const card = await loadRateCard();
const ledger = await loadLedger(ledgerPath, t.slug);
const byId = new Map(sheet.officials.map((o) => [o.id, o]));
const currency = process.env.PAYOUT_CURRENCY || card.currency;
const out: unknown[] = [];

for (const [officialId, folds] of Object.entries(ledger.folds)) {
  const today = folds.filter((f) => t.games.find((g) => g.id === f.gameId)?.start.startsWith(day));
  if (!today.length) continue;
  const official = byId.get(officialId)!;
  const sbid = `${t.slug}-${runId}-${day}-${officialId}`;
  if (ledger.payouts[sbid]) { console.log(`${official.label}: already settled (${ledger.payouts[sbid].status})`); continue; }
  // the guard: every folded amount came from the card when it was folded; re-check it now
  for (const f of today) {
    const want = f.role === "referee" ? card.per_game.referee : card.per_game.table;
    if (money(Number(f.amount)) !== money(want)) throw new Error(`${official.label} game ${f.number}: folded ${f.amount}, card says ${money(want)}`);
  }
  const total = today.reduce((s, f) => s + Number(f.amount), 0);
  const items = today.map((f) => ({
    receiver: emailFor(official), amount: f.amount, currency,
    note: `Game ${f.number}, ${f.role === "referee" ? "referee" : "table official"}. Northside Youth Basketball, end-of-day pay for ${day}.`,
    senderItemId: `${sbid}-g${f.number}`,
  }));
  const record = { gameId: "", number: 0, senderBatchId: sbid, batchId: null as string | null, status: "NOT_SENT", items: today.map((f) => ({ official_id: officialId, role: f.role, amount: f.amount, receiver: emailFor(official), game: f.number })), finalAt: "", createdAt: new Date().toISOString(), decidedBy: "agent" as const, provisional: card.provisional, officialId, day, total: money(total) };
  if (total > LIMITS.perItem * today.length) throw new Error("over cap");
  console.log(`${official.label}: ${today.length} game(s) folded, $${money(total)} ${currency}`);
  if (paypal !== "live") { record.status = "DRY_RUN"; ledger.payouts[sbid] = record as any; out.push(record); continue; }
  const created = await createPayout(sbid, items, "Northside Youth Basketball: end-of-day officials' pay", `Thank you for officiating on ${day}.`);
  if (isPayoutError(created)) { record.status = `ERROR_${created.errorCategory.toUpperCase()}`; ledger.payouts[sbid] = record as any; event(ledger, "settle_error", { detail: created.message }); console.log(`  ${created.message}`); out.push({ ...record, error: created }); continue; }
  record.batchId = created.batchId; record.status = created.status; ledger.payouts[sbid] = record as any;
  const final = await waitForPayout(created.batchId, { timeoutMs: 90_000 });
  if (!isPayoutError(final)) { record.status = final.status; (record as any).completedAt = final.timeCompleted ?? null; ledger.payouts[sbid] = record as any; }
  event(ledger, "settled", { detail: { officialId, batch: created.batchId, status: record.status } });
  console.log(`  batch ${created.batchId} ${record.status}`);
  out.push(record);
}
await saveLedger(ledgerPath, ledger);
await mkdir("results", { recursive: true });
await writeFile(`results/settle-${day}${paypal === "live" ? "" : "-" + paypal}.json`, JSON.stringify({ day, runId, paypal, settled: out }, null, 2) + "\n");
console.log(`${out.length} official(s) settled for ${day}`);

function parse(argv: string[]): Record<string, string | boolean> {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith("--")) continue; const k = a.slice(2), v = argv[i + 1]; if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true; }
  return o;
}
