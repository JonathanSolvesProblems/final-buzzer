import "../env.ts";
/**
 * One game, end to end: a final score lands, the agent decides, PayPal pays, the gap is recorded.
 *
 *   node src/cli/live.ts --game 17              # mark game 17 final in the local document, pay
 *   node src/cli/live.ts --game 17 --paypal dry # decide only, no PayPal call
 *   node src/cli/live.ts --game 17 --source url --wait
 *       # watch the scorer's app (TOURNAMENT_URL) until game 17 is saved final on the phone, then pay
 *
 * The first successful live payout is written to results/first-live-run.json; every run goes to
 * results/live/<timestamp>-g<number>.json with the full trace.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { loadFromFile, loadFromUrl, type Tournament } from "../app/feed.ts";
import { loadSheet, loadRateCard } from "../agent/sheet.ts";
import { loadLedger, saveLedger } from "../ledger.ts";
import { runBuzzer, type PayPalMode } from "../agent/buzzer.ts";
import { summarise } from "./report.ts";

const args = parse(process.argv.slice(2));
const source = (args.source as string) ?? "file";
const paypal = ((args.paypal as string) ?? (process.env.PAYPAL_CLIENT_ID ? "live" : "dry")) as PayPalMode;
const runId = (args["run-id"] as string) ?? process.env.RUN_ID ?? stamp();
const ledgerPath = (args.ledger as string) ?? process.env.LEDGER ?? `results/ledger${paypal === "live" ? "" : "-" + paypal}.json`;

let t: Tournament;
let finalAt: Date;
let previousStatus = "scheduled";
let gameNumber = Number(args.game ?? 0);

if (source === "url") {
  const docUrl = (args.url as string) ?? process.env.TOURNAMENT_URL ?? "http://localhost:4173/api/tournament";
  t = (await loadFromUrl(docUrl, { auth: process.env.TOURNAMENT_AUTH }))!;
  if (!gameNumber) throw new Error("--game <number> is required with --source url");
  let g = t.games.find((x) => x.number === gameNumber)!;
  previousStatus = g.status;
  if (g.status === "scheduled") {
    if (!args.wait) throw new Error(`game ${gameNumber} is still scheduled in the scorer's app; pass --wait to watch for the save`);
    process.stdout.write(`watching ${docUrl} for game ${gameNumber} (${g.home} v ${g.away}) to go final`);
    let version = t.version;
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const next = await loadFromUrl(docUrl, { version, auth: process.env.TOURNAMENT_AUTH });
      if (!next) { process.stdout.write("."); continue; }
      version = next.version; t = next; g = t.games.find((x) => x.number === gameNumber)!;
      if (g.status !== "scheduled") break;
    }
    process.stdout.write("\n");
  }
  finalAt = g.finalAt ? new Date(g.finalAt) : new Date(); // the app's own save time when it recorded one
} else {
  t = await loadFromFile((args.file as string) ?? "data/tournament-2026.json");
  const g = gameNumber ? t.games.find((x) => x.number === gameNumber) : t.games.find((x) => x.start.startsWith("2026-05-16") && x.status === "scheduled");
  if (!g) throw new Error(`no game ${gameNumber}`);
  gameNumber = g.number;
  previousStatus = g.status;
  // the save: the scorer's phone would do this in the app; here the harness does it in the local copy
  g.status = (args.forfeit ? "forfeit" : "final");
  g.hs = Number(args.hs ?? 52); g.as = Number(args.as ?? 47);
  if (args.forfeit) { g.hs = 20; g.as = 0; g.note = "forfeit"; }
  finalAt = new Date();
}

const game = t.games.find((x) => x.number === gameNumber)!;
const sheet = await loadSheet(); const card = await loadRateCard();
const ledger = await loadLedger(ledgerPath, t.slug);
console.log(`game ${game.number}: ${game.home} v ${game.away}, ${game.division}, ${game.court}, ${game.status} at ${finalAt.toISOString()} (paypal: ${paypal}, run ${runId})`);

const result = await runBuzzer({
  tournament: t, game, sheet, card, ledger, finalAt, runId, paypal, previousStatus,
  onStep: (s) => {
    if (s.kind === "tool") console.log(`  ${String(s.ms).padStart(6)} ms  ${s.name}${s.name === "decide" ? "  -> " + JSON.stringify((s.input as any).choice) : ""}`);
    else if (s.kind === "model" && s.text) console.log(`  ${String(s.ms).padStart(6)} ms  model: ${s.text.split("\n")[0].slice(0, 110)}`);
  },
});
await saveLedger(ledgerPath, ledger);

await mkdir("results/live", { recursive: true });
const out = `results/live/${stamp()}-g${game.number}.json`;
await writeFile(out, JSON.stringify(result, null, 2) + "\n");
console.log(summarise(result));
console.log(`written ${out}`);
if (result.outcome === "paid" && paypal === "live") {
  const first = "results/first-live-run.json";
  const exists = await access(first).then(() => true, () => false);
  if (!exists) {
    await writeFile(first, JSON.stringify({ recorded: new Date().toISOString(), note: "The first live end-to-end payout: a game from the schedule goes final, the agent chooses pay_now, a PayPal sandbox payout is processed. Seconds are PayPal's completion time against the save time.", ...result }, null, 2) + "\n");
    console.log(`first live run recorded in ${first}`);
  }
}

function parse(argv: string[]): Record<string, string | boolean> {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2), v = argv[i + 1];
    if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true;
  }
  return o;
}
function stamp(): string { return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-"); }
