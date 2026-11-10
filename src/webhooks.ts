/**
 * PayPal webhooks: the agent keeps going after the first run because PayPal tells it what landed.
 *
 *   PAYMENT.PAYOUTSBATCH.SUCCESS / DENIED, PAYMENT.PAYOUTS-ITEM.*  -> the ledger's payout status and times
 *   INVOICING.INVOICE.PAID / CANCELLED                              -> the team's invoice record
 *
 * Every event whose signature verifies is appended to the webhook log (WEBHOOK_LOG, results/webhooks.jsonl by default; the board
 * serves it at /api/webhooks) as received. Signatures are verified with PayPal's
 * verify-webhook-signature when PAYPAL_WEBHOOK_ID is set; without it (local development) the event
 * is applied and marked unverified, never silently trusted as verified.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { dirname } from "node:path";
import { paypalFetch } from "./paypal/auth.ts";
import { loadLedger, saveLedger, event as ledgerEvent } from "./ledger.ts";

export const WEBHOOK_LOG = process.env.WEBHOOK_LOG ?? "results/webhooks.jsonl";

export interface WebhookOutcome { ok: boolean; verified: boolean | "skipped"; event_type: string; applied: string; }

export async function verify(headers: IncomingHttpHeaders, rawBody: string): Promise<boolean | "skipped"> {
  const id = process.env.PAYPAL_WEBHOOK_ID;
  if (!id) return "skipped";
  const h = (k: string) => String(headers[k] ?? "");
  const res = await paypalFetch("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"), webhook_id: id, webhook_event: JSON.parse(rawBody),
    }),
  });
  const body: any = await res.json().catch(() => null);
  return body?.verification_status === "SUCCESS";
}

export async function handleWebhook(headers: IncomingHttpHeaders, rawBody: string, ledgerPath: string): Promise<WebhookOutcome> {
  const ev = JSON.parse(rawBody);
  const type: string = ev.event_type ?? "unknown";
  const verified = await verify(headers, rawBody).catch(() => false);
  await mkdir(dirname(WEBHOOK_LOG), { recursive: true });
  // a rejected event is kept apart (WEBHOOK_LOG + ".rejected"): anyone can post to this address, and the public log
  // lists only what PayPal's signature check passed (or, with no webhook id set, what was applied unverified)
  await appendFile(verified === false ? `${WEBHOOK_LOG}.rejected` : WEBHOOK_LOG, JSON.stringify({ at: new Date().toISOString(), verified, type: String(type).slice(0, 80), id: String(ev.id ?? "").slice(0, 80), summary: String(ev.summary ?? "").slice(0, 200) }) + "\n");
  if (verified === false) return { ok: false, verified, event_type: type, applied: "rejected: signature did not verify" };

  if (type.startsWith("PAYMENT.PAYOUTSBATCH") || type.startsWith("PAYMENT.PAYOUTS-ITEM")) {
    const batchId: string | undefined = ev.resource?.batch_header?.payout_batch_id ?? ev.resource?.payout_batch_id;
    if (!batchId) return { ok: true, verified, event_type: type, applied: "no batch id on the event" };
    const ledger = await loadLedger(ledgerPath, "northside-2026");
    const rec = Object.values(ledger.payouts).find((p) => p.batchId === batchId);
    if (!rec) return { ok: true, verified, event_type: type, applied: `batch ${batchId} is not in the ledger` };
    if (type.startsWith("PAYMENT.PAYOUTSBATCH")) {
      rec.status = ev.resource.batch_header.batch_status ?? rec.status;
      const completed = ev.resource.batch_header.time_completed ?? null;
      if (completed) { rec.completedAt = completed; rec.secondsFromBuzzer = Math.round((new Date(completed).getTime() - new Date(rec.finalAt).getTime()) / 100) / 10; }
    } else {
      const item = ev.resource;
      const mine = rec.items.find((i) => item.payout_item?.sender_item_id?.endsWith(i.official_id));
      if (mine) { mine.status = item.transaction_status; mine.timeProcessed = item.time_processed; }
    }
    ledgerEvent(ledger, "webhook", { gameId: rec.gameId, number: rec.number, detail: { type, batchId, status: rec.status } });
    await saveLedger(ledgerPath, ledger);
    return { ok: true, verified, event_type: type, applied: `batch ${batchId} is now ${rec.status}` };
  }

  if (type.startsWith("INVOICING.INVOICE.")) {
    const invoiceId: string | undefined = ev.resource?.invoice?.id ?? ev.resource?.id;
    const path = "results/invoices.json";
    const stored = await readFile(path, "utf8").then(JSON.parse).catch(() => null);
    if (!stored || !invoiceId) return { ok: true, verified, event_type: type, applied: "no invoice record to update" };
    const rec = Object.values(stored.records as Record<string, any>).find((r) => r.invoice_id === invoiceId || r.children?.includes(invoiceId));
    if (!rec) return { ok: true, verified, event_type: type, applied: `invoice ${invoiceId} is not in the records` };
    // a split team is paid when the balance (the second child) is paid; the deposit alone keeps the split open
    if (type === "INVOICING.INVOICE.PAID") { const isDeposit = rec.children?.[0] === invoiceId && rec.children.length > 1; if (!isDeposit) rec.status = "paid"; }
    if (type === "INVOICING.INVOICE.CANCELLED" && rec.invoice_id === invoiceId && rec.status === "sent") rec.status = "cancelled";
    (rec.webhooks ??= []).push({ at: new Date().toISOString(), type, invoiceId });
    await writeFile(path, JSON.stringify({ ...stored, updated: new Date().toISOString() }, null, 2) + "\n");
    return { ok: true, verified, event_type: type, applied: `${rec.team}: ${rec.status}` };
  }
  return { ok: true, verified, event_type: type, applied: "not a type this agent acts on" };
}
