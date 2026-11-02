/** Plain-words summaries of agent results, for the terminal and the results files. */
import type { BuzzerResult } from "../agent/buzzer.ts";

export function summarise(r: BuzzerResult): string {
  const g = r.game;
  const head = `Game ${g.number}, ${g.matchup}, ${g.court}`;
  switch (r.outcome) {
    case "paid": return `${head}: paid ${total(r)} to ${r.payout!.items.length} officials, ${r.payout!.secondsFromBuzzer ?? "?"} s after the buzzer (PayPal batch ${r.payout!.batchId}, ${r.payout!.status}).${folds(r)}`;
    case "pending": return `${head}: payout sent (batch ${r.payout?.batchId}), PayPal still ${r.payout?.status} after 90 s.${folds(r)}`;
    case "held": return `${head}: held for Sam. ${r.hold?.reason} Question: ${r.hold?.question ?? "(none)"}`;
    case "folded": return `${head}: folded into the end-of-day batch for ${r.folded.join(", ")}.`;
    case "blocked": return `${head}: the agent chose ${r.decision?.choice}, ${r.blockedBy === "guard" ? "the gate" : "PayPal"} stopped it. ${r.hold?.reason}`;
    case "dry": return `${head}: would pay ${total(r)} to ${r.payout!.items.length} officials (dry run, nothing sent).${folds(r)}`;
    case "error": return `${head}: ${typeof r.error === "string" ? r.error : r.error?.message}`;
  }
}

export function total(r: BuzzerResult): string {
  const sum = (r.payout?.items ?? []).reduce((s, i) => s + Number(i.amount), 0);
  return `$${sum.toFixed(2)}`;
}
const folds = (r: BuzzerResult): string => r.folded.length ? ` Folded: ${r.folded.join(", ")}.` : "";

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
