/**
 * Two Invoicing REST calls the harness needs that the MCP server does not expose: recording a
 * payment that arrived outside PayPal (an e-transfer Sam keys in) and reading an invoice's status.
 * The agent itself goes through the MCP server; this is the replay's hand, not the agent's.
 */
import { paypalFetch } from "./auth.ts";
import type { StructuredError } from "./payouts.ts";

export async function recordExternalPayment(invoiceId: string, amount: { currency_code: string; value: string }, paymentDate: string, note: string): Promise<{ ok: true; paymentId: string | null } | StructuredError> {
  const res = await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`, {
    method: "POST", body: JSON.stringify({ method: "BANK_TRANSFER", payment_date: paymentDate, amount, note }),
  });
  const body: any = await res.json().catch(() => null);
  if (res.ok) return { ok: true, paymentId: body?.payment_id ?? null };
  return { isError: true, errorCategory: res.status >= 500 ? "transient" : "validation", isRetryable: res.status >= 500, message: `record payment on ${invoiceId}: ${res.status} ${body?.message ?? ""}`.trim(), details: body };
}

/** `paypalCaptureId` is the capture of a payment made through PayPal on this invoice (a payer's PayPal or card checkout),
 *  the one thing a refund can be issued against. A payment Sam recorded by hand (an e-transfer) never has one. */
export interface InvoiceView { id: string; number: string; status: string; amount: string; currency: string; due: string | null; paid: string | null; recipient: string | null; paypalCaptureId: string | null }

export async function getInvoiceRest(invoiceId: string): Promise<InvoiceView | StructuredError> {
  const res = await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  const b: any = await res.json().catch(() => null);
  if (!res.ok) return { isError: true, errorCategory: res.status === 404 ? "validation" : "transient", isRetryable: res.status >= 500, message: `get invoice ${invoiceId}: ${res.status} ${b?.message ?? ""}`.trim(), details: b };
  return {
    id: b.id, number: b.detail?.invoice_number ?? "", status: b.status, amount: b.amount?.value ?? "", currency: b.amount?.currency_code ?? b.detail?.currency_code ?? "",
    due: b.detail?.payment_term?.due_date ?? null, paid: b.payments?.paid_amount?.value ?? null,
    recipient: b.primary_recipients?.[0]?.billing_info?.email_address ?? null,
    paypalCaptureId: (b.payments?.transactions ?? []).find((t: any) => t.method === "PAYPAL" && t.payment_id)?.payment_id ?? null,
  };
}
