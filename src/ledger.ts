/**
 * The agent's own ledger, results/ledger.json. It proposes; PayPal confirms. Nothing in it is
 * trusted over PayPal's answer, and a payout is only "paid" when PayPal's batch says so.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The agent's own run on a game, kept with the record so the board can show what it read and when it chose. */
export interface AgentRun { model: string; ms: number; calls: number; steps: Array<{ name: string; ms: number }> }
export interface LedgerPayout {
  gameId: string; number: number; senderBatchId: string; batchId: string | null;
  status: string; items: Array<{ official_id: string; role: string; amount: string; receiver: string; status?: string; timeProcessed?: string }>;
  finalAt: string; createdAt: string; completedAt?: string | null; secondsFromBuzzer?: number | null;
  decidedBy: "agent" | "treasurer" | "script"; provisional: boolean;
  agent?: AgentRun;
}
export interface LedgerHold { gameId: string; number: number; at: string; reason: string; question: string | null; flags: Record<string, boolean>; by: "agent" | "guard" | "paypal"; agent?: AgentRun }
export interface LedgerFold { gameId: string; number: number; official_id: string; role: string; amount: string; at: string }
export interface Ledger {
  slug: string;
  payouts: Record<string, LedgerPayout>;   // by senderBatchId
  holds: Record<string, LedgerHold>;       // by gameId
  folds: Record<string, LedgerFold[]>;     // by official_id
  events: Array<{ at: string; kind: string; gameId?: string; number?: number; detail?: unknown }>;
}

export async function loadLedger(path: string, slug: string): Promise<Ledger> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return { slug, payouts: {}, holds: {}, folds: {}, events: [] }; }
}
export async function saveLedger(path: string, l: Ledger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(l, null, 2) + "\n");
}
export function event(l: Ledger, kind: string, extra: { gameId?: string; number?: number; detail?: unknown } = {}): void {
  l.events.push({ at: new Date().toISOString(), kind, ...extra });
}
