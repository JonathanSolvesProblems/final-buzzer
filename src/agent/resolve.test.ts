import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHold, type TreasurerChoice } from "./resolve.ts";
import type { Game, Tournament } from "../app/feed.ts";
import type { RateCard, Sheet } from "./sheet.ts";
import type { Ledger } from "../ledger.ts";

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
    { id: "off-c", label: "Official C", email: "c@example.com", payout_preference: "per_game" },
  ],
  assignments: { g1: { referees: ["off-a", "off-b"], table: "off-c" } },
  staged: { missing_table_official: { gameId: "g2", number: 2 }, forfeit: { gameId: "g3", number: 3 } },
};
const game: Game = {
  id: "g1", courtId: "c1", number: 17, division: "Bantam boys", stage: "pool", home: "A", away: "B", court: "Gym EF", venue: "", start: "2026-05-16T09:00",
  status: "final", hs: 57, as: 47, note: "", bye: false, finalAt: null, feeds: [],
};
const tournament = { slug: "northside-2026", games: [game] } as unknown as Tournament;
const flags = { forfeit: false, official_missing: false, already_paid: true, amount_uncertain: false, reopened_score: false };
const ledgerWithHold = (): Ledger => ({
  payouts: {}, folds: {}, events: [],
  holds: { g1: { gameId: "g1", number: 17, at: "2026-11-02T20:47:48Z", reason: "PayPal already shows it paid", question: null, flags, by: "agent" } },
} as unknown as Ledger);
const tap = (choice: TreasurerChoice, ledger: Ledger) => resolveHold({ tournament, game, sheet, card, ledger, runId: "t", choice, paypal: "dry" });

test("a game PayPal already shows paid cannot be paid again from the board", async () => {
  const ledger = ledgerWithHold();
  const out = await tap("pay_full", ledger);
  assert.equal(out.ok, false);
  assert.match(out.message, /pay twice/);
  assert.equal(Object.keys(ledger.payouts).length, 0);
  assert.ok(ledger.holds.g1, "the hold stays until Sam confirms");
});
test("confirming nothing more clears the hold and sends nothing", async () => {
  const ledger = ledgerWithHold();
  const out = await tap("pay_nobody", ledger);
  assert.equal(out.ok, true);
  assert.equal(ledger.holds.g1, undefined);
  assert.equal(Object.keys(ledger.payouts).length, 0);
});
