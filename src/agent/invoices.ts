/**
 * The entry-fee agent: one unpaid invoice, one decision. The model reads PayPal's record through the
 * PayPal MCP server and the association's record through an app tool, then calls `decide_invoice`.
 * Code runs the choice through the guards and executes it through the same MCP server: a reminder,
 * a deposit-and-balance split, or a release to the waitlist.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runLoop, type ToolDef, type TraceStep } from "./loop.ts";
import type { PayPalMcp } from "../paypal/mcp.ts";

export interface Fees { currency: string; provisional: boolean; entry_fee_per_team: number; deposit_share: number; deadline: string; reminder: { every_days: number; max: number }; release: { after_days_past_deadline: number } }
export interface TeamRecord {
  team_id: string; team: string; division: string; manager_email: string; manager_name: string;
  invoice_id: string | null; invoice_number: string; amount: string; currency: string;
  status: "draft" | "sent" | "paid" | "cancelled" | "split" | "released" | "held";
  sent_at: string | null; due_date: string;
  reminders: string[];                   // dates sent
  replies: Array<{ at: string; text: string; staged?: boolean }>;
  children?: string[];                   // invoice ids of a split
  history: string;                       // "no record" until Sam's books arrive
}
export interface WaitlistTeam { id: string; division: string; name: string; manager_email: string; manager_name: string }

export interface InvoiceDecision {
  choice: "wait" | "remind" | "split" | "release" | "hold";
  reason: string;
  question_for_treasurer?: string | null;
  flags: { paid_on_paypal: boolean; replied: boolean; silent: boolean; waitlist_available: boolean; records_disagree: boolean };
}

export const decideInvoiceTool = {
  name: "decide_invoice",
  description: "Record the decision for this team's invoice. Call it exactly once after reading PayPal's record (get_invoice) and the association's record (team_record). wait: nothing today. remind: one reminder through PayPal. split: replace the invoice with a deposit and a balance. release: cancel and offer the spot to the waitlist. hold: one question for Sam. The flags are a self-check from what you observed.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["choice", "reason", "flags"],
    properties: {
      choice: { type: "string", enum: ["wait", "remind", "split", "release", "hold"] },
      reason: { type: "string" },
      question_for_treasurer: { type: ["string", "null"] },
      flags: { type: "object", additionalProperties: false, required: ["paid_on_paypal", "replied", "silent", "waitlist_available", "records_disagree"],
        properties: { paid_on_paypal: { type: "boolean" }, replied: { type: "boolean" }, silent: { type: "boolean", description: "No reply to the invoice or any reminder." }, waitlist_available: { type: "boolean" }, records_disagree: { type: "boolean" } } },
    },
  },
} as const;

const here = dirname(fileURLToPath(import.meta.url));
let systemPrompt: string | null = null;

export interface ChaseOptions {
  record: TeamRecord; fees: Fees; waitlist: WaitlistTeam[]; today: string; mcp: PayPalMcp | null; model?: string; onStep?: (s: TraceStep) => void;
}
export interface ChaseResult {
  team_id: string; team: string; division: string; today: string;
  decision: InvoiceDecision | null;
  outcome: "waited" | "reminded" | "split" | "released" | "held" | "blocked" | "error";
  blockedBy: "guard" | null; guard: string | null;
  actions: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
  hold: { question: string | null; reason: string } | null;
  loop: { model: string; calls: number; input_tokens: number; output_tokens: number; ms: number; endedBy: string };
  trace: TraceStep[];
}

const daysBetween = (a: string, b: string): number => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

/** The guards: the objective tests behind remind, split and release. */
export function guard(choice: InvoiceDecision["choice"], r: TeamRecord, fees: Fees, waitlist: WaitlistTeam[], today: string): string | null {
  const pastDue = daysBetween(r.due_date, today);
  const lastReminder = r.reminders.at(-1);
  if (r.status === "paid") return choice === "wait" ? null : "the invoice is already paid";
  if (choice === "remind") {
    if (r.reminders.length >= fees.reminder.max) return `${fees.reminder.max} reminders already sent`;
    if (lastReminder && daysBetween(lastReminder, today) < fees.reminder.every_days) return `a reminder went out ${daysBetween(lastReminder, today)} day(s) ago; the rule is one every ${fees.reminder.every_days}`;
  }
  if (choice === "release") {
    if (pastDue < fees.release.after_days_past_deadline) return `only ${pastDue} day(s) past the due date; a release needs ${fees.release.after_days_past_deadline}`;
    if (r.reminders.length < fees.reminder.max) return `only ${r.reminders.length} reminder(s) sent; a release needs ${fees.reminder.max}`;
    if (r.replies.length) return "the manager replied; a release needs silence";
    if (!waitlist.some((w) => w.division === r.division)) return "nobody is waitlisted for this division";
  }
  if (choice === "split" && r.status === "split") return "already split";
  return null;
}

