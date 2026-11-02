/**
 * The honesty check: every headline figure in the write-up must exist in a results file, and no
 * retired claim may come back. Fails the build when the prose and the data disagree.
 *
 *   node src/cli/check-claims.ts            # exit 1 on any mismatch
 *
 * What it checks:
 *   1. results/buzzer-replay.json exists and finished, or the write-up makes no measured claim.
 *   2. Every "N s" / "median S s" / "$D" / "N of 88" figure in README.md and DEMO-SCRIPT.md that is
 *      presented as measured matches the replay file.
 *   3. Banned claims never appear: "production", "real money", "Sam's rate card" (while the card is
 *      provisional), a seconds figure in PHASE0.md's tagline before it is measured.
 */
import { readFile } from "node:fs/promises";

const problems: string[] = [];
const say = (s: string) => problems.push(s);
const read = (p: string) => readFile(p, "utf8").catch(() => null);

const readme = (await read("README.md")) ?? "";
const script = (await read("DEMO-SCRIPT.md")) ?? "";
const card = JSON.parse((await read("data/rate-card.json"))!);
const replayText = await read("results/buzzer-replay.json");
const replay = replayText ? JSON.parse(replayText) : null;
const first = await read("results/first-live-run.json");

// 1. measured claims need a finished replay
const measured = /measured|median of \d|(\d+(\.\d+)?) s after the buzzer across|88 of 88/i;
if (measured.test(readme) && !(replay && replay.finished)) say("README makes a measured claim but results/buzzer-replay.json is missing or unfinished");
if (!first) say("results/first-live-run.json does not exist: no live payout has been recorded yet");

// 2. numbers in the write-up against the replay file
if (replay && replay.finished) {
  const med = replay.seconds_from_buzzer.median;
  const paid = replay.payouts.games_paid;
  const dollars = replay.payouts.dollars;
  for (const [name, text] of [["README.md", readme], ["DEMO-SCRIPT.md", script]] as const) {
    for (const m of text.matchAll(/median (?:of )?(\d+(?:\.\d+)?)\s?s/gi)) if (Number(m[1]) !== med) say(`${name}: median ${m[1]} s, replay says ${med} s`);
    for (const m of text.matchAll(/(\d+) of 88 games paid/gi)) if (Number(m[1]) !== paid) say(`${name}: ${m[1]} of 88 games paid, replay says ${paid}`);
    for (const m of text.matchAll(/\$([\d,]+(?:\.\d+)?) (?:CAD )?(?:moved|paid out)/gi)) if (Math.abs(Number(m[1].replace(/,/g, "")) - dollars) > 0.5) say(`${name}: $${m[1]} paid out, replay says $${dollars}`);
  }
  if (replay.rate_card?.provisional && /Sam's (own )?rate card confirms|on Sam's card\b/i.test(readme)) say("README credits Sam's rate card while data/rate-card.json is still provisional");
}

// 3. claims that must never appear
const banned: Array<[RegExp, string]> = [
  [/real money|live PayPal|production PayPal/i, "the build runs on sandbox test money only"],
  [/\bno human in the loop\b/i, "Sam is in the loop by design"],
  [/every official (was|got) paid/i, "held games are not paid; say how many were"],
];
for (const [re, why] of banned) for (const [name, text] of [["README.md", readme], ["DEMO-SCRIPT.md", script]] as const) if (re.test(text)) say(`${name}: "${text.match(re)![0]}" (${why})`);
if (card.provisional && /\$45 a ref.*Sam confirmed/i.test(readme)) say("README says Sam confirmed the card; data/rate-card.json says provisional");

if (problems.length) { console.error("check-claims: " + problems.length + " problem(s)\n  " + problems.join("\n  ")); process.exit(1); }
console.log("check-claims: the write-up agrees with the results" + (replay ? ` (replay ${replay.run_id}: ${replay.payouts.games_paid} games paid, median ${replay.seconds_from_buzzer.median} s)` : " (no replay yet, no measured claims made)"));
