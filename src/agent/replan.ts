/**
 * A gym closes: the re-plan agent. The model proposes where each affected game goes, checking each
 * placement against the schedule's own rules through a tool; code validates the final plan with the
 * same rules, reassigns officials where needed, computes the pro-rata refund for games that cannot
 * be played, and writes the money side through PayPal.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Game, Tournament } from "../app/feed.ts";
import { matchup } from "../app/feed.ts";
import type { Sheet } from "./sheet.ts";
import { runLoop, type ToolDef, type TraceStep } from "./loop.ts";

export const GAME_MINUTES = 75;
export const REST_MINUTES = 120;   // a team's starts must be at least this far apart
const STAGE_RANK: Record<string, number> = { final: 0, semi: 1, quarter: 2, placement: 3, pool: 4 };

export interface Closure { day: string; court: string; from: string }  // from: "14:00"
export interface Slot { court: string; courtId: string; start: string; venue: string }
export interface MoveCheck { ok: boolean; problems: string[]; officials_to_reassign: number; notes: string[] }
export interface Move { game_number: number; court: string; start: string; officials_to_reassign?: number; reason: string }
export interface Unplayable { game_number: number; reason: string }
export interface ReplanDecision { moves: Move[]; unplayable: Unplayable[]; summary: string }

export interface ReplanResult {
  closure: Closure; affected: number[];
  decision: ReplanDecision | null;
  applied: Array<{ game_number: number; from: { court: string; start: string }; to: { court: string; start: string }; officials: string[]; reassigned: string[] }>;
  rejected: Array<{ game_number: number; wanted: { court: string; start: string }; problems: string[] }>;
  unplayable: Array<{ game_number: number; reason: string; teams: string[] }>;
  loop: { model: string; calls: number; input_tokens: number; output_tokens: number; ms: number; endedBy: string };
  trace: TraceStep[];
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeOf = (g: Game) => g.start.slice(11, 16);
const dayOf = (g: Game) => g.start.slice(0, 10);

/** Joined courts share a floor: "Gym CD" is Gym C and Gym D with the divider up, so it cannot be used
 *  while either half has a game, and closing one half closes the joined court too. */
const halves = (name: string): string[] => { const m = /^Gym ([A-Z]{2,})$/.exec(name); return m ? m[1].split("") : (/^Gym ([A-Z])$/.exec(name)?.[1] ? [name.slice(4)] : []); };
export function shareFloor(a: string, b: string): boolean {
  if (a === b) return true;
  const ha = halves(a), hb = halves(b);
  return ha.length > 0 && hb.length > 0 && ha.some((x) => hb.includes(x));
}