export async function runChase(o: ChaseOptions): Promise<ChaseResult> {
  const { record: r, fees, waitlist, today, mcp } = o;
  systemPrompt ??= await readFile(join(here, "prompts", "invoices.md"), "utf8");
  const t0 = Date.now();
  const actions: ChaseResult["actions"] = [];
  const act = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
    const result = mcp ? await mcp.call(tool, args) : { isError: true, errorCategory: "permission", isRetryable: false, message: "PayPal is switched off in this run" };
    actions.push({ tool, args, result });
    return result;
  };

  const tools: ToolDef[] = [
    ...(mcp ? mcp.tools(["get_invoice"]) : [{
      name: "get_invoice", description: "PayPal's record of an invoice by invoice_id. Switched off in this run.", input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
      run: () => ({ isError: true, errorCategory: "permission", isRetryable: false, message: "PayPal is switched off in this run. Nothing can be read or sent." }),
    }]),
    {
      name: "team_record",
      description: "The association's own record of this team's entry fee: the invoice we sent (id, number, amount, due date), reminders sent so far with dates, the manager's replies, last year's history, today's date, and whether a team is waitlisted in the division. Use get_invoice for PayPal's view of the same invoice.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => ({
        today, team: r.team, division: r.division, manager: r.manager_name,
        invoice: { id: r.invoice_id, number: r.invoice_number, amount: r.amount, currency: r.currency, status_in_our_record: r.status, sent_at: r.sent_at, due_date: r.due_date, days_past_due: daysBetween(r.due_date, today) },
        reminders_sent: r.reminders, replies: r.replies.map((x) => ({ at: x.at, text: x.text })),
        history: r.history,
        waitlist_for_division: waitlist.filter((w) => w.division === r.division).map((w) => w.name),
        rules: { reminder_every_days: fees.reminder.every_days, reminders_max: fees.reminder.max, release_after_days_past_deadline: fees.release.after_days_past_deadline, deposit_share: fees.deposit_share },
      }),
    },
    { ...decideInvoiceTool, input_schema: decideInvoiceTool.input_schema as unknown as Record<string, unknown>, terminal: true, run: (i: InvoiceDecision) => ({ recorded: true, choice: i.choice }) },
  ];

  const user = `Today is ${today}. ${r.team} (${r.division}) owes the entry fee, invoice ${r.invoice_number}${r.invoice_id ? ` (PayPal id ${r.invoice_id})` : ""}. Read PayPal's record and the association's record, then call decide_invoice.`;
  const loop = await runLoop({ system: systemPrompt, user, tools, model: o.model, onStep: o.onStep });
  const base = { team_id: r.team_id, team: r.team, division: r.division, today, actions, blockedBy: null as "guard" | null, guard: null as string | null, hold: null as ChaseResult["hold"], trace: loop.steps,
    loop: { model: loop.model, calls: loop.usage.calls, input_tokens: loop.usage.input_tokens, output_tokens: loop.usage.output_tokens, ms: Date.now() - t0, endedBy: loop.endedBy } };
  const decision = loop.terminal?.name === "decide_invoice" ? (loop.terminal.input as InvoiceDecision) : null;
  if (!decision) {
    const reason = loop.error ? `the agent could not decide: ${loop.error}` : `the agent ended without a decision (${loop.endedBy})`;
    r.status = "held";
    return { ...base, decision: null, outcome: "held", blockedBy: "guard", hold: { question: `${r.division}, ${r.team}: the agent did not reach a decision. What next?`, reason } };
  }
  if (decision.choice === "hold") { r.status = "held"; return { ...base, decision, outcome: "held", hold: { question: decision.question_for_treasurer ?? null, reason: decision.reason } }; }
  if (decision.choice === "wait") return { ...base, decision, outcome: "waited" };

  const g = guard(decision.choice, r, fees, waitlist, today);
  if (g) { r.status = "held"; return { ...base, decision, outcome: "blocked", blockedBy: "guard", guard: g, hold: { question: decision.question_for_treasurer ?? `${r.division}, ${r.team}: the agent wanted to ${decision.choice} but the rule stopped it (${g}). What next?`, reason: `guard blocked ${decision.choice}: ${g}` } }; }

  if (decision.choice === "remind") {
    const res: any = await act("send_invoice_reminder", { invoice_id: r.invoice_id, subject: `Reminder: ${r.division} entry fee, ${fees.deadline} deadline`, note: `Hi ${r.manager_name}, a reminder that the ${r.division} entry fee for the Northside Invitational is due ${r.due_date}. Thank you.` });
    if (res?.isError) return { ...base, decision, outcome: "error", hold: { question: null, reason: res.message } };
    r.reminders.push(today);
    return { ...base, decision, outcome: "reminded" };
  }
  if (decision.choice === "split") {
    const total = Number(r.amount), deposit = Math.round(total * fees.deposit_share * 100) / 100, balance = Math.round((total - deposit) * 100) / 100;
    const cancel: any = await act("cancel_sent_invoice", { invoice_id: r.invoice_id, note: "Replaced by a deposit and a balance invoice, as you asked.", send_to_recipient: true });
    if (cancel?.isError) return { ...base, decision, outcome: "error", hold: { question: null, reason: cancel.message } };
    const kids: string[] = [];
    for (const [label, value, due] of [["deposit", deposit, today], ["balance", balance, mondayBefore("2026-05-14")]] as const) {
      const created: any = await act("create_invoice", invoiceArgs(r, fees, `${r.invoice_number}-${label.toUpperCase()}`, value, `${r.division} entry fee, ${label}`, due));
      const id = invoiceIdFrom(created);
      if (!id) return { ...base, decision, outcome: "error", hold: { question: null, reason: `PayPal did not return an invoice id for the ${label}: ${JSON.stringify(created).slice(0, 300)}` } };
      const sent: any = await act("send_invoice", { invoice_id: id, send_to_recipient: true, note: `Hi ${r.manager_name}, here is the ${label} for the ${r.division} entry fee.` });
      if (sent?.isError) return { ...base, decision, outcome: "error", hold: { question: null, reason: sent.message } };
      kids.push(id);
    }
    r.status = "split"; r.children = kids;
    return { ...base, decision, outcome: "split" };
  }
  // release
  const next = waitlist.find((w) => w.division === r.division)!;
  const cancel: any = await act("cancel_sent_invoice", { invoice_id: r.invoice_id, note: `The ${r.division} spot has been released: the entry fee was not paid by the deadline.`, send_to_recipient: true });
  if (cancel?.isError) return { ...base, decision, outcome: "error", hold: { question: null, reason: cancel.message } };
  const created: any = await act("create_invoice", invoiceArgs({ ...r, team: next.name, manager_email: next.manager_email, manager_name: next.manager_name }, fees, `NYB2026-${next.id.toUpperCase()}`, Number(r.amount), `${r.division} entry fee`, addDays(today, 5)));
  const id = invoiceIdFrom(created);
  if (!id) return { ...base, decision, outcome: "error", hold: { question: null, reason: `PayPal did not return an invoice id for the waitlisted team: ${JSON.stringify(created).slice(0, 300)}` } };
  const sent: any = await act("send_invoice", { invoice_id: id, send_to_recipient: true, note: `A ${r.division} spot has opened at the Northside Invitational. Pay this invoice within five days to take it.` });
  if (sent?.isError) return { ...base, decision, outcome: "error", hold: { question: null, reason: sent.message } };
  r.status = "released"; r.children = [id];
  return { ...base, decision, outcome: "released" };
}

