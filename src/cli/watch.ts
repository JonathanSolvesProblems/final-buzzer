import "../env.ts";
/**
 * The agent on duty: watches the scorer's app and acts the moment a game goes final.
 *
 *   node src/cli/watch.ts                 # watches http://localhost:4173/api/tournament
 *   TOURNAMENT_URL=https://.../api/tournament node src/cli/watch.ts
 *
 * Every save the app makes bumps the document's version; the watcher polls with ?v= so an unchanged
 * document costs a 304. A game that turns final or forfeit runs the buzzer agent once, with the
 * app's own save time as the buzzer. A game that was final, went back to scheduled and came back
 * final is reported to the agent as a reopened score.
 *
 * Whatever happens to a run (the day's demo budget spent, the model unreachable, a crash), the game
 * ends up paid, folded or held with the reason on the board, never stuck on "agent working". On
 * start it also picks up any game that went final while it was away (a redeploy, a restart).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { loadFromUrl, type Game, type Tournament } from "../app/feed.ts";
import { loadSheet, loadRateCard } from "../agent/sheet.ts";
import { loadLedger, saveLedger, type Ledger } from "../ledger.ts";
import { runBuzzer, holdWithoutRun, type PayPalMode } from "../agent/buzzer.ts";
import { summarise } from "./report.ts";
import { spendModelRun, peekBudget } from "../budget.ts";

const docUrl = process.env.TOURNAMENT_URL ?? "http://localhost:4173/api/tournament";
const paypal = ((process.argv.includes("--paypal") ? process.argv[process.argv.indexOf("--paypal") + 1] : undefined) ?? (process.env.PAYPAL_CLIENT_ID ? "live" : "dry")) as PayPalMode;
const runId = process.env.RUN_ID ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const ledgerPath = process.env.LEDGER ?? `results/ledger${paypal === "live" ? "" : "-" + paypal}.json`;
const sheet = await loadSheet(); const card = await loadRateCard();

// the scorer's app may still be starting (in the deployed stack the two containers start together)
let t = null as unknown as Tournament;
for (let attempt = 1; !t; attempt++) {
  try { const got = await loadFromUrl(docUrl, { auth: process.env.TOURNAMENT_AUTH }); if (got) t = got; }
  catch (e) { if (attempt === 1 || attempt % 10 === 0) console.log(`waiting for ${docUrl}: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 2000)); }
}
const seen = new Map<string, string>(t.games.map((g) => [g.id, g.status]));
const wasFinal = new Set<string>(t.games.filter((g) => g.status !== "scheduled").map((g) => g.id));
console.log(`watching ${docUrl} (version ${t.version}), ${t.games.length} games, paypal ${paypal}, run ${runId}, ledger ${ledgerPath}`);
await mkdir("results/live", { recursive: true });

const covered = (l: Ledger, id: string) => Object.values(l.payouts).some((p) => p.gameId === id) || !!l.holds[id] || Object.values(l.folds).flat().some((f) => f.gameId === id);

// a heartbeat every 30 s, so the board can say whether the agent is on duty (served at /api/agent)
const HEARTBEAT = process.env.HEARTBEAT_FILE ?? "results/agent.json";
let lastBeat = 0;
async function beat(): Promise<void> {
  if (Date.now() - lastBeat < 30_000) return;
  lastBeat = Date.now();
  await writeFile(HEARTBEAT, JSON.stringify({ at: new Date().toISOString(), paypal, runId, version: t.version, budget: await peekBudget() }, null, 2) + "\n").catch((e) => console.log(`heartbeat not written: ${(e as Error).message}`));
}
await beat();

/** One game that went final: the day's budget, the agent, the ledger. Ends in the ledger whatever happens. */
async function handle(g: Game, previousStatus: string, finalAt: Date): Promise<void> {
  const ledger = await loadLedger(ledgerPath, t.slug);
  console.log(`${finalAt.toISOString()} game ${g.number} ${g.status}: ${g.home} v ${g.away}, ${g.court}`);
  const budget = await spendModelRun(`game ${g.number}`);
  if (!budget.ok) {
    console.log(`  held without a run: ${budget.message}`);
    holdWithoutRun(ledger, g, card, budget.message);
    await saveLedger(ledgerPath, ledger);
    return;
  }
  try {
    const r = await runBuzzer({ tournament: t, game: g, sheet, card, ledger, finalAt, runId, paypal, previousStatus,
      onStep: (s) => { if (s.kind === "tool") console.log(`  ${String(s.ms).padStart(6)} ms  ${s.name}${s.name === "decide" ? "  -> " + JSON.stringify((s.input as any).choice) : ""}`); } });
    await saveLedger(ledgerPath, ledger);
    await writeFile(`results/live/${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}-g${g.number}.json`, JSON.stringify(r, null, 2) + "\n");
    console.log("  " + summarise(r));
  } catch (e) {
    const reason = `The agent's run failed: ${(e as Error).message}.`;
    console.log(`  ${reason}`);
    // a payout PayPal already accepted stays as it is (the webhook or a reconcile finishes it); anything else is held for Sam
    if (!Object.values(ledger.payouts).some((p) => p.gameId === g.id)) holdWithoutRun(ledger, g, card, reason);
    await saveLedger(ledgerPath, ledger);
  }
}

// games that went final while the agent was away: saved on the scorer's page, nothing in the ledger for them
{
  const ledger = await loadLedger(ledgerPath, t.slug);
  const missed = t.games.filter((g) => g.status !== "scheduled" && g.finalAt && !covered(ledger, g.id));
  for (const g of missed) { console.log(`game ${g.number} went ${g.status} while the agent was away`); await handle(g, "scheduled", new Date(g.finalAt!)); }
}

for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  await beat();
  let next;
  try { next = await loadFromUrl(docUrl, { version: t.version, auth: process.env.TOURNAMENT_AUTH }); }
  catch (e) { console.log(`${new Date().toISOString()} feed unreachable: ${(e as Error).message}`); continue; }
  if (!next) continue;
  t = next;
  const changed: Game[] = t.games.filter((g) => seen.get(g.id) !== g.status);
  for (const g of changed) {
    const before = seen.get(g.id) ?? "scheduled";
    seen.set(g.id, g.status);
    if (g.status === "scheduled") { console.log(`game ${g.number} reopened (${before} -> scheduled)`); continue; }
    const previousStatus = wasFinal.has(g.id) && before === "scheduled" ? "final" : before;
    wasFinal.add(g.id);
    await handle(g, previousStatus, g.finalAt ? new Date(g.finalAt) : new Date());
  }
}
