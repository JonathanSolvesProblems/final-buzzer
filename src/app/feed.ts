/**
 * The game feed: the tournament document as the scorer's app saves it. The agent reads this shape
 * and nothing else, so what it sees is what the scorer's phone saved.
 *
 * Two sources: a file on disk (the replay) or a URL (polled with ?v= so an unchanged document costs
 * a 304). The agent never writes the document; the scorer's app does.
 */
import { readFile } from "node:fs/promises";

export type GameStatus = "scheduled" | "final" | "forfeit";

export interface Game {
  id: string;
  courtId: string;
  number: number;          // 1..88 in start-time then court order, the numbering the PDFs use
  division: string;
  stage: string;           // pool | playoff | semi | final ...
  home: string | null;     // team name, null when the slot is still a reference (W:gameId) or a bye
  away: string | null;
  court: string;           // "Gym C"
  venue: string;           // "Northside Collegiate"
  start: string;           // "2026-05-16T11:30" local
  status: GameStatus;
  hs: number | null;
  as: number | null;
  note: string;
  bye: boolean;
  finalAt: string | null;  // when the scorer's app saved the final score, if it recorded it
  feeds: string[];         // ids of the games whose winner or loser plays this one (W:id / L:id)
}

export interface Tournament {
  slug: string;
  name: string;
  association: string;
  version: number;
  updatedAt: string;
  games: Game[];
  courts: Array<{ id: string; name: string; venue: string }>;
}

export interface RawDoc {
  slug: string; name: string; association?: string; version: number; updated_at: string;
  courts: Array<{ id: string; name: string; venue?: string }>;
  divisions: Array<{
    name: string;
    teams: Array<{ id: string; name: string }>;
    games: Array<{
      id: string; stage: string; homeId: string | null; awayId: string | null;
      homeRef: string | null; awayRef: string | null; courtId: string | null; start: string | null;
      status: string; hs: number | null; as: number | null; note: string; bye?: boolean; finalAt?: string | null;
    }>;
  }>;
}

export function normalise(doc: RawDoc): Tournament {
  const courtOrder = new Map(doc.courts.map((c, i) => [c.id, i]));
  // some courts are named "1" and "2" in the app; on their own they read as nothing, so they take the venue's first word
  const courtName = new Map(doc.courts.map((c) => [c.id, /^\d+$/.test(c.name) ? `${(c.venue ?? "Court").split(" ")[0]} ${c.name}` : c.name]));
  const courtVenue = new Map(doc.courts.map((c) => [c.id, c.venue ?? ""]));
  const games: Game[] = [];
  for (const d of doc.divisions) {
    const team = new Map(d.teams.map((t) => [t.id, t.name]));
    for (const g of d.games) {
      if (!g.start || !g.courtId) continue; // unscheduled games are not on the board
      games.push({
        id: g.id,
        courtId: g.courtId,
        number: 0,
        division: d.name,
        stage: g.stage,
        home: g.homeId ? team.get(g.homeId) ?? null : null,
        away: g.awayId ? team.get(g.awayId) ?? null : null,
        court: courtName.get(g.courtId) ?? g.courtId,
        venue: courtVenue.get(g.courtId) ?? "",
        start: g.start,
        status: (g.status === "final" || g.status === "forfeit") ? g.status : "scheduled",
        hs: g.hs, as: g.as, note: g.note ?? "", bye: Boolean(g.bye), finalAt: g.finalAt ?? null,
        feeds: [g.homeRef, g.awayRef].map((r) => /^[WL]:(.+)$/.exec(r ?? "")?.[1]).filter((x): x is string => Boolean(x)),
      });
    }
  }
  games.sort((a, b) => a.start.localeCompare(b.start) || (courtOrder.get(a.courtId) ?? 0) - (courtOrder.get(b.courtId) ?? 0));
  games.forEach((g, i) => { g.number = i + 1; });
  return { slug: doc.slug, name: doc.name, association: doc.association ?? "", version: doc.version, updatedAt: doc.updated_at, games,
    courts: doc.courts.map((c) => ({ id: c.id, name: courtName.get(c.id) ?? c.name, venue: c.venue ?? "" })) };
}

export async function loadFromFile(path: string): Promise<Tournament> {
  return normalise(JSON.parse(await readFile(path, "utf8")));
}

/** Fetch the document from the scorer's app (any URL that serves the document shape). `auth` is an
 *  optional "user:password" for a private document. Returns null on 304 (unchanged since `version`). */
export async function loadFromUrl(docUrl: string, opts: { version?: number; auth?: string } = {}): Promise<Tournament | null> {
  const url = new URL(docUrl);
  if (opts.version !== undefined) url.searchParams.set("v", String(opts.version));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.auth) headers.Authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
  const res = await fetch(url, { headers });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`feed: ${res.status} ${res.statusText} for ${url}`);
  return normalise(await res.json() as RawDoc);
}

export const isFinal = (g: Game): boolean => g.status === "final" || g.status === "forfeit";
export const matchup = (g: Game): string => g.home && g.away ? `${g.home} v ${g.away}` : g.stage;