export function affectedGames(t: Tournament, c: Closure): Game[] {
  return t.games.filter((g) => dayOf(g) === c.day && shareFloor(g.court, c.court) && minutes(timeOf(g)) >= minutes(c.from) && g.status === "scheduled")
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Free slots that day on open courts: the day's own start times, plus one extra slot at the end of each court. */
export function freeSlots(t: Tournament, c: Closure, courts: Array<{ id: string; name: string; venue: string }>): Slot[] {
  const dayGames = t.games.filter((g) => dayOf(g) === c.day);
  const starts = [...new Set(dayGames.map(timeOf))].sort();
  const last = starts.at(-1)!;
  const grid = [...starts, hhmm(minutes(last) + GAME_MINUTES)].filter((s) => minutes(s) >= minutes(c.from));
  const out: Slot[] = [];
  for (const court of courts) {
    if (shareFloor(court.name, c.court)) continue;
    // games leaving the closed floor free their time on any court they shared it with
    const moving = (g: Game) => shareFloor(g.court, c.court) && minutes(timeOf(g)) >= minutes(c.from);
    const used = new Set(dayGames.filter((g) => shareFloor(g.court, court.name) && !moving(g)).map(timeOf));
    const plays = dayGames.some((g) => g.court === court.name);
    if (!plays) continue; // a court with no games that day is not booked for the tournament
    for (const s of grid) if (!used.has(s)) out.push({ court: court.name, courtId: court.id, start: s, venue: court.venue });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.court.localeCompare(b.court));
}

/** The schedule's own rules, applied to one proposed placement. `taken` holds slots already given to other moves. */
export function checkMove(t: Tournament, sheet: Sheet, g: Game, court: string, start: string, taken: Set<string> = new Set(), closure?: Closure): MoveCheck {
  const problems: string[] = []; const notes: string[] = [];
  const day = dayOf(g);
  const dayGames = t.games.filter((x) => dayOf(x) === day && x.id !== g.id);
  if (!/^\d\d:\d\d$/.test(start)) problems.push(`start ${start} is not a time`);
  if (closure && day === closure.day && shareFloor(court, closure.court) && minutes(start) >= minutes(closure.from)) problems.push(`${court} shares a floor with the closed ${closure.court}`);
  const clash = dayGames.find((x) => shareFloor(x.court, court) && timeOf(x) === start && !(closure && shareFloor(x.court, closure.court) && minutes(timeOf(x)) >= minutes(closure.from)));
  if (clash) problems.push(clash.court === court ? `${court} at ${start} is taken` : `${court} at ${start} is taken: ${clash.court} shares its floor and has game ${clash.number} then`);
  else if ([...taken].some((k) => { const [c2, s2] = k.split("@"); return s2 === start && shareFloor(c2, court); })) problems.push(`${court} at ${start} is taken by another move`);
  // playoff order: the games that feed this one must end before it starts, and the games it feeds must start after it ends
  const newStart = minutes(start);
  for (const fid of g.feeds) {
    const f = t.games.find((x) => x.id === fid);
    if (f && dayOf(f) === day && minutes(timeOf(f)) + GAME_MINUTES > newStart) problems.push(`game ${g.number} needs the result of game ${f.number}, which ends at ${hhmm(minutes(timeOf(f)) + GAME_MINUTES)}`);
  }
  for (const d of t.games.filter((x) => x.feeds.includes(g.id))) {
    if (dayOf(d) === day && minutes(timeOf(d)) < newStart + GAME_MINUTES) problems.push(`game ${d.number} at ${timeOf(d)} needs this game's result, and a ${start} start ends at ${hhmm(newStart + GAME_MINUTES)}`);
  }
  const teams = [g.home, g.away].filter(Boolean) as string[];
  for (const team of teams) {
    const other = dayGames.filter((x) => (x.home === team || x.away === team) && x.division === g.division);
    for (const o of other) if (Math.abs(minutes(timeOf(o)) - minutes(start)) < REST_MINUTES) problems.push(`${team} plays game ${o.number} at ${timeOf(o)}, less than two hours from ${start}`);
  }
  if (g.stage === "pool") {
    const firstPlayoff = t.games.filter((x) => x.division === g.division && x.stage !== "pool" && dayOf(x) >= day).map((x) => x.start).sort()[0];
    if (firstPlayoff && `${day}T${start}` >= firstPlayoff) problems.push(`a ${g.division} pool game cannot land after the division's first playoff at ${firstPlayoff.replace("T", " ")}`);
  }
  const a = sheet.assignments[g.id];
  let reassign = 0;
  if (a) {
    for (const id of [...a.referees, a.table]) {
      if (!id) continue;
      const busy = dayGames.some((x) => { const b = sheet.assignments[x.id]; return b && timeOf(x) === start && (b.referees.includes(id) || b.table === id); });
      if (busy) reassign++;
    }
    if (reassign) notes.push(`${reassign} of the sheet's officials are on another game at ${start} and would be reassigned`);
  }
  return { ok: problems.length === 0, problems, officials_to_reassign: reassign, notes };
}

/** Officials free at a slot, for reassignment. */
export function freeOfficials(t: Tournament, sheet: Sheet, day: string, start: string, exclude: Set<string>): string[] {
  const busy = new Set<string>();
  for (const g of t.games.filter((x) => dayOf(x) === day && timeOf(x) === start)) { const a = sheet.assignments[g.id]; if (a) for (const id of [...a.referees, a.table]) if (id) busy.add(id); }
  return sheet.officials.map((o) => o.id).filter((id) => !busy.has(id) && !exclude.has(id));
}

const decideTool = {
  name: "decide_replan",
  description: "Record the plan: every affected game is either in moves (a court and a start time that check_move accepted) or in unplayable (with the reason). Call it once. Do not compute refunds; code does that from the fee rule.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["moves", "unplayable", "summary"],
    properties: {
      moves: { type: "array", items: { type: "object", additionalProperties: false, required: ["game_number", "court", "start", "reason"], properties: { game_number: { type: "integer" }, court: { type: "string" }, start: { type: "string", description: "HH:MM" }, officials_to_reassign: { type: "integer" }, reason: { type: "string" } } } },
      unplayable: { type: "array", items: { type: "object", additionalProperties: false, required: ["game_number", "reason"], properties: { game_number: { type: "integer" }, reason: { type: "string" } } } },
      summary: { type: "string", description: "Two sentences for Sam." },
    },
  },
} as const;

