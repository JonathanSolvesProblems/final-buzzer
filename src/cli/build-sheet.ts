/**
 * Build the officials' sheet for the replay: who was assigned to each of the 88 games.
 *
 * The real sheet is Sam's and has not arrived, so this one is generated and says so. It is
 * deterministic (same input, same file), no official is in two gyms at once, and officials carry
 * over between time slots so back-to-back games happen, which is what makes "fold into the
 * end-of-day batch" a real branch. Two cases are staged on purpose and labelled in the file:
 * one game with no table official on the sheet, and the game the replay marks as a forfeit.
 *
 * Usage: node src/cli/build-sheet.ts  ->  data/officials-2026.json
 */
import { writeFile } from "node:fs/promises";
import { loadFromFile } from "../app/feed.ts";

const t = await loadFromFile("data/tournament-2026.json");
const letters = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");
const officials = letters.map((L, i) => ({
  id: `off-${L.toLowerCase()}`,
  label: `Official ${L}`,
  email: process.env[`OFFICIAL_${L}_EMAIL`] ?? `official-${L.toLowerCase()}@example.com`,
  // four of twenty-four asked to be paid once at the end of the day instead of per game
  payout_preference: i >= 20 ? "end_of_day" : "per_game",
}));

const bySlot = new Map<string, typeof t.games>();
for (const g of t.games) { const k = g.start; if (!bySlot.has(k)) bySlot.set(k, []); bySlot.get(k)!.push(g); }

const assignments: Record<string, { referees: [string, string]; table: string | null }> = {};
let p = 0;
for (const slot of [...bySlot.keys()].sort()) {
  const games = bySlot.get(slot)!;
  if (games.length * 3 > officials.length) throw new Error(`slot ${slot} needs ${games.length * 3} officials, only ${officials.length}`);
  for (const g of games) {
    const pick = () => officials[(p++) % officials.length].id;
    assignments[g.id] = { referees: [pick(), pick()], table: pick() };
  }
}

// staged cases, chosen from the real Saturday schedule and labelled here
const sat = t.games.filter((g) => g.start.startsWith("2026-05-16"));
const forfeit = sat.find((g) => g.start.endsWith("11:30") && g.court === "Gym D") ?? sat[8];
const missing = sat.find((g) => g.start.endsWith("12:45") && g.number !== forfeit.number) ?? sat[12];
assignments[missing.id].table = null;

const out = {
  generated: new Date().toISOString(),
  note: "Generated sheet. Sam's real assignments have not arrived; officials are labelled A to X with sandbox addresses. Replace emails through OFFICIAL_<LETTER>_EMAIL in .env.",
  staged: {
    missing_table_official: { gameId: missing.id, number: missing.number, start: missing.start, court: missing.court },
    forfeit: { gameId: forfeit.id, number: forfeit.number, start: forfeit.start, court: forfeit.court, note: "The replay driver marks this game as a forfeit. The real game was not forfeited." },
  },
  officials,
  assignments,
};
await writeFile("data/officials-2026.json", JSON.stringify(out, null, 2) + "\n");
const perOfficial = new Map<string, number>();
for (const a of Object.values(assignments)) for (const id of [...a.referees, a.table]) if (id) perOfficial.set(id, (perOfficial.get(id) ?? 0) + 1);
console.log(`sheet written: ${t.games.length} games, ${officials.length} officials, ${Math.min(...perOfficial.values())} to ${Math.max(...perOfficial.values())} games each`);
console.log(`staged: no table official on game ${missing.number} (${missing.start} ${missing.court}); forfeit on game ${forfeit.number} (${forfeit.start} ${forfeit.court})`);
