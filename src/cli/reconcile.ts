import "../env.ts";
/**
 * Read the money back from PayPal, not from our ledger: Transaction Search through the PayPal MCP
 * server (list_transactions), matched against the ledger's payout batches. The second headline
 * figure (dollars moved, games covered) comes from here.
 *
 *   node src/cli/reconcile.ts                # the last 31 days
 *   node src/cli/reconcile.ts --since 2026-11-01T00:00:00Z
 *
 * Writes results/reconcile.json. PayPal's transaction search can lag the payout by up to a few
 * hours in the sandbox; a batch the ledger holds that PayPal has not listed yet is reported as
 * "not yet in transaction search", never as missing money.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { connectPayPalMcp } from "../paypal/mcp.ts";
import { loadLedger } from "../ledger.ts";
import { getPayout, isPayoutError } from "../paypal/payouts.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []).filter((x) => x.length));
const ledgerPath = String(args.ledger ?? "results/ledger.json");
const ledger = await loadLedger(ledgerPath, "northside-2026");
const end = new Date();
const start = args.since ? new Date(String(args.since)) : new Date(end.getTime() - 30 * 86_400_000);

const mcp = await connectPayPalMcp(["transactions.list"]);
const rows: any[] = [];
try {
  for (let page = 1; page <= 10; page++) {
    const res: any = await mcp.call("list_transactions", { start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"), end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z"), page, page_size: 500, transaction_status: "S" });
    if (res?.isError) { console.error(res.message); break; }
    const details = res.transaction_details ?? res.transactions ?? [];
    rows.push(...details);
    if (!res.total_pages || page >= res.total_pages) break;
  }
} finally { await mcp.close(); }

// payouts show as transactions with the payout item id as the transaction id; match through each batch's items
const byTxn = new Map<string, any>();
for (const r of rows) { const id = r.transaction_info?.transaction_id; if (id) byTxn.set(id, r); }
const matched: any[] = []; const pending: any[] = [];
for (const p of Object.values(ledger.payouts)) {
  if (!p.batchId) continue;
  const live = await getPayout(p.batchId);
  if (isPayoutError(live)) { pending.push({ senderBatchId: p.senderBatchId, batchId: p.batchId, reason: live.message }); continue; }
  for (const it of live.items) {
    const t = it.transactionId ? byTxn.get(it.transactionId) : null;
    (t ? matched : pending).push({ senderBatchId: p.senderBatchId, game: p.number, item: it.senderItemId, amount: it.amount, currency: it.currency, payout_status: it.status, transaction_id: it.transactionId ?? null, in_transaction_search: Boolean(t), paypal_amount: t?.transaction_info?.transaction_amount?.value ?? null, paypal_time: t?.transaction_info?.transaction_initiation_date ?? null });
  }
}
const dollars = matched.reduce((s, m) => s + Math.abs(Number(m.paypal_amount ?? m.amount)), 0);
const games = new Set(matched.map((m) => m.game)).size;
const out = { at: new Date().toISOString(), window: { start: start.toISOString(), end: end.toISOString() }, transactions_listed: rows.length, matched_items: matched.length, games_confirmed_by_paypal: games, dollars_confirmed_by_paypal: Math.round(dollars * 100) / 100, not_yet_in_transaction_search: pending.length, matched, pending, note: "Dollars and games here come from PayPal's transaction search and payout records, not from the agent's ledger." };
await mkdir("results", { recursive: true });
await writeFile("results/reconcile.json", JSON.stringify(out, null, 2) + "\n");
console.log(`PayPal lists ${rows.length} transactions in the window; ${matched.length} payout items matched across ${games} games, $${out.dollars_confirmed_by_paypal}; ${pending.length} item(s) not yet in transaction search. written results/reconcile.json`);
