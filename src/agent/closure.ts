/**
 * A gym closes: run the re-plan agent, settle the money for what cannot be played, and (when asked)
 * write the moved games back into the tournament document so the board shows the new day.
 * Shared by the CLI (src/cli/replan.ts) and the board's server (POST /api/replan).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadFromFile } from "../app/feed.ts";
import { loadSheet } from "./sheet.ts";
import { runReplan, refundFor, type Closure, type ReplanResult } from "./replan.ts";
import { createPayout, waitForPayout, isPayoutError } from "../paypal/payouts.ts";
import { getInvoiceRest } from "../paypal/invoicing.ts";
import { connectPayPalMcp } from "../paypal/mcp.ts";

export interface Refund { game_number: number; team: string; division: string; rule: string; amount: string; currency: string; provisional_fee: boolean; via: string | null; status: string; ref?: string | null }
export interface ClosureOutcome {
  at: string; paypal: string; closure: Closure; affected: number[]; summary: string | null;
  applied: ReplanResult["applied"]; rejected: ReplanResult["rejected"]; unplayable: ReplanResult["unplayable"];
  refunds: Refund[]; fee_rule: unknown; loop: ReplanResult["loop"]; document_version: number | null;
}

export async function runClosure(o: { closure: Closure; paypal: "live" | "dry"; runId: string; docPath?: string; apply?: boolean; invoicesPath?: string; outPath?: string; onStep?: Parameters<typeof runReplan>[0]["onStep"] }): Promise<ClosureOutcome & { trace: ReplanResult["trace"] }> {
  const docPath = o.docPath ?? "data/tournament-2026.json";
  const t = await loadFromFile(docPath);
  const sheet = await loadSheet();
  const fees = JSON.parse(await readFile("data/fees.json", "utf8"));
  const teams = JSON.parse(await readFile("data/teams-2026.json", "utf8"));
  const invoices = await readFile(o.invoicesPath ?? "results/invoices.json", "utf8").then((s) => JSON.parse(s).records, () => ({}));

  const r = await runReplan({ tournament: t, sheet, courts: t.courts, closure: o.closure, onStep: o.onStep });

  // the money: pro rata per team for each game that cannot be played
  const refunds: Refund[] = [];
  let mcp: Awaited<ReturnType<typeof connectPayPalMcp>> | null = null;
  try {
    for (const u of r.unplayable) {
      const g = t.games.find((x) => x.number === u.game_number)!;
      for (const team of u.teams) {
        const rule = refundFor(t, team, g.division, fees.entry_fee_per_team);
        const rec = Object.values(invoices as Record<string, any>).find((x) => x.team === team && x.division === g.division);
        const manager = teams.teams.find((x: any) => x.name === team && x.division === g.division);
        const entry: Refund = { game_number: u.game_number, team, division: g.division, rule: `${fees.currency} ${fees.entry_fee_per_team} / ${rule.gamesScheduled} games`, amount: rule.perGame.toFixed(2), currency: fees.currency, provisional_fee: fees.provisional, via: null, status: "NOT_SENT" };
        if (o.paypal !== "live") { entry.status = "DRY_RUN"; refunds.push(entry); continue; }
        // paid on PayPal (a capture on the invoice) -> refund through the invoice; paid by e-transfer -> payout to the manager
        let captureId: string | null = null;
        for (const id of [rec?.invoice_id, ...(rec?.children ?? [])].filter(Boolean)) { const v = await getInvoiceRest(id); if (!("isError" in v) && v.paypalCaptureId) { captureId = v.paypalCaptureId; break; } }
        if (captureId) {
          mcp ??= await connectPayPalMcp(["payments.createRefund"]);
          const res: any = await mcp.call("create_refund", { capture_id: captureId, amount: { currency_code: fees.currency, value: rule.perGame.toFixed(2) }, note_to_payer: `Game ${u.game_number} could not be played (${o.closure.court} closed). Pro-rata refund by the association's rule.` });
          entry.via = "create_refund"; entry.status = res?.isError ? `ERROR: ${res.message}` : (res.status ?? "SENT"); entry.ref = res?.id ?? null;
        } else {
          const sbid = `${t.slug}-${o.runId}-refund-g${u.game_number}-${String(manager?.id ?? team).slice(0, 40)}`;
          const created = await createPayout(sbid, [{ receiver: manager?.manager_email ?? "team@example.com", amount: rule.perGame.toFixed(2), currency: fees.currency, note: `Game ${u.game_number} could not be played (${o.closure.court} closed at ${o.closure.from}). Pro-rata refund: ${entry.rule}.`, senderItemId: sbid }], `${t.association || "The association"}: game refund`, "A game could not be played; here is the pro-rata refund.");
          if (isPayoutError(created)) { entry.via = "payout"; entry.status = `ERROR: ${created.message}`; }
          else { const fin = await waitForPayout(created.batchId, { timeoutMs: 60_000 }); entry.via = "payout"; entry.ref = created.batchId; entry.status = "isError" in fin ? created.status : fin.status; }
        }
        refunds.push(entry);
      }
    }
  } finally { await mcp?.close(); }

  // write the moves into the document, so the board and the scorer's app show the new day
  let version: number | null = null;
  if (o.apply && r.applied.length) {
    const doc = JSON.parse(await readFile(docPath, "utf8"));
    const courtId = new Map(t.courts.map((c) => [c.name, c.id]));
    for (const d of doc.divisions) for (const g of d.games) {
      const m = r.applied.find((x) => t.games.find((y) => y.number === x.game_number)?.id === g.id);
      if (!m) continue;
      g.courtId = courtId.get(m.to.court) ?? g.courtId; g.start = `${o.closure.day}T${m.to.start}`;
      g.note = `moved from ${m.from.court} ${m.from.start}: ${o.closure.court} closed at ${o.closure.from}`;
    }
    for (const u of r.unplayable) { const id = t.games.find((y) => y.number === u.game_number)?.id; for (const d of doc.divisions) for (const g of d.games) if (g.id === id) { g.note = `not played: ${o.closure.court} closed at ${o.closure.from}`; g.status = "forfeit"; g.hs = 0; g.as = 0; } }
    doc.version = (doc.version ?? 0) + 1; doc.updated_at = new Date().toISOString().replace("T", " ").slice(0, 19); version = doc.version;
    await writeFile(docPath, JSON.stringify(doc, null, 2) + "\n");
  }

  const out = { at: new Date().toISOString(), paypal: o.paypal === "live" ? "sandbox" : o.paypal, closure: o.closure, affected: r.affected, summary: r.decision?.summary ?? null, applied: r.applied, rejected: r.rejected, unplayable: r.unplayable, refunds, fee_rule: fees.refund_policy, loop: r.loop, document_version: version, trace: r.trace };
  await mkdir("results", { recursive: true });
  await writeFile(o.outPath ?? "results/replan.json", JSON.stringify(out, null, 2) + "\n");
  return out;
}
