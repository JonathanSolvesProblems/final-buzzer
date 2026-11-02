/**
 * The buzzer agent: one game has gone final, decide what happens to the officials' pay.
 *
 * The model reads four things through tools (the sheet, the rate card, PayPal, the officials' day)
 * and calls `decide` once. Code then runs the decision through the guards and, for pay_now, through
 * PayPal Payouts. The model chooses; the code enforces; PayPal confirms.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Game, Tournament } from "../app/feed.ts";
import { matchup } from "../app/feed.ts";
import { linesFor, officialDay, money, type Official, type RateCard, type Sheet } from "./sheet.ts";
import { expected, verifyPayNow, senderBatchId, senderItemId, type GuardVerdict } from "./guards.ts";
import { decideTool, type Decision } from "./decision.ts";
import { runLoop, type ToolDef, type TraceStep } from "./loop.ts";
import { createPayout, getPayout, waitForPayout, isPayoutError, type StructuredError } from "../paypal/payouts.ts";
import { event, type Ledger, type LedgerPayout } from "../ledger.ts";

export type PayPalMode = "live" | "dry" | "off";

export interface BuzzerOptions {
  tournament: Tournament;
  game: Game;
  sheet: Sheet;
  card: RateCard;
  ledger: Ledger;
  finalAt: Date;               // the moment the app saved the final score
  runId: string;               // part of every PayPal idempotency key
  paypal: PayPalMode;          // live: sandbox calls; dry: no calls; off: the no-PayPal ablation
  previousStatus?: string;     // what the game was before this save, for the reopened-score flag
  model?: string;
  scripted?: boolean;          // the ablation: a fixed rule instead of the model
  onStep?: (s: TraceStep) => void;
}

export type Outcome = "paid" | "pending" | "held" | "folded" | "blocked" | "error" | "dry";

export interface BuzzerResult {
  game: { id: string; number: number; division: string; matchup: string; court: string; start: string; status: string; note: string };
  finalAt: string;
  decision: Decision | null;
  outcome: Outcome;
  blockedBy: "guard" | "paypal" | null;
  guard: GuardVerdict | null;
  payout: { senderBatchId: string; batchId: string | null; status: string; completedAt: string | null; secondsFromBuzzer: number | null; items: LedgerPayout["items"] } | null;
  hold: { question: string | null; reason: string } | null;
  folded: string[];
  error: StructuredError | string | null;
  loop: { model: string; calls: number; input_tokens: number; output_tokens: number; ms: number; endedBy: string };
  trace: TraceStep[];
  paypalMode: PayPalMode;
  provisionalRateCard: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
let systemPrompt: string | null = null;
async function system(): Promise<string> {
  return (systemPrompt ??= await readFile(join(here, "prompts", "buzzer.md"), "utf8"));
}

/** The official's PayPal address: .env wins over the sheet, so real sandbox accounts can be dropped in. */
export function emailFor(o: Official): string {
  const letter = o.label.replace(/^Official\s+/, "").trim().toUpperCase();
  return process.env[`OFFICIAL_${letter}_EMAIL`] || o.email;
}
const mask = (e: string): string => e.replace(/^(.).*(@.*)$/, "$1***$2");

