import "../env.ts";
/**
 * The daily chase: for each unpaid entry-fee invoice, the agent decides wait, remind, split, release
 * or hold, and executes it through the PayPal MCP server.
 *
 *   node src/cli/chase.ts --today 2026-04-28          # one day, as the cron would run it
 *   node src/cli/chase.ts --from 2026-04-10 --to 2026-05-10
 *       # the replay: day by day, applying the staged payments (recorded on PayPal as e-transfers)
 *       # and the staged reply, running the agent only where a decision is due
 *
 * Results: results/chase.json (every decision, in order) and results/invoices.json (the records).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connectPayPalMcp, type PayPalMcp } from "../paypal/mcp.ts";
import { recordExternalPayment, getInvoiceRest } from "../paypal/invoicing.ts";
import { runChase, addDays, type ChaseResult, type Fees, type TeamRecord } from "../agent/invoices.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []).filter((x) => x.length));
const fees: Fees = JSON.parse(await readFile("data/fees.json", "utf8"));
const teams = JSON.parse(await readFile("data/teams-2026.json", "utf8"));
const path = "results/invoices.json";
const stored = JSON.parse(await readFile(path, "utf8"));
const records: Record<string, TeamRecord> = stored.records;
const paypal = String(args.paypal ?? "live");
const mcp: PayPalMcp | null = paypal === "live" ? await connectPayPalMcp(["invoices.create", "invoices.send", "invoices.sendReminder", "invoices.cancel", "invoices.get"]) : null;
const results: ChaseResult[] = await readFile("results/chase.json", "utf8").then((s) => JSON.parse(s).decisions ?? [], () => []);
const days: string[] = args.from ? range(String(args.from), String(args.to ?? args.from)) : [String(args.today ?? new Date().toISOString().slice(0, 10))];
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

try {
  for (const today of days) {
    // the world moves: staged payments land on PayPal, the staged reply arrives
    if (args.from) {
      for (const p of teams.staged.payments.filter((x: any) => x.on === today)) {
        const r = records[p.team_id]; if (!r || !r.invoice_id) continue;
        const target = p.amount === "full" ? r.invoice_id : (r.children?.[p.amount === "deposit" ? 0 : 1] ?? null);
        if (!target) continue;
        const value = p.amount === "full" ? r.amount : (Number(r.amount) * (p.amount === "deposit" ? fees.deposit_share : 1 - fees.deposit_share)).toFixed(2);
        if (mcp) {
          const rec = await recordExternalPayment(target, { currency_code: r.currency, value }, today, `${p.method}, recorded by the association (staged for the replay)`);
          if ("isError" in rec) console.log(`${today}  ${r.team}: could not record payment: ${rec.message}`);
        }
        if (p.amount !== "deposit") r.status = "paid";
        console.log(`${today}  ${r.team} (${r.division}) paid the ${p.amount} by ${p.method}`);
      }
      const reply = teams.staged.reply_asks_to_split;
      if (reply.on === today && records[reply.team_id]) records[reply.team_id].replies.push({ at: today, text: reply.reply, staged: true });
    }
    // the agent runs where a decision is due: unpaid, and within ten days of the deadline or past it, or a reply arrived
    for (const r of Object.values(records)) {
      if (!["sent", "split"].includes(r.status) || !r.invoice_id) continue;
      if (r.sent_at && today < r.sent_at) continue;
      const due = daysBetween(today, r.due_date);
      const replied = r.replies.some((x) => x.at === today);
      if (!replied && due > 10) continue;
      if (!replied && r.reminders.at(-1) && daysBetween(r.reminders.at(-1)!, today) < fees.reminder.every_days && due > -fees.release.after_days_past_deadline) continue;
      if (mcp) { // PayPal's status wins before the agent is even asked
        const view = await getInvoiceRest(r.invoice_id);
        if (!("isError" in view) && view.status === "PAID") { r.status = "paid"; console.log(`${today}  ${r.team}: PayPal shows PAID`); continue; }
      }
      const res = await runChase({ record: r, fees, waitlist: teams.waitlist, today, mcp });
      results.push(res);
      console.log(`${today}  ${r.team} (${r.division}): ${res.outcome}${res.decision ? ", " + res.decision.reason.slice(0, 120) : ""}${res.hold ? " | " + (res.hold.question ?? res.hold.reason) : ""}`);
      await save();
    }
    await save();
  }
} finally { await mcp?.close(); }

const counts: Record<string, number> = {};
for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
const statuses: Record<string, number> = {};
for (const r of Object.values(records)) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log(`\ndecisions: ${JSON.stringify(counts)}  invoices: ${JSON.stringify(statuses)}`);

async function save() {
  await mkdir("results", { recursive: true });
  await writeFile(path, JSON.stringify({ ...stored, updated: new Date().toISOString(), records }, null, 2) + "\n");
  const counts: Record<string, number> = {}; for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  await writeFile("results/chase.json", JSON.stringify({ updated: new Date().toISOString(), paypal: paypal === "live" ? "sandbox" : paypal, days, outcomes: counts, staged: teams.staged, fees: { provisional: fees.provisional }, decisions: results }, null, 2) + "\n");
}
function range(a: string, b: string): string[] { const out: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
