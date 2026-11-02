/* The tournament document, numbered the way the agent numbers it (start, then court order), shared
   by the board, the money board and the scorer's phone. Mirrors src/app/feed.ts. */
export const GAME_MINUTES = 75;

export function normalise(doc) {
  const order = new Map(doc.courts.map((c, i) => [c.id, i]));
  const name = new Map(doc.courts.map((c) => [c.id, /^\d+$/.test(c.name) ? `${(c.venue ?? "Court").split(" ")[0]} ${c.name}` : c.name]));
  const games = [];
  for (const d of doc.divisions) {
    const team = new Map(d.teams.map((t) => [t.id, t.name]));
    for (const g of d.games) {
      if (!g.start || !g.courtId) continue;
      games.push({ id: g.id, courtId: g.courtId, number: 0, division: d.name, stage: g.stage, home: g.homeId ? team.get(g.homeId) ?? null : null, away: g.awayId ? team.get(g.awayId) ?? null : null, court: name.get(g.courtId) ?? g.courtId, venue: doc.courts.find((c) => c.id === g.courtId)?.venue ?? "", start: g.start, status: g.status, hs: g.hs ?? null, as: g.as ?? null, note: g.note ?? "", bye: Boolean(g.bye), finalAt: g.finalAt ?? null });
    }
  }
  games.sort((a, b) => a.start.localeCompare(b.start) || order.get(a.courtId) - order.get(b.courtId));
  games.forEach((g, i) => { g.number = i + 1; });
  return { slug: doc.slug, name: doc.name, association: doc.association ?? "", version: doc.version, games, courts: doc.courts.map((c) => ({ id: c.id, name: name.get(c.id), venue: c.venue ?? "" })) };
}
export const matchup = (g) => g.home && g.away ? `${g.home} v ${g.away}` : g.stage;
export const sentence = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
export async function get(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