export async function runBuzzer(o: BuzzerOptions): Promise<BuzzerResult> {
  const { game, sheet, card, ledger, tournament } = o;
  const t0 = Date.now();
  const sbid = senderBatchId(`${tournament.slug}-${o.runId}`, game);
  const date = game.start.slice(0, 10);
  const lines = linesFor(game, sheet);
  const base = {
    game: { id: game.id, number: game.number, division: game.division, matchup: matchup(game), court: game.court, start: game.start, status: game.status, note: game.note },
    finalAt: o.finalAt.toISOString(),
    paypalMode: o.paypal,
    provisionalRateCard: card.provisional,
  };

  // ---- the tools the model may use -------------------------------------------------------------
  const tools: ToolDef[] = [
    {
      name: "read_game_sheet",
      description: "The game that just went final and who was on its sheet: two referees and one table official, or a gap where one is missing. Call this first. Use read_rate_card for what each role is paid, not this.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => ({
        game: { number: game.number, division: game.division, matchup: matchup(game), court: game.court, venue: game.venue, start: game.start, status: game.status, score: game.hs !== null && game.as !== null ? `${game.hs} to ${game.as}` : null, note: game.note || null, bye: game.bye },
        previous_status: o.previousStatus ?? "scheduled",
        officials: lines.map((l) => ({ role: l.role, official: l.official ? { id: l.official.id, label: l.official.label, payout_preference: l.official.payout_preference, paypal: mask(emailFor(l.official)) } : null })),
      }),
    },
    {
      name: "read_rate_card",
      description: "The association's rate card in force: what a referee and a table official are paid per game, the forfeit rule and the bye rule. Amounts come from here and nowhere else.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      // the card in force, without the bookkeeping labels (provisional, source) meant for the write-up
      run: () => ({ currency: card.currency, per_game: card.per_game, officials_per_game: card.officials_per_game, forfeit: { rule: card.forfeit.rule, show_up_fee: card.forfeit.show_up_fee }, bye: card.bye }),
    },
    {
      name: "check_paypal_for_game",
      description: "Whether PayPal already holds a payout for this game. Looks up the game's own payout batch id and verifies it against PayPal's record, so a re-saved score cannot pay twice. Returns already_paid with the batch when one exists. This is PayPal's answer, not the app's.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        if (o.paypal === "off") return { isError: true, errorCategory: "permission", isRetryable: false, message: "PayPal tools are switched off in this run. Nothing can be checked or paid." };
        const prior = Object.values(ledger.payouts).find((p) => p.gameId === game.id);
        if (!prior) return { already_paid: false, sender_batch_id: sbid, checked: "no batch recorded for this game; PayPal also refuses a repeat of this batch id for 30 days" };
        if (o.paypal === "dry" || !prior.batchId) return { already_paid: true, batch: { batchId: prior.batchId, status: prior.status, completedAt: prior.completedAt ?? null, items: prior.items }, source: "ledger (dry run, PayPal not asked)" };
        const live = await getPayout(prior.batchId);
        if (isPayoutError(live)) return live;
        return { already_paid: true, source: "PayPal", batch: { batchId: live.batchId, status: live.status, completedAt: live.timeCompleted ?? null, items: live.items.map((i) => ({ receiver: mask(i.receiver), amount: i.amount, currency: i.currency, status: i.status, timeProcessed: i.timeProcessed })) } };
      },
    },
    {
      name: "officials_day_schedule",
      description: "For each official on this game: their other games today, with start times and the minutes until their next one, and whether they asked to be paid per game or once at the end of the day. Use it to decide who folds into the end-of-day batch.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => lines.filter((l) => l.official).map((l) => {
        const of = l.official!;
        const day = officialDay(of.id, tournament.games, sheet, date);
        const later = day.filter((g) => g.start > game.start);
        const next = later[0] ?? null;
        const minutes = next ? Math.round((new Date(next.start).getTime() - new Date(game.start).getTime()) / 60000) : null;
        return {
          id: of.id, label: of.label, payout_preference: of.payout_preference,
          games_today: day.map((g) => ({ number: g.number, start: g.start.slice(11), court: g.court, status: g.status, this_game: g.id === game.id })),
          next_game: next ? { number: next.number, start: next.start.slice(11), court: next.court, minutes_after_this_one_started: minutes } : null,
        };
      }),
    },
    { ...decideTool, input_schema: decideTool.input_schema as unknown as Record<string, unknown>, terminal: true, run: (input: Decision) => ({ recorded: true, choice: input.choice }) },
  ];

  // ---- the decision: the model, or the fixed rule of the ablation ----------------------------
  let decision: Decision | null = null;
  let loop: BuzzerResult["loop"];
  let trace: TraceStep[] = [];
  if (o.scripted) {
    const exp = expected(game, sheet, card);
    decision = {
      choice: "pay_now", reason: "scripted: pay everyone on the sheet at the card rate whenever a game ends",
      items: lines.filter((l) => l.official).map((l) => ({ official_id: l.official!.id, role: l.role, amount: l.role === "referee" ? card.per_game.referee : card.per_game.table })),
      fold_official_ids: [], question_for_treasurer: null,
      flags: { forfeit: game.status === "forfeit", official_missing: exp.holdReasons.some((r) => r.includes("missing")), already_paid: false, amount_uncertain: false, reopened_score: false },
    };
    loop = { model: "scripted", calls: 0, input_tokens: 0, output_tokens: 0, ms: 0, endedBy: "script" };
  } else {
    const user = `Game ${game.number} just went ${game.status} at ${o.finalAt.toISOString()}: ${matchup(game)}, ${game.division}, ${game.court}, scheduled ${game.start.replace("T", " ")}. Read the sheet, the rate card, PayPal and the officials' day, then call decide.`;
    const r = await runLoop({ system: await system(), user, tools, model: o.model, onStep: o.onStep });
    trace = r.steps;
    loop = { model: r.model, calls: r.usage.calls, input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, ms: Date.now() - t0, endedBy: r.endedBy };
    if (r.terminal?.name === "decide") decision = r.terminal.input as Decision;
    if (!decision) {
      const reason = r.error ? `the agent could not decide: ${r.error}` : `the agent ended without a decision (${r.endedBy})`;
      ledger.holds[game.id] = { gameId: game.id, number: game.number, at: new Date().toISOString(), reason, question: `Game ${game.number}: the agent did not reach a decision. Pay in full, ${money(card.per_game.referee * 2 + card.per_game.table)}?`, flags: {}, by: "guard" };
      event(ledger, "hold", { gameId: game.id, number: game.number, detail: reason });
      return { ...base, decision: null, outcome: "held", blockedBy: "guard", guard: null, payout: null, hold: { question: ledger.holds[game.id].question, reason }, folded: [], error: r.error ?? null, loop, trace };
    }
  }

  // ---- enforcement: the guards, then PayPal ------------------------------------------------------
  const done = (partial: Partial<BuzzerResult> & { outcome: Outcome }): BuzzerResult =>
    ({ ...base, decision, blockedBy: null, guard: null, payout: null, hold: null, folded: [], error: null, loop, trace, ...partial });

  if (decision.choice === "hold") {
    const hold = { gameId: game.id, number: game.number, at: new Date().toISOString(), reason: decision.reason, question: decision.question_for_treasurer ?? null, flags: decision.flags, by: "agent" as const };
    ledger.holds[game.id] = hold;
    event(ledger, "hold", { gameId: game.id, number: game.number, detail: decision.reason });
    return done({ outcome: "held", hold: { question: hold.question, reason: hold.reason } });
  }

  const exp = expected(game, sheet, card);
  if (decision.choice === "fold") {
    if (exp.holdReasons.length) {
      const reason = `the card says hold, so nothing folds: ${exp.holdReasons.join("; ")}`;
      ledger.holds[game.id] = { gameId: game.id, number: game.number, at: new Date().toISOString(), reason, question: decision.question_for_treasurer ?? null, flags: decision.flags, by: "guard" };
      return done({ outcome: "blocked", blockedBy: "guard", guard: { ok: false, reason, checked: [] }, hold: { question: decision.question_for_treasurer ?? null, reason } });
    }
    for (const i of exp.items) (ledger.folds[i.official_id] ??= []).push({ gameId: game.id, number: game.number, official_id: i.official_id, role: i.role, amount: money(i.amount), at: new Date().toISOString() });
    event(ledger, "fold", { gameId: game.id, number: game.number, detail: exp.items.map((i) => i.official_id) });
    return done({ outcome: "folded", folded: exp.items.map((i) => i.official_id) });
  }

  // pay_now
  const verdict = verifyPayNow(decision, game, sheet, card);
  if (!verdict.ok) {
    const reason = `guard blocked the payout: ${verdict.reason}`;
    ledger.holds[game.id] = { gameId: game.id, number: game.number, at: new Date().toISOString(), reason, question: decision.question_for_treasurer ?? `Game ${game.number}: the agent wanted to pay but the gate stopped it (${verdict.reason}). What should be paid?`, flags: decision.flags, by: "guard" };
    event(ledger, "guard_block", { gameId: game.id, number: game.number, detail: verdict.reason });
    return done({ outcome: "blocked", blockedBy: "guard", guard: verdict, hold: { question: ledger.holds[game.id].question, reason } });
  }
  const folded = decision.fold_official_ids ?? [];
  for (const f of folded) {
    const i = exp.items.find((x) => x.official_id === f)!;
    (ledger.folds[f] ??= []).push({ gameId: game.id, number: game.number, official_id: f, role: i.role, amount: money(i.amount), at: new Date().toISOString() });
  }
  const byId = new Map(sheet.officials.map((x) => [x.id, x]));
  const currency = process.env.PAYOUT_CURRENCY || card.currency;
  const items = (decision.items ?? []).map((i) => {
    const of = byId.get(i.official_id)!;
    return { receiver: emailFor(of), amount: money(i.amount), currency, note: `Game ${game.number}, ${matchup(game)}, ${i.role === "referee" ? "referee" : "table official"}. Northside Youth Basketball, Northside Invitational 2026.`, senderItemId: senderItemId(`${tournament.slug}-${o.runId}`, game, i.official_id), official_id: i.official_id, role: i.role };
  });
  const record: LedgerPayout = {
    gameId: game.id, number: game.number, senderBatchId: sbid, batchId: null, status: "NOT_SENT",
    items: items.map((i) => ({ official_id: i.official_id, role: i.role, amount: i.amount, receiver: i.receiver })),
    finalAt: o.finalAt.toISOString(), createdAt: new Date().toISOString(), decidedBy: o.scripted ? "script" : "agent", provisional: card.provisional,
  };

  if (o.paypal === "off") {
    const err: StructuredError = { isError: true, errorCategory: "permission", isRetryable: false, message: "PayPal is switched off in this run: the agent decided to pay and nothing could be sent." };
    event(ledger, "no_paypal", { gameId: game.id, number: game.number });
    return done({ outcome: "error", error: err, folded, guard: verdict, payout: { senderBatchId: sbid, batchId: null, status: "NOT_SENT", completedAt: null, secondsFromBuzzer: null, items: record.items } });
  }
  if (o.paypal === "dry") {
    record.status = "DRY_RUN"; ledger.payouts[sbid] = record;
    return done({ outcome: "dry", folded, guard: verdict, payout: { senderBatchId: sbid, batchId: null, status: "DRY_RUN", completedAt: null, secondsFromBuzzer: null, items: record.items } });
  }

  const created = await createPayout(sbid, items, "Northside Youth Basketball: officials' pay", `Thank you for officiating game ${game.number} at the Northside Invitational.`);
  if (isPayoutError(created)) {
    if (created.errorCategory === "duplicate") {
      const reason = created.message;
      ledger.holds[game.id] = { gameId: game.id, number: game.number, at: new Date().toISOString(), reason, question: `Game ${game.number} already shows a payout on PayPal (${created.existingBatchId ?? "batch id not given"}). Nothing more was sent. Confirm?`, flags: { ...decision.flags, already_paid: true }, by: "paypal" };
      event(ledger, "paypal_duplicate", { gameId: game.id, number: game.number, detail: created.existingBatchId });
      return done({ outcome: "blocked", blockedBy: "paypal", guard: verdict, error: created, hold: { question: ledger.holds[game.id].question, reason } });
    }
    record.status = `ERROR_${created.errorCategory.toUpperCase()}`; ledger.payouts[sbid] = record;
    event(ledger, "paypal_error", { gameId: game.id, number: game.number, detail: created.message });
    return done({ outcome: "error", error: created, folded, guard: verdict, payout: { senderBatchId: sbid, batchId: null, status: record.status, completedAt: null, secondsFromBuzzer: null, items: record.items } });
  }
  record.batchId = created.batchId; record.status = created.status; ledger.payouts[sbid] = record;
  event(ledger, "payout_created", { gameId: game.id, number: game.number, detail: created.batchId });

  const final = await waitForPayout(created.batchId, { timeoutMs: 90_000, everyMs: 1500 });
  if (isPayoutError(final)) {
    return done({ outcome: "pending", folded, guard: verdict, error: final, payout: { senderBatchId: sbid, batchId: created.batchId, status: record.status, completedAt: null, secondsFromBuzzer: null, items: record.items } });
  }
  const processed = final.items.map((i) => i.timeProcessed).filter(Boolean).sort() as string[];
  const completedAt = final.timeCompleted ?? processed.at(-1) ?? null;
  const seconds = completedAt ? Math.round((new Date(completedAt).getTime() - o.finalAt.getTime()) / 100) / 10 : null;
  record.status = final.status; record.completedAt = completedAt; record.secondsFromBuzzer = seconds;
  record.items = record.items.map((it) => { const live = final.items.find((x) => x.senderItemId.endsWith(it.official_id)); return { ...it, status: live?.status, timeProcessed: live?.timeProcessed }; });
  ledger.payouts[sbid] = record;
  event(ledger, final.status === "SUCCESS" ? "paid" : "payout_" + final.status.toLowerCase(), { gameId: game.id, number: game.number, detail: { seconds, status: final.status } });
  return done({
    outcome: final.status === "SUCCESS" ? "paid" : "pending",
    folded, guard: verdict,
    payout: { senderBatchId: sbid, batchId: created.batchId, status: final.status, completedAt, secondsFromBuzzer: seconds, items: record.items },
  });
}
