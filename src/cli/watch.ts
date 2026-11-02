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
 */
import { mkdir, writeFile } from "node:fs/promises";
import { loadFromUrl, type Game } from "../app/feed.ts";
import { loadSheet, loadRateCard } from "../agent/sheet.ts";
import { loadLedger, saveLedger } from "../ledger.ts";
import { runBuzzer, type PayPalMode } from "../agent/buzzer.ts";
import { summarise } from "./report.ts";

const docUrl = process.env.TOURNAMENT_URL ?? "http://localhost:4173/api/tournament";
const paypal = ((process.argv.includes("--paypal") ? process.argv[process.argv.indexOf("--paypal") + 1] : undefined) ?? (process.env.PAYPAL_CLIENT_ID ? "live" : "dry")) as PayPalMode;
const runId = process.env.RUN_ID ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const ledgerPath = process.env.LEDGER ?? `results/ledger${paypal === "live" ? "" : "-" + paypal}.json`;
const sheet = await loadSheet(); const card = await loadRateCard();

let t = (await loadFromUrl(docUrl, { auth: process.env.TOURNAMENT_AUTH }))!;
const seen = new Map<string, string>(t.games.map((g) => [g.id, g.status]));
const wasFinal = new Set<string>(t.games.filter((g) => g.status !== "scheduled").map((g) => g.id));
console.log(`watching ${docUrl} (version ${t.version}), ${t.games.length} games, paypal ${paypal}, run ${runId}, ledger ${ledgerPath}`);
await mkdir("results/live", { recursive: true });

for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
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
    const finalAt = g.finalAt ? new Date(g.finalAt) : new Date();
    const ledger = await loadLedger(ledgerPath, t.slug);
    console.log(`${finalAt.toISOString()} game ${g.number} ${g.status}: ${g.home} v ${g.away}, ${g.court}`);
    const r = await runBuzzer({ tournament: t, game: g, sheet, card, ledger, finalAt, runId, paypal, previousStatus,
      onStep: (s) => { if (s.kind === "tool") console.log(`  ${String(s.ms).padStart(6)} ms  ${s.name}${s.name === "decide" ? "  -> " + JSON.stringify((s.input as any).choice) : ""}`); } });
    await saveLedger(ledgerPath, ledger);
    await writeFile(`results/live/${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}-g${g.number}.json`, JSON.stringify(r, null, 2) + "\n");
    console.log("  " + summarise(r));
  }
}
