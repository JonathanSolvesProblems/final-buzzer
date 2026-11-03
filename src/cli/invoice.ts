import "../env.ts";
/**
 * Invoice every team for the entry fee through the PayPal MCP server (create_invoice, send_invoice).
 * Idempotent: a team with an invoice id in results/invoices.json is skipped.
 *
 *   node src/cli/invoice.ts            # all teams
 *   node src/cli/invoice.ts --limit 3
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connectPayPalMcp } from "../paypal/mcp.ts";
import { invoiceArgs, invoiceIdFrom, type Fees, type TeamRecord } from "../agent/invoices.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []).filter((x) => x.length));
const fees: Fees = JSON.parse(await readFile("data/fees.json", "utf8"));
const teams = JSON.parse(await readFile("data/teams-2026.json", "utf8"));
const path = "results/invoices.json";
const records: Record<string, TeamRecord> = await readFile(path, "utf8").then((s) => JSON.parse(s).records, () => ({}));
const limit = Number(args.limit ?? 0);
const mcp = await connectPayPalMcp(["invoices.create", "invoices.send", "invoices.get"]);
let n = 0;
try {
  for (const t of teams.teams) {
    if (limit && n >= limit) break;
    const r: TeamRecord = records[t.id] ?? {
      team_id: t.id, team: t.name, division: t.division, manager_email: t.manager_email, manager_name: t.manager_name,
      invoice_id: null, invoice_number: `NYB26-${String(teams.teams.indexOf(t) + 1).padStart(3, "0")}`, amount: fees.entry_fee_per_team.toFixed(2), currency: fees.currency,
      status: "draft", sent_at: null, due_date: fees.deadline, reminders: [], replies: [], history: "no record",
    };
    if (!r.invoice_id) r.invoice_number = `NYB26-${String(teams.teams.indexOf(t) + 1).padStart(3, "0")}`; // PayPal caps invoice numbers at 24 characters
    records[t.id] = r;
    if (r.invoice_id && r.status !== "draft") { continue; }
    n++;
    if (!r.invoice_id) {
      const created: any = await mcp.call("create_invoice", invoiceArgs(r, fees, r.invoice_number, Number(r.amount), `${r.division} entry fee`, r.due_date));
      const id = invoiceIdFrom(created);
      if (!id) { console.log(`${r.team} (${r.division}): create failed: ${JSON.stringify(created).slice(0, 300)}`); await save(); continue; }
      r.invoice_id = id;
      await save();
    }
    const sent: any = await mcp.call("send_invoice", { invoice_id: r.invoice_id, send_to_recipient: true, note: `Hi ${r.manager_name}, here is the ${r.division} entry fee for the Northside Invitational, due ${r.due_date}.` });
    if (sent?.isError) { console.log(`${r.team}: send failed: ${sent.message}`); await save(); continue; }
    r.status = "sent"; r.sent_at = teams.invoices_sent_on ?? new Date().toISOString().slice(0, 10);
    await save();
    console.log(`${r.team} (${r.division}): invoice ${r.invoice_number} sent as ${r.invoice_id}`);
  }
} finally { await mcp.close(); }
console.log(`${n} invoice(s) handled; ${Object.values(records).filter((r) => r.status === "sent").length} sent in total`);

async function save() { await mkdir("results", { recursive: true }); await writeFile(path, JSON.stringify({ updated: new Date().toISOString(), fees: { provisional: fees.provisional, entry_fee_per_team: fees.entry_fee_per_team, currency: fees.currency }, records }, null, 2) + "\n"); }
