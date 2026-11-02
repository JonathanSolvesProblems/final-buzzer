/**
 * Sam's tap on a held game. The same gate and the same PayPal call as the agent's pay_now, with
 * `decidedBy: "treasurer"` in the ledger. The show-up fee cannot be paid until the card carries an amount,
 * and the function says so instead of inventing one.
 */
import type { Game, Tournament } from "../app/feed.ts";
import { matchup } from "../app/feed.ts";
import { expected, verifyPayNow, senderBatchId, senderItemId } from "./guards.ts";
import { money, type RateCard, type Sheet } from "./sheet.ts";
import { emailFor } from "./buzzer.ts";
import type { Decision } from "./decision.ts";
import { createPayout, waitForPayout, isPayoutError, type StructuredError } from "../paypal/payouts.ts";
import { event, type Ledger, type LedgerPayout } from "../ledger.ts";

export type TreasurerChoice = "pay_full" | "pay_show_up" | "pay_nobody";

export interface ResolveResult {
  ok: boolean;
  gameId: string; number: number; choice: TreasurerChoice;
  message: string;
  payout?: { senderBatchId: string; batchId: string | null; status: string; secondsFromTap: number | null; items: LedgerPayout["items"] } | null;
  error?: StructuredError | null;
}

export async function resolveHold(o: { tournament: Tournament; game: Game; sheet: Sheet; card: RateCard; ledger: Ledger; runId: string; choice: TreasurerChoice; paypal: "live" | "dry" }): Promise<ResolveResult> {
  const { game, sheet, card, ledger, tournament } = o;
  const hold = ledger.holds[game.id];
  const base = { gameId: game.id, number: game.number, choice: o.choice };
  if (!hold) return { ...base, ok: false, message: `Game ${game.number} is not held.` };
  const tapAt = new Date();

  if (o.choice === "pay_nobody") {
    delete ledger.holds[game.id];
    event(ledger, "treasurer_pay_nobody", { gameId: game.id, number: game.number });
    return { ...base, ok: true, message: `Game ${game.number}: nobody is paid, on Sam's word.` };
  }
  if (o.choice === "pay_show_up") {
    if (card.forfeit.show_up_fee === null) return { ...base, ok: false, message: "The show-up fee has no amount on the rate card yet, so it cannot be paid. Pay in full, pay nobody, or add the amount to the card." };
  }
  // a hold overrides the card's own reasons to hold (forfeit, missing official): Sam has looked
  const exp = expected(game, sheet, card);
  const perItem = (role: "referee" | "table") => o.choice === "pay_show_up" ? card.forfeit.show_up_fee! : (role === "referee" ? card.per_game.referee : card.per_game.table);
  const items = exp.items.map((i) => ({ official_id: i.official_id, role: i.role, amount: perItem(i.role) }));
  if (!items.length) return { ...base, ok: false, message: `Game ${game.number} has nobody on the sheet to pay.` };
  const decision: Decision = { choice: "pay_now", reason: `Sam chose ${o.choice.replace("_", " ")} on a held game`, items, fold_official_ids: [], question_for_treasurer: null, flags: { forfeit: game.status === "forfeit", official_missing: exp.holdReasons.some((r) => r.includes("missing")), already_paid: false, amount_uncertain: false, reopened_score: false } };
  // the gate still applies to the amounts and the people; the card's hold reasons are waived by the tap
  const verdict = verifyPayNow(decision, { ...game, status: "final" }, sheet, card);
  if (!verdict.ok && o.choice === "pay_full") return { ...base, ok: false, message: `The gate stopped it: ${verdict.reason}` };

  const sbid = senderBatchId(`${tournament.slug}-${o.runId}`, game) + (o.choice === "pay_show_up" ? "-showup" : "");
  const currency = process.env.PAYOUT_CURRENCY || card.currency;
  const byId = new Map(sheet.officials.map((x) => [x.id, x]));
  const payoutItems = items.map((i) => ({ receiver: emailFor(byId.get(i.official_id)!), amount: money(i.amount), currency, note: `Game ${game.number}, ${matchup(game)}, ${i.role === "referee" ? "referee" : "table official"}${o.choice === "pay_show_up" ? ", show-up fee" : ""}. Northside Youth Basketball.`, senderItemId: senderItemId(`${tournament.slug}-${o.runId}`, game, i.official_id) + (o.choice === "pay_show_up" ? "-showup" : ""), official_id: i.official_id, role: i.role }));
  const record: LedgerPayout = { gameId: game.id, number: game.number, senderBatchId: sbid, batchId: null, status: "NOT_SENT", items: payoutItems.map((i) => ({ official_id: i.official_id, role: i.role, amount: i.amount, receiver: i.receiver })), finalAt: tapAt.toISOString(), createdAt: tapAt.toISOString(), decidedBy: "treasurer", provisional: card.provisional };
  if (o.paypal === "dry") { record.status = "DRY_RUN"; ledger.payouts[sbid] = record; delete ledger.holds[game.id]; return { ...base, ok: true, message: `Dry run: would pay $${money(items.reduce((s, i) => s + i.amount, 0))} to ${items.length} officials.`, payout: { senderBatchId: sbid, batchId: null, status: "DRY_RUN", secondsFromTap: null, items: record.items } }; }
  const created = await createPayout(sbid, payoutItems, "Northside Youth Basketball: officials' pay", `Game ${game.number}, approved by Sam.`);
  if (isPayoutError(created)) return { ...base, ok: false, message: created.message, error: created };
  record.batchId = created.batchId; record.status = created.status; ledger.payouts[sbid] = record; delete ledger.holds[game.id];
  event(ledger, "treasurer_paid", { gameId: game.id, number: game.number, detail: { choice: o.choice, batch: created.batchId } });
  const final = await waitForPayout(created.batchId, { timeoutMs: 90_000, everyMs: 1500 });
  if (!isPayoutError(final)) {
    const completedAt = final.timeCompleted ?? final.items.map((i) => i.timeProcessed).filter(Boolean).sort().at(-1) ?? null;
    record.status = final.status; record.completedAt = completedAt; record.secondsFromBuzzer = completedAt ? Math.round((new Date(completedAt).getTime() - tapAt.getTime()) / 100) / 10 : null;
    ledger.payouts[sbid] = record;
  }
  return { ...base, ok: true, message: `Game ${game.number}: paid $${money(items.reduce((s, i) => s + i.amount, 0))} to ${items.length} officials (${record.status}).`, payout: { senderBatchId: sbid, batchId: record.batchId, status: record.status, secondsFromTap: record.secondsFromBuzzer ?? null, items: record.items } };
}
