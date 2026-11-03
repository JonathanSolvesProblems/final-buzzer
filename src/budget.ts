/**
 * A daily cap on model runs for the public deployment. The board, the scorer's page and the closure
 * control are open to anyone with the link, and each agent run spends real model credit, so the
 * deployed agent refuses politely once the day's runs are used. Unset MODEL_RUNS_PER_DAY means no cap
 * (local runs, replays).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FILE = process.env.BUDGET_FILE ?? "results/budget.json";

export interface BudgetAnswer { ok: boolean; used: number; limit: number | null; message: string }

export async function spendModelRun(kind: string): Promise<BudgetAnswer> {
  const limit = process.env.MODEL_RUNS_PER_DAY ? Number(process.env.MODEL_RUNS_PER_DAY) : null;
  const day = new Date().toISOString().slice(0, 10);
  let b: { day: string; used: number; log: Array<{ at: string; kind: string }> } = { day, used: 0, log: [] };
  try { const s = JSON.parse(await readFile(FILE, "utf8")); if (s.day === day) b = s; } catch { /* first run of the day */ }
  if (limit !== null && b.used >= limit) {
    return { ok: false, used: b.used, limit, message: `Today's demo budget of ${limit} agent runs is used up, so the agent is resting until midnight UTC. The board still shows every earlier result.` };
  }
  b.used += 1; b.log.push({ at: new Date().toISOString(), kind });
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(b, null, 2));
  return { ok: true, used: b.used, limit, message: "" };
}
