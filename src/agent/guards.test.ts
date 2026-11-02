import { test } from "node:test";
import assert from "node:assert/strict";
import { expected, verifyPayNow, senderBatchId, senderItemId } from "./guards.ts";
import type { Game } from "../app/feed.ts";
import type { RateCard, Sheet } from "./sheet.ts";
import type { Decision } from "./decision.ts";

const card: RateCard = {
  currency: "CAD", provisional: true, source: "test",
  per_game: { referee: 45, table: 25 }, officials_per_game: { referees: 2, table: 1 },
  forfeit: { rule: "show_up_fee_only", show_up_fee: null, note: "" }, bye: { rule: "no_officials_no_pay" },
};
const sheet: Sheet = {
  note: "test",
  officials: [
    { id: "off-a", label: "Official A", email: "a@example.com", payout_preference: "per_game" },
    { id: "off-b", label: "Official B", email: "b@example.com", payout_preference: "per_game" },
    { id: "off-c", label: "Official C", email: "c@example.com", payout_preference: "end_of_day" },
  ],
  assignments: { g1: { referees: ["off-a", "off-b"], table: "off-c" }, g2: { referees: ["off-a", "off-b"], table: null } },
  staged: { missing_table_official: { gameId: "g2", number: 2 }, forfeit: { gameId: "g3", number: 3 } },
};
const game = (over: Partial<Game> = {}): Game => ({
  id: "g1", courtId: "c1", number: 1, division: "Mini boys", stage: "pool", home: "A", away: "B", court: "Gym C", venue: "", start: "2026-05-16T11:30",
  status: "final", hs: 50, as: 40, note: "", bye: false, finalAt: null, ...over,
});
const flags = { forfeit: false, official_missing: false, already_paid: false, amount_uncertain: false, reopened_score: false };
const payAll: Decision = { choice: "pay_now", reason: "t", flags, items: [
  { official_id: "off-a", role: "referee", amount: 45 }, { official_id: "off-b", role: "referee", amount: 45 }, { official_id: "off-c", role: "table", amount: 25 } ] };

test("the card gives three items for a full sheet and no reason to hold", () => {
  const e = expected(game(), sheet, card);
  assert.equal(e.items.length, 3);
  assert.deepEqual(e.holdReasons, []);
  assert.equal(e.items.reduce((s, i) => s + i.amount, 0), 115);
});
test("a forfeit with no show-up fee is a hold", () => {
  assert.match(expected(game({ status: "forfeit" }), sheet, card).holdReasons.join(), /forfeit/);
});
test("a missing table official is a hold and only two items", () => {
  const e = expected(game({ id: "g2" }), sheet, card);
  assert.equal(e.items.length, 2);
  assert.match(e.holdReasons.join(), /table missing/);
});
test("the gate passes a decision that matches the card", () => {
  assert.equal(verifyPayNow(payAll, game(), sheet, card).ok, true);
});
test("the gate blocks an amount off the card", () => {
  const d: Decision = { ...payAll, items: payAll.items!.map((i) => i.official_id === "off-c" ? { ...i, amount: 45 } : i) };
  const v = verifyPayNow(d, game(), sheet, card);
  assert.equal(v.ok, false); assert.match(v.reason!, /amount off the card/);
});
test("the gate blocks a person who is not on the sheet", () => {
  const d: Decision = { ...payAll, items: [...payAll.items!.slice(0, 2), { official_id: "off-z", role: "table", amount: 25 }] };
  assert.equal(verifyPayNow(d, game(), sheet, card).ok, false);
});
test("the gate blocks paying a forfeit at full rate", () => {
  const v = verifyPayNow(payAll, game({ status: "forfeit" }), sheet, card);
  assert.equal(v.ok, false); assert.match(v.reason!, /forfeit/);
});
test("a fold removes that official from the items the gate expects", () => {
  const d: Decision = { ...payAll, items: payAll.items!.slice(0, 2), fold_official_ids: ["off-c"] };
  assert.equal(verifyPayNow(d, game(), sheet, card).ok, true);
});
test("folding someone who is not on the game is blocked", () => {
  const d: Decision = { ...payAll, fold_official_ids: ["off-z"] };
  assert.equal(verifyPayNow(d, game(), sheet, card).ok, false);
});
test("idempotency keys are one per game and one per game and official", () => {
  assert.equal(senderBatchId("northside-2026-r1", game({ number: 25 })), "northside-2026-r1-g25");
  assert.equal(senderItemId("northside-2026-r1", game({ number: 25 }), "off-a"), "northside-2026-r1-g25-off-a");
});