const here = dirname(fileURLToPath(import.meta.url));
let systemPrompt: string | null = null;

export async function runReplan(o: { tournament: Tournament; sheet: Sheet; courts: Array<{ id: string; name: string; venue: string }>; closure: Closure; model?: string; onStep?: (s: TraceStep) => void }): Promise<ReplanResult> {
  const { tournament: t, sheet, closure } = o;
  systemPrompt ??= await readFile(join(here, "prompts", "replan.md"), "utf8");
  const t0 = Date.now();
  const affected = affectedGames(t, closure);
  const slots = freeSlots(t, closure, o.courts);
  const byNumber = new Map(affected.map((g) => [g.number, g]));
  const view = (g: Game) => ({ number: g.number, division: g.division, stage: g.stage, matchup: matchup(g), court: g.court, start: timeOf(g), venue: g.venue });

  const tools: ToolDef[] = [
    { name: "read_closure", description: "The closure and the games it takes out: court, closing time, and each affected game with its division, stage (final, semi, quarter, placement, pool), teams and original time.", input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => ({ closure, affected: affected.map(view), order_of_priority: "final, semi, quarter, placement, pool" }) },
    { name: "free_slots", description: "Every open court and start time today from the closing time onward, including one extra slot at the end of each court's day. A slot is court plus start (HH:MM).", input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => ({ slots, note: "Same-venue slots are listed with their venue; moving across venues is allowed but costs the teams travel." }) },
    { name: "check_move", description: "Check one placement: game_number to court at start (HH:MM). Returns ok, the problems (taken slot, a joined court whose halves are in use or closed (Gym CD is Gym C and Gym D), a playoff game placed before the games that feed it end or after the game it feeds starts, a team playing within two hours, a pool game after its division's first playoff) and how many of the sheet's officials would need reassigning. Use it before every move you intend to make; a rejected move cannot be chosen.",
      input_schema: { type: "object", additionalProperties: false, required: ["game_number", "court", "start"], properties: { game_number: { type: "integer" }, court: { type: "string" }, start: { type: "string" } } },
      run: (i: { game_number: number; court: string; start: string }) => { const g = byNumber.get(i.game_number); if (!g) return { isError: true, errorCategory: "validation", isRetryable: false, message: `game ${i.game_number} is not affected by this closure` }; return checkMove(t, sheet, g, i.court, i.start, new Set(), closure); } },
    { ...decideTool, input_schema: decideTool.input_schema as unknown as Record<string, unknown>, terminal: true, run: (d: ReplanDecision) => ({ recorded: true, moves: d.moves.length, unplayable: d.unplayable.length }) },
  ];
  const user = `${closure.court} closes at ${closure.from} on ${closure.day}. ${affected.length} game(s) are affected. Read the closure and the free slots, check each placement, then call decide_replan.`;
  const loop = await runLoop({ system: systemPrompt, user, tools, model: o.model, onStep: o.onStep, maxCalls: 20, maxTokens: 3000 });
  const decision = loop.terminal?.name === "decide_replan" ? (loop.terminal.input as ReplanDecision) : null;
  const result: ReplanResult = { closure, affected: affected.map((g) => g.number), decision, applied: [], rejected: [], unplayable: [], trace: loop.steps,
    loop: { model: loop.model, calls: loop.usage.calls, input_tokens: loop.usage.input_tokens, output_tokens: loop.usage.output_tokens, ms: Date.now() - t0, endedBy: loop.endedBy } };
  if (!decision) { for (const g of affected) result.unplayable.push({ game_number: g.number, reason: `the agent did not reach a plan (${loop.error ?? loop.endedBy}); held for Sam`, teams: [g.home, g.away].filter(Boolean) as string[] }); return result; }

  // enforcement: every move re-checked in order, slots claimed as they go; officials reassigned by code
  const taken = new Set<string>();
  const ranked = [...decision.moves].sort((a, b) => (STAGE_RANK[byNumber.get(a.game_number)?.stage ?? "pool"] ?? 9) - (STAGE_RANK[byNumber.get(b.game_number)?.stage ?? "pool"] ?? 9));
  for (const m of ranked) {
    const g = byNumber.get(m.game_number);
    if (!g) { result.rejected.push({ game_number: m.game_number, wanted: { court: m.court, start: m.start }, problems: ["not an affected game"] }); continue; }
    const check = checkMove(t, sheet, g, m.court, m.start, taken, closure);
    if (!check.ok) { result.rejected.push({ game_number: g.number, wanted: { court: m.court, start: m.start }, problems: check.problems }); continue; }
    taken.add(`${m.court}@${m.start}`);
    const a = sheet.assignments[g.id];
    const reassigned: string[] = [];
    if (a) {
      const excl = new Set<string>([...a.referees, a.table].filter(Boolean) as string[]);
      const pool = freeOfficials(t, sheet, closure.day, m.start, excl);
      const swap = (id: string | null) => { if (!id) return id; const busy = t.games.some((x) => dayOf(x) === closure.day && x.id !== g.id && timeOf(x) === m.start && (sheet.assignments[x.id]?.referees.includes(id) || sheet.assignments[x.id]?.table === id)); if (!busy) return id; const n = pool.shift() ?? null; if (n) reassigned.push(`${id} -> ${n}`); return n; };
      a.referees = [swap(a.referees[0])!, swap(a.referees[1])!]; a.table = swap(a.table);
    }
    const from = { court: g.court, start: timeOf(g) };
    g.court = m.court; g.start = `${closure.day}T${m.start}`; g.note = `moved from ${from.court} ${from.start} (${closure.court} closed at ${closure.from})`;
    result.applied.push({ game_number: g.number, from, to: { court: m.court, start: m.start }, officials: a ? [...a.referees, a.table].filter(Boolean) as string[] : [], reassigned });
  }
  const placed = new Set(result.applied.map((x) => x.game_number));
  for (const u of decision.unplayable) { const g = byNumber.get(u.game_number); if (g && !placed.has(g.number)) result.unplayable.push({ game_number: g.number, reason: u.reason, teams: [g.home, g.away].filter(Boolean) as string[] }); }
  for (const g of affected) if (!placed.has(g.number) && !result.unplayable.some((u) => u.game_number === g.number)) {
    const r = result.rejected.find((x) => x.game_number === g.number);
    result.unplayable.push({ game_number: g.number, reason: r ? `the agent's move failed the schedule's rules (${r.problems.join("; ")}); held for Sam` : "the agent left this game out of the plan; held for Sam", teams: [g.home, g.away].filter(Boolean) as string[] });
  }
  return result;
}

/** The pro-rata refund rule from data/fees.json: entry fee divided by the games the team was scheduled to play. */
export function refundFor(t: Tournament, team: string, division: string, entryFee: number): { gamesScheduled: number; perGame: number } {
  const n = t.games.filter((g) => g.division === division && (g.home === team || g.away === team)).length || 1;
  return { gamesScheduled: n, perGame: Math.round((entryFee / n) * 100) / 100 };
}
