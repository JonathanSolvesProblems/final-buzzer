/**
 * The honesty check: every figure the write-up states must exist in a results file, and no retired
 * claim may come back. Fails the build when the prose and the data disagree.
 *
 *   node src/cli/check-claims.ts            # exit 1 on any mismatch
 *
 * What it checks:
 *   1. results/buzzer-replay.json exists and finished, or the write-up makes no measured claim; a live
 *      payout has been recorded (results/first-live-run.json).
 *   2. Every figure README.md and DEMO-SCRIPT.md state in a phrase this file knows (games paid, officials,
 *      dollars, seconds, holds, folds, the evening batch, the reconciliation, the invoices and the chase,
 *      the re-plan) matches the file that produced it. A phrase that is absent is not checked, so the
 *      wording stays free; a phrase that is present must carry the data's number. The model cost
 *      estimates are the one figure not covered: they are priced, not measured.
 *   3. Banned claims never appear: "production", "real money", an unsourced "most clubs", "every official
 *      was paid" while games were held, "Sam's rate card" while the card is provisional.
 */
import { readFile } from "node:fs/promises";

const problems: string[] = [];
let checked = 0;
const say = (s: string) => problems.push(s);
const read = (p: string) => readFile(p, "utf8").catch(() => null);
const readJson = async (p: string) => { const t = await read(p); return t ? JSON.parse(t) : null; };
const num = (s: string) => Number(s.replace(/,/g, ""));

const readme = (await read("README.md")) ?? "";
const script = (await read("DEMO-SCRIPT.md")) ?? "";
const slides = (await read("devpost/slides/slides.py")) ?? "";
const docs = [["README.md", readme], ["DEMO-SCRIPT.md", script], ["devpost/slides/slides.py", slides]] as const;
const card = JSON.parse((await read("data/rate-card.json"))!);
const replay = await readJson("results/buzzer-replay.json");
const first = await read("results/first-live-run.json");
const reconcile = await readJson("results/reconcile.json");
const chase = await readJson("results/chase.json");
const invoices = await readJson("results/invoices.json");
const replan = await readJson("results/replan.json");
const settle = await readJson("results/settle-2026-05-16.json");
const postman = await read("results/postman-run.txt");

/** Every match of `re` in `text` must carry `want` in its capture groups (null skips a group). */
function figure(name: string, text: string, re: RegExp, want: Array<number | null>, where: string) {
  for (const m of text.matchAll(re)) {
    checked++;
    m.slice(1).forEach((got, i) => { const w = want[i]; if (w != null && Math.abs(num(got) - w) > 0.05) say(`${name}: "${m[0]}" says ${got}, ${where} says ${w}`); });
  }
}

// 1. measured claims need a finished replay and a recorded live payout
const measured = /measured|median of \d|(\d+(\.\d+)?) s after the buzzer across|88 of 88/i;
if (measured.test(readme) && !(replay && replay.finished)) say("README makes a measured claim but results/buzzer-replay.json is missing or unfinished");
if (!first) say("results/first-live-run.json does not exist: no live payout has been recorded yet");

