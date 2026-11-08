/**
 * A daily cap on model runs for the public deployment. The board, the scorer's page and the closure
 * control are open to anyone with the link, and each agent run spends real model credit, so the
 * deployed agent refuses politely once the day's runs are used. Unset MODEL_RUNS_PER_DAY means no cap
 * (local runs, replays). The count lives in one file both containers can read, so the scorer's page
 * can say up front when a saved game will be held rather than paid.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FILE = process.env.BUDGET_FILE ?? "results/budget.json";
const limitNow = () => (process.env.MODEL_RUNS_PER_DAY ? Number(process.env.MODEL_RUNS_PER_DAY) : null);
type Book = { day: string; used: number; log: Array<{ at: string; kind: string }> };

async function book(): Promise<Book> {
  const day = new Date().toISOString().slice(0, 10);
  try { const s = JSON.parse(await readFile(FILE, "utf8")); if (s.day === day) return s; } catch { /* first run of the day */ }
  return { day, used: 0, log: [] };
}
export const restingMessage = (limit: number) => `Today's demo budget of ${limit} agent runs is used up; it resets at midnight UTC.`;

export interface BudgetAnswer { ok: boolean; used: number; limit: number | null; message: string }
export interface BudgetState { used: number; limit: number | null; exhausted: boolean; message: string | null }

/** The day's count without spending a run. */
export async function peekBudget(): Promise<BudgetState> {
  const limit = limitNow(); const b = await book();
  const exhausted = limit !== null && b.used >= limit;
  return { used: b.used, limit, exhausted, message: exhausted ? restingMessage(limit) : null };
}

/** Spend one run, or refuse with the reason. */
export async function spendModelRun(kind: string): Promise<BudgetAnswer> {
  const limit = limitNow(); const b = await book();
  if (limit !== null && b.used >= limit) return { ok: false, used: b.used, limit, message: restingMessage(limit) };
  b.used += 1; b.log.push({ at: new Date().toISOString(), kind });
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(b, null, 2));
  return { ok: true, used: b.used, limit, message: "" };
}
