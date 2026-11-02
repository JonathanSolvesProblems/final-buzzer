/**
 * Code guards around the money. These are not prompt instructions: a rule with an objective test
 * and a real consequence lives here, and the model's decision passes through it before PayPal is
 * called. A blocked decision is recorded as a block, never silently rewritten.
 */
import type { Game } from "../app/feed.ts";
import { linesFor, money, type RateCard, type Sheet } from "./sheet.ts";
import type { Decision } from "./decision.ts";

export const LIMITS = { perItem: 100.0, perGame: 200.0 };

export interface ExpectedItem { official_id: string; role: "referee" | "table"; amount: number }

/** What the rate card says this game pays, and every reason the card itself gives to hold. */
export function expected(game: Game, sheet: Sheet, card: RateCard): { items: ExpectedItem[]; holdReasons: string[] } {
  const holdReasons: string[] = [];
  const lines = linesFor(game, sheet);
  if (lines.length === 0) holdReasons.push("no sheet for this game");
  if (game.bye) holdReasons.push("bye: no officials, nothing to pay");
  if (game.status === "forfeit") {
    holdReasons.push(card.forfeit.show_up_fee === null
      ? "forfeit: the card pays a show-up fee only and its amount is not set"
      : "forfeit: the card pays a show-up fee only");
  }
  if (game.status !== "final" && game.status !== "forfeit") holdReasons.push(`game is ${game.status}, not final`);
  const items: ExpectedItem[] = [];
  for (const l of lines) {
    if (!l.official) { holdReasons.push(`${l.role} missing from the sheet`); continue; }
    items.push({ official_id: l.official.id, role: l.role, amount: l.role === "referee" ? card.per_game.referee : card.per_game.table });
  }
  return { items, holdReasons };
}

export interface GuardVerdict { ok: boolean; reason?: string; checked: string[] }

/** The gate before a payout: amounts and people must match the card exactly, inside the caps. */
export function verifyPayNow(decision: Decision, game: Game, sheet: Sheet, card: RateCard): GuardVerdict {
  const checked: string[] = [];
  const exp = expected(game, sheet, card);
  if (exp.holdReasons.length) return { ok: false, checked, reason: `the card says hold: ${exp.holdReasons.join("; ")}` };
  const folded = new Set(decision.fold_official_ids ?? []);
  const want = exp.items.filter((i) => !folded.has(i.official_id));
  const got = decision.items ?? [];
  checked.push(`${got.length} item(s) against ${want.length} on the card`);
  if (got.length !== want.length) return { ok: false, checked, reason: `decision pays ${got.length} people, the card lists ${want.length}` };
  for (const w of want) {
    const g = got.find((x) => x.official_id === w.official_id);
    if (!g) return { ok: false, checked, reason: `${w.official_id} is on the card but not in the decision` };
    if (g.role !== w.role) return { ok: false, checked, reason: `${w.official_id} is a ${w.role} on the card, decision says ${g.role}` };
    if (money(g.amount) !== money(w.amount)) return { ok: false, checked, reason: `amount off the card for ${w.official_id}: decision ${money(g.amount)}, card ${money(w.amount)}` };
    if (g.amount > LIMITS.perItem) return { ok: false, checked, reason: `${money(g.amount)} is over the per-item cap of ${money(LIMITS.perItem)}` };
  }
  const total = got.reduce((s, x) => s + x.amount, 0);
  checked.push(`total ${money(total)} against the per-game cap ${money(LIMITS.perGame)}`);
  if (total > LIMITS.perGame) return { ok: false, checked, reason: `total ${money(total)} is over the per-game cap` };
  for (const f of folded) if (!exp.items.some((i) => i.official_id === f)) return { ok: false, checked, reason: `${f} is folded but is not on this game's sheet` };
  checked.push("every amount equals the rate card");
  return { ok: true, checked };
}

/** One batch per game, one item per game and official: PayPal refuses a repeat of either. */
export const senderBatchId = (slug: string, game: Game): string => `${slug}-g${game.number}`;
export const senderItemId = (slug: string, game: Game, officialId: string): string => `${slug}-g${game.number}-${officialId}`;
