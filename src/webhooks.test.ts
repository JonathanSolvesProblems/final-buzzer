import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// no webhook id: the signature check is skipped and the event is applied as unverified, which is the local path
process.env.PAYPAL_WEBHOOK_ID = "";
const dir = await mkdtemp(join(tmpdir(), "fb-webhooks-"));
process.env.WEBHOOK_LOG = join(dir, "webhooks.jsonl");
const { handleWebhook } = await import("./webhooks.ts");

const ledgerPath = join(dir, "ledger.json");
const paid = {
  slug: "northside-2026", holds: {}, folds: {}, events: [],
  payouts: {
    "northside-2026-public-g2": { gameId: "g016", number: 2, senderBatchId: "northside-2026-public-g2", batchId: "B1", status: "SUCCESS", items: [{ official_id: "off-d", role: "referee", amount: "45.00", receiver: "d@example.com" }], finalAt: "2026-11-11T01:29:47.427Z", createdAt: "2026-11-11T01:29:59.000Z", completedAt: "2026-11-11T01:30:33Z" as string | null, secondsFromBuzzer: 45.6 as number | null, decidedBy: "agent", provisional: true },
  },
};
const batchEvent = (status: string, completed: string | null = null) => JSON.stringify({ id: `WH-${status}`, event_type: status === "SUCCESS" ? "PAYMENT.PAYOUTSBATCH.SUCCESS" : "PAYMENT.PAYOUTSBATCH.PROCESSING", summary: status, resource: { batch_header: { payout_batch_id: "B1", batch_status: status, time_completed: completed } } });

test("a late PROCESSING webhook never moves a finished batch back to processing", async () => {
  await writeFile(ledgerPath, JSON.stringify(paid));
  const out = await handleWebhook({}, batchEvent("PROCESSING"), ledgerPath);
  assert.equal(out.ok, true);
  const after = JSON.parse(await readFile(ledgerPath, "utf8"));
  const rec = after.payouts["northside-2026-public-g2"];
  assert.equal(rec.status, "SUCCESS");
  assert.equal(rec.completedAt, "2026-11-11T01:30:33Z");
  assert.equal(rec.secondsFromBuzzer, 45.6);
});

test("a PROCESSING webhook on a batch still pending is applied, and SUCCESS completes it on PayPal's clock", async () => {
  const pending = structuredClone(paid);
  pending.payouts["northside-2026-public-g2"].status = "PENDING";
  pending.payouts["northside-2026-public-g2"].completedAt = null;
  pending.payouts["northside-2026-public-g2"].secondsFromBuzzer = null;
  await writeFile(ledgerPath, JSON.stringify(pending));
  await handleWebhook({}, batchEvent("PROCESSING"), ledgerPath);
  let rec = JSON.parse(await readFile(ledgerPath, "utf8")).payouts["northside-2026-public-g2"];
  assert.equal(rec.status, "PROCESSING");
  await handleWebhook({}, batchEvent("SUCCESS", "2026-11-11T01:30:33Z"), ledgerPath);
  rec = JSON.parse(await readFile(ledgerPath, "utf8")).payouts["northside-2026-public-g2"];
  assert.equal(rec.status, "SUCCESS");
  assert.equal(rec.secondsFromBuzzer, 45.6);
});

test("an event whose signature fails is rejected and kept out of the public log", async () => {
  await writeFile(ledgerPath, JSON.stringify(paid));
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST"; // verification now runs, and with no PayPal credentials it fails
  const out = await handleWebhook({}, JSON.stringify({ id: "x", event_type: "unknown" }), ledgerPath);
  process.env.PAYPAL_WEBHOOK_ID = "";
  assert.equal(out.ok, false);
  const log = await readFile(process.env.WEBHOOK_LOG!, "utf8");
  assert.ok(!log.includes("\"verified\":false"), "the public log holds only verified or skipped events");
  const rejected = await readFile(process.env.WEBHOOK_LOG + ".rejected", "utf8");
  assert.ok(rejected.includes("\"verified\":false"));
});
