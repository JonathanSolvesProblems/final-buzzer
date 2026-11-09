/**
 * Gives the ledger's older records their agent run (what the model read and when it chose), from the
 * traces of the runs that produced them. Records written after this field existed already carry it.
 * A payout is matched by game and the moment the score was saved, a hold by game and the agent's own
 * reason, so nothing is attached to the wrong run.
 *
 *   node src/cli/backfill-agent.ts --extract   # results/trace and results/live -> results/agent-runs.json (committed)
 *   node src/cli/backfill-agent.ts             # results/agent-runs.json -> the ledger at LEDGER (else results/ledger.json)
 *
 * The two steps exist because the deployed image carries results/*.json but not the full traces.
 */
import "../env.ts";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { loadLedger, saveLedger, type AgentRun } from "../ledger.ts";

interface Run { gameId: string; finalAt: string; choice: string | null; reason: string | null; agent: AgentRun }
const RUNS = "results/agent-runs.json";
const LEDGER = process.env.LEDGER ?? "results/ledger.json";

async function traces(dir: string): Promise<any[]> {
  try { return await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(`${dir}/${f}`, "utf8")))); }
  catch { return []; }
}
function compact(r: any): Run | null {
  if (!r?.game?.id || !r.loop || r.loop.model === "scripted" || !Array.isArray(r.trace)) return null;
  const steps = r.trace.filter((s: any) => s.kind === "tool" && s.name).map((s: any) => ({ name: s.name, ms: s.ms }));
  return { gameId: r.game.id, finalAt: r.finalAt, choice: r.decision?.choice ?? null, reason: r.decision?.reason ?? null, agent: { model: r.loop.model, ms: r.loop.ms, calls: r.loop.calls, steps } };
}

if (process.argv.includes("--extract")) {
  const seen = new Set<string>(); const runs: Run[] = [];
  for (const r of [...(await traces("results/trace")), ...(await traces("results/live"))]) {
    const c = compact(r); if (!c) continue;
    const key = `${c.gameId}|${c.finalAt}`; if (seen.has(key)) continue;
    seen.add(key); runs.push(c);
  }
  runs.sort((a, b) => a.finalAt.localeCompare(b.finalAt));
  await writeFile(RUNS, JSON.stringify(runs, null, 1) + "\n");
  console.log(`backfill-agent: ${runs.length} runs written to ${RUNS}`);
} else {
  const runs: Run[] = JSON.parse(await readFile(RUNS, "utf8"));
  const ledger = await loadLedger(LEDGER, "northside-2026");
  let payouts = 0, holds = 0;
  for (const r of runs) {
    const p = Object.values(ledger.payouts).find((x) => x.gameId === r.gameId && x.finalAt === r.finalAt && x.decidedBy === "agent");
    if (p && !p.agent) { p.agent = r.agent; payouts++; }
    const h = ledger.holds[r.gameId];
    if (h && !h.agent && r.choice === "hold" && h.reason === r.reason) { h.agent = r.agent; holds++; }
  }
  if (payouts || holds) await saveLedger(LEDGER, ledger);
  console.log(`backfill-agent: ${runs.length} runs read; ${payouts} payouts and ${holds} holds given their agent run in ${LEDGER}`);
}
