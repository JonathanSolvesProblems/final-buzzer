/** The officials' sheet and the rate card, read from data/. */
import { readFile } from "node:fs/promises";
import type { Game } from "../app/feed.ts";

export interface Official { id: string; label: string; email: string; payout_preference: "per_game" | "end_of_day" }
export interface Assignment { referees: [string, string]; table: string | null }
export interface Sheet {
  officials: Official[];
  assignments: Record<string, Assignment>;
  staged: { missing_table_official: { gameId: string; number: number }; forfeit: { gameId: string; number: number } };
  note: string;
}
export interface RateCard {
  currency: string;
  provisional: boolean;
  source: string;
  per_game: { referee: number; table: number };
  officials_per_game: { referees: number; table: number };
  forfeit: { rule: string; show_up_fee: number | null; note: string };
  bye: { rule: string };
}

export async function loadSheet(path = "data/officials-2026.json"): Promise<Sheet> {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function loadRateCard(path = "data/rate-card.json"): Promise<RateCard> {
  return JSON.parse(await readFile(path, "utf8"));
}

export interface SheetLine { role: "referee" | "table"; official: Official | null }

/** Who is on the sheet for this game, in order: referee, referee, table. A null official is a gap. */
export function linesFor(game: Game, sheet: Sheet): SheetLine[] {
  const a = sheet.assignments[game.id];
  const byId = new Map(sheet.officials.map((o) => [o.id, o]));
  if (!a) return [];
  return [
    { role: "referee", official: byId.get(a.referees[0]) ?? null },
    { role: "referee", official: byId.get(a.referees[1]) ?? null },
    { role: "table", official: a.table ? byId.get(a.table) ?? null : null },
  ];
}

/** Every game an official is on today, for the fold decision. */
export function officialDay(officialId: string, games: Game[], sheet: Sheet, date: string): Game[] {
  return games
    .filter((g) => g.start.startsWith(date))
    .filter((g) => { const a = sheet.assignments[g.id]; return a && (a.referees.includes(officialId) || a.table === officialId); })
    .sort((x, y) => x.start.localeCompare(y.start));
}

export const money = (n: number): string => n.toFixed(2);