/** The create_invoice call as the PayPal MCP server defines it. */
export function invoiceArgs(r: Pick<TeamRecord, "team" | "division" | "manager_email" | "manager_name">, fees: Fees, number: string, value: number, item: string, due: string): Record<string, unknown> {
  return {
    currency_code: fees.currency,
    invoice_number: number,
    invoice_date: new Date().toISOString().slice(0, 10),
    reference: `${r.division}: ${r.team}`,
    note: `Northside Invitational 2026, ${r.division}. Thank you for entering.`,
    invoicer_business_name: "Northside Youth Basketball",
    invoicer_email_address: process.env.PAYPAL_BUSINESS_EMAIL ?? "northside-business@example.com",
    primary_recipients: [{ billing_info: { email_address: r.manager_email, name: { given_name: r.team, surname: "team manager" } } }],
    // the MCP server's create_invoice carries no payment term, so the due date is printed in the note
    // and kept in the association's own record
    items: [{ name: `${item} (due ${due})`, description: `${r.team}, ${r.division}`, quantity: "1", unit_amount: { currency_code: fees.currency, value: value.toFixed(2) } }],
  };
}
export function invoiceIdFrom(res: any): string | null {
  if (!res || res.isError) return null;
  if (typeof res === "string") { const m = res.match(/INV2-[A-Z0-9-]+/); return m ? m[0] : null; }
  if (typeof res.id === "string") return res.id;
  if (typeof res.invoice_id === "string") return res.invoice_id;
  const m = JSON.stringify(res).match(/INV2-[A-Z0-9-]+/);
  return m ? m[0] : null;
}
export const addDays = (d: string, n: number): string => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export function mondayBefore(date: string): string { const d = new Date(date); const back = ((d.getUTCDay() + 6) % 7) || 7; return addDays(date, -back); }