// 2. the figures, phrase by phrase, against the file that produced each
if (replay && replay.finished) {
  const s = replay.seconds_from_buzzer, p = replay.payouts;
  for (const [name, text] of docs) {
    figure(name, text, /median (?:of )?(\d+(?:\.\d+)?)\s?s/gi, [s.median], "the replay");
    figure(name, text, /(\d+) of 88 games paid/gi, [p.games_paid], "the replay");
    figure(name, text, /(\d+) games paid, a median/gi, [p.games_paid], "the replay");
    figure(name, text, /\$([\d,]+(?:\.\d+)?) (?:CAD )?(?:moved|paid out)/gi, [p.dollars], "the replay");
  }
  const distinct = new Set(replay.per_game.flatMap((g: any) => g.payout?.status === "SUCCESS" ? g.payout.items.map((i: any) => i.official_id) : [])).size;
  figure("README.md", readme, /(\d+) of Saturday's (\d+), (\d+) payments to (\d+) officials/g, [p.games_paid, replay.games_run, p.officials_paid, distinct], "the replay");
  for (const [name, text] of docs) if (/\b81 officials\b/.test(text)) say(`${name} says 81 officials: there are 81 payments to ${distinct} officials`);
  figure("README.md", readme, /fastest ([\d.]+) s, slowest ([\d.]+) s/g, [s.min, s.max], "the replay");
  figure("README.md", readme, /\| Held for Sam \| (\d+):/g, [replay.outcomes.held], "the replay");
  figure("README.md", readme, /(\d+) shares folded during the day/g, [replay.folds], "the replay");
  if (replay.rate_card?.provisional && /Sam's (own )?rate card confirms|on Sam's card\b/i.test(readme)) say("README credits Sam's rate card while data/rate-card.json is still provisional");
}
if (settle) {
  const items = settle.settled.flatMap((b: any) => b.items);
  const dollars = items.reduce((t: number, i: any) => t + Number(i.amount), 0);
  figure("README.md", readme, /one payout per official, \$([\d,]+)/g, [dollars], "the settle file");
  figure("README.md", readme, /(\d+) shares folded during the day/g, [items.length], "the settle file");
}
if (reconcile) {
  figure("README.md", readme, /all (\d+) payout items/g, [reconcile.matched_items], "the reconcile file");
  figure("README.md", readme, /across (\d+) games and/g, [reconcile.games_confirmed_by_paypal], "the reconcile file");
  figure("README.md", readme, /\$([\d,]+) CAD, with \$([\d.]+) in PayPal payout fees/g, [reconcile.dollars_confirmed_by_paypal, reconcile.payout_fees], "the reconcile file");
}
if (chase && invoices) {
  const recs = Object.values(invoices.records) as Array<{ status: string }>;
  const paid = recs.filter((r) => r.status === "paid").length;
  figure("README.md", readme, /all (\d+) teams invoiced/g, [recs.length], "the invoices file");
  figure("README.md", readme, /\| Teams paid \| (\d+) of (\d+)/g, [paid, recs.length], "the invoices file");
  figure("README.md", readme, /\| Reminders \| (\d+)/g, [chase.outcomes.reminded], "the chase file");
  figure("README.md", readme, /\| Split \| (\d+)/g, [chase.outcomes.split], "the chase file");
  figure("README.md", readme, /\| Released \| (\d+)/g, [chase.outcomes.released], "the chase file");
  figure("README.md", readme, /(\d+) of (\d+) teams paid/g, [paid, recs.length], "the invoices file");
}
if (replan) {
  figure("README.md", readme, /\| Games moved \| (\d+) of (\d+)/g, [replan.applied.length, replan.affected.length], "the replan file");
  figure("README.md", readme, /\| Cannot be played \| (\d+)/g, [replan.unplayable.length], "the replan file");
  figure("README.md", readme, /\| Refunds \| (\d+) × \$(\d+)/g, [replan.refunds.length, Number(replan.refunds[0]?.amount ?? NaN)], "the replan file");
  figure("README.md", readme, /moved (\d+) of (\d+) affected games/g, [replan.applied.length, replan.affected.length], "the replan file");
}

// 3. claims that must never appear
// the public checks: the README's request and assertion counts, and "0 failures", come from newman's last run
if (!postman && /\d+ requests and \d+ assertions/.test(readme)) say("README states the public checks' counts but results/postman-run.txt is missing");
if (postman) {
  const plain = postman.replace(/│/g, "|");
  const req = plain.match(/requests\s*\|\s*(\d+)\s*\|\s*(\d+)/), asr = plain.match(/assertions\s*\|\s*(\d+)\s*\|\s*(\d+)/);
  if (!req || !asr) say("results/postman-run.txt: newman's summary table was not found");
  else {
    figure("postman", readme, /(\d+) requests and (\d+) assertions/g, [num(req[1]), num(asr[1])], "results/postman-run.txt");
    if ((num(asr[2]) > 0 || num(req[2]) > 0) && /0 failures/.test(readme)) say(`README says 0 failures; results/postman-run.txt records ${asr[2]} failed assertions`);
  }
}

const banned: Array<[RegExp, string]> = [
  [/real money|live PayPal|production PayPal/i, "the build runs on sandbox test money only"],
  [/\bno human in the loop\b/i, "Sam is in the loop by design"],
  [/every official (was|got) paid/i, "held games are not paid; say how many were"],
  [/most clubs/i, "no source says how most clubs pay; say how the composite's teams paid"],
  [/(fixed |scripted |the )rule[^.]*(paid|pays)[^.]*(a second time|twice|duplicate)|swap the agent for a fixed rule/i, "the scripted ablation never reads PayPal, so it does not test the duplicate; credit the model only with the folds, the PayPal read and Sam's question"],
];
for (const [re, why] of banned) for (const [name, text] of docs) if (re.test(text)) say(`${name}: "${text.match(re)![0]}" (${why})`);
if (card.provisional && /\$45 a ref.*Sam confirmed/i.test(readme)) say("README says Sam confirmed the card; data/rate-card.json says provisional");

if (problems.length) { console.error("check-claims: " + problems.length + " problem(s)\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`check-claims: the write-up agrees with the results, ${checked} figures checked` + (replay ? ` (replay ${replay.run_id}: ${replay.payouts.games_paid} games paid, median ${replay.seconds_from_buzzer.median} s)` : " (no replay yet, no measured claims made)"));
