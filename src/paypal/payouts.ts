/**
 * PayPal Payouts over REST. The Agent Toolkit and MCP server carry no payouts tool, so this is the
 * one PayPal surface the agent reaches directly.
 *
 * Idempotency is PayPal's, not ours: `sender_batch_id` is one per game. PayPal refuses a batch whose
 * sender_batch_id was used in the last 30 days, so a game cannot be paid twice even if our own
 * ledger were lost. `sender_item_id` is one per game and official for the same reason.
 */
import { paypalFetch } from "./auth.ts";

export interface PayoutItemInput {
  receiver: string;        // the official's PayPal email
  amount: string;          // "45.00"
  currency: string;        // "CAD"
  note: string;            // what the official sees
  senderItemId: string;    // "northside-2026-r1-g25-off-a"
}

export type ErrorCategory = "transient" | "validation" | "business" | "permission" | "duplicate";
export interface StructuredError {
  isError: true;
  errorCategory: ErrorCategory;
  isRetryable: boolean;
  message: string;         // the sentence a person reads
  details?: unknown;       // PayPal's body, kept whole
  existingBatchId?: string; // set on duplicate: the batch PayPal already holds for this sender_batch_id
}

export interface PayoutBatch {
  batchId: string;
  senderBatchId: string;
  status: string;          // PENDING | PROCESSING | SUCCESS | DENIED | CANCELED
  timeCreated?: string;
  timeCompleted?: string;
  items: Array<{ itemId: string; senderItemId: string; receiver: string; amount: string; currency: string; status: string; timeProcessed?: string; transactionId?: string }>;
  raw: unknown;
}

export async function createPayout(senderBatchId: string, items: PayoutItemInput[], subject: string, message: string): Promise<PayoutBatch | StructuredError> {
  const body = {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: subject, email_message: message },
    items: items.map((i) => ({
      recipient_type: "EMAIL",
      amount: { value: i.amount, currency: i.currency },
      receiver: i.receiver,
      note: i.note,
      sender_item_id: i.senderItemId,
    })),
  };
  let res: Response;
  try {
    res = await paypalFetch("/v1/payments/payouts", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return { isError: true, errorCategory: "transient", isRetryable: true, message: `PayPal did not answer: ${(e as Error).message}` };
  }
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* keep text */ }
  if (res.status === 201 || res.status === 200) {
    const h = json.batch_header;
    return { batchId: h.payout_batch_id, senderBatchId, status: h.batch_status, timeCreated: h.time_created, items: [], raw: json };
  }
  return classify(res.status, json ?? text, senderBatchId);
}

export async function getPayout(batchId: string): Promise<PayoutBatch | StructuredError> {
  let res: Response;
  try { res = await paypalFetch(`/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=100`); }
  catch (e) { return { isError: true, errorCategory: "transient", isRetryable: true, message: `PayPal did not answer: ${(e as Error).message}` }; }
  const json: any = await res.json().catch(() => null);
  if (!res.ok) return classify(res.status, json, "");
  const h = json.batch_header;
  return {
    batchId: h.payout_batch_id,
    senderBatchId: h.sender_batch_header?.sender_batch_id ?? "",
    status: h.batch_status,
    timeCreated: h.time_created,
    timeCompleted: h.time_completed,
    items: (json.items ?? []).map((it: any) => ({
      itemId: it.payout_item_id,
      senderItemId: it.payout_item?.sender_item_id ?? "",
      receiver: it.payout_item?.receiver ?? "",
      amount: it.payout_item?.amount?.value ?? "",
      currency: it.payout_item?.amount?.currency ?? "",
      status: it.transaction_status,
      timeProcessed: it.time_processed,
      transactionId: it.transaction_id,
    })),
    raw: json,
  };
}

/** Poll until the batch leaves PENDING/PROCESSING, or the deadline passes (then return what it is). */
export async function waitForPayout(batchId: string, opts: { timeoutMs?: number; everyMs?: number } = {}): Promise<PayoutBatch | StructuredError> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let last: PayoutBatch | StructuredError = await getPayout(batchId);
  while (Date.now() < deadline) {
    if ("isError" in last) { if (!last.isRetryable) return last; }
    else if (last.status !== "PENDING" && last.status !== "PROCESSING") return last;
    await new Promise((r) => setTimeout(r, opts.everyMs ?? 2000));
    last = await getPayout(batchId);
  }
  return last;
}

export const isPayoutError = (x: PayoutBatch | StructuredError): x is StructuredError => (x as StructuredError).isError === true;

function classify(status: number, body: any, senderBatchId: string): StructuredError {
  const name: string = body?.name ?? "";
  const msg: string = body?.message ?? (typeof body === "string" ? body : "");
  const detail: string = JSON.stringify(body?.details ?? "");
  const text = `${name} ${msg} ${detail}`.toUpperCase();
  if (text.includes("DUPLICATE") || text.includes("SENDER_BATCH_ID")) {
    const link = (body?.links ?? []).find((l: any) => /payouts\//.test(l.href))?.href as string | undefined;
    const existing = link ? link.split("/payouts/")[1]?.split(/[?/]/)[0] : undefined;
    return { isError: true, errorCategory: "duplicate", isRetryable: false, existingBatchId: existing,
      message: `PayPal already holds a payout batch for ${senderBatchId}; nothing was sent again.`, details: body };
  }
  if (status === 401 || status === 403 || text.includes("PERMISSION") || text.includes("NOT_AUTHORIZED")) {
    return { isError: true, errorCategory: "permission", isRetryable: false, details: body,
      message: "PayPal refused the payout for lack of permission. In the sandbox app, Payouts must be ticked under App feature options." };
  }
  if (text.includes("INSUFFICIENT_FUNDS")) {
    return { isError: true, errorCategory: "business", isRetryable: false, details: body,
      message: "The association's PayPal balance cannot cover this payout." };
  }
  if (status >= 500 || status === 429) {
    return { isError: true, errorCategory: "transient", isRetryable: true, details: body, message: `PayPal answered ${status}; try again shortly.` };
  }
  return { isError: true, errorCategory: "validation", isRetryable: false, details: body, message: `PayPal rejected the payout request: ${name || status} ${msg}`.trim() };
}
