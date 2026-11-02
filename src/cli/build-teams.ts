/**
 * The teams to invoice: every team in the real 2026 document, one manager address each (sandbox),
 * plus what the chase replay stages and labels: when each team pays (recorded on its PayPal invoice
 * as an e-transfer, the way most clubs still pay), one manager who asks to pay in two parts, and one
 * division with a waitlisted team behind a manager who never answers.
 *
 * Usage: node src/cli/build-teams.ts  ->  data/teams-2026.json
 */
import { readFile, writeFile } from "node:fs/promises";

const doc = JSON.parse(await readFile("data/tournament-2026.json", "utf8"));
const fees = JSON.parse(await readFile("data/fees.json", "utf8"));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const teams: Array<{ id: string; division: string; name: string; manager_email: string; manager_name: string }> = [];
for (const d of doc.divisions) for (const t of d.teams) {
  teams.push({ id: `${slug(d.name)}-${slug(t.name)}`, division: d.name, name: t.name, manager_email: `team-${slug(d.name)}-${slug(t.name)}@example.com`, manager_name: `${t.name} team manager` });
}
const split = teams.find((t) => t.division === "Cadet Boys")!;
const silent = teams.find((t) => t.division === "Bantam Boys")!;
const sent = addDays(fees.deadline, -21);           // invoices go out three weeks before the deadline

// who pays when: most within two weeks, a few only after a reminder, the split team in two parts, the silent team never
const payments: Array<{ team_id: string; on: string; amount: "full" | "deposit" | "balance"; method: string; staged: true }> = [];
teams.forEach((t, i) => {
  if (t.id === split.id || t.id === silent.id) return;
  const late = i % 9 === 0;                            // every ninth team pays only after the first reminder
  payments.push({ team_id: t.id, on: late ? addDays(fees.deadline, 1) : addDays(sent, 2 + (i * 7) % 12), amount: "full", method: late ? "e-transfer after a reminder" : "e-transfer", staged: true });
});
payments.push({ team_id: split.id, on: addDays(sent, 6), amount: "deposit", method: "e-transfer", staged: true });
payments.push({ team_id: split.id, on: addDays(fees.deadline, 12), amount: "balance", method: "e-transfer", staged: true });

const out = {
  generated: new Date().toISOString(),
  note: "Teams are the real entries in the 2026 document. Manager addresses, payment dates, the reply and the waitlist are staged for the chase replay and labelled here.",
  invoices_sent_on: sent,
  teams,
  staged: {
    payments,
    reply_asks_to_split: { team_id: split.id, team: split.name, division: split.division, on: addDays(sent, 4), reply: "Hi, can we pay in two parts? Half now and the rest closer to the tournament. Thanks." },
    silent_with_waitlist: { team_id: silent.id, team: silent.name, division: silent.division, note: "No reply to the invoice or any reminder." },
  },
  waitlist: [
    { id: "bantam-boys-waitlist-1", division: "Bantam Boys", name: "Waitlist team 1 (staged)", manager_email: "team-bantam-boys-waitlist-1@example.com", manager_name: "Waitlist team 1 manager" },
  ],
};
await writeFile("data/teams-2026.json", JSON.stringify(out, null, 2) + "\n");
console.log(`${teams.length} teams; invoices sent ${sent}, deadline ${fees.deadline}; ${payments.length} staged payments; split on ${split.name} (${split.division}); silence on ${silent.name} (${silent.division}) with one waitlisted team`);
