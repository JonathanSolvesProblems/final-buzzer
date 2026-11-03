/* The treasurer's money board on AG Grid: officials' pay, holds, entry fees, from the agent's ledger
   and the invoice records. Same surface as the board, same words. */
import { normalise, matchup, get } from "/feed.js";

const $ = (id) => document.getElementById(id);
const doc = await get("/api/tournament");
const T = normalise(doc);
const byId = new Map(T.games.map((g) => [g.id, g]));
const money = (n) => "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const theme = agGrid.themeQuartz.withParams({
  backgroundColor: "#16171A", foregroundColor: "#F4F5F2", headerBackgroundColor: "#16171A", headerTextColor: "#9EA2AA",
  borderColor: "#2A2C31", rowBorder: { color: "#2A2C31" }, rowHoverColor: "#202227", selectedRowBackgroundColor: "#202227",
  fontFamily: "Schibsted Grotesk, Georgia, sans-serif", fontSize: 13, headerFontSize: 11, spacing: 6, borderRadius: 0, wrapperBorderRadius: 0, wrapperBorder: false,
  accentColor: "#F2C230", oddRowBackgroundColor: "#16171A", headerColumnResizeHandleColor: "transparent", headerColumnBorder: false, columnBorder: false, cellHorizontalPadding: 10,
});
// on a phone the grids keep the columns a treasurer reads first; the rest are on the wide board
const narrow = matchMedia("(max-width: 700px)");
const common = { theme, domLayout: "autoHeight", rowHeight: 40, headerHeight: 32, suppressCellFocus: true, defaultColDef: { resizable: true, sortable: true, flex: 1, minWidth: 90 }, animateRows: true };
const chip = (text, cls) => `<span class="chip ${cls}">${text}</span>`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const payouts = agGrid.createGrid($("payouts"), { ...common, columnDefs: [
  { headerName: "Game", field: "number", maxWidth: 64, minWidth: 52, cellClass: "num" },
  { headerName: "Matchup", field: "matchup", minWidth: 140 },
  { headerName: "Court", field: "court", maxWidth: 110, cellClass: "quiet" },
  { headerName: "Officials", field: "officials", minWidth: 150, cellClass: "quiet" },
  { headerName: "Paid", field: "amount", maxWidth: 110, minWidth: 76, cellClass: "num", valueFormatter: (p) => money(p.value) },
  { headerName: "Seconds", headerTooltip: "Seconds from the final buzzer to PayPal's confirmation", field: "seconds", maxWidth: 110, minWidth: 70, cellClass: "num", valueFormatter: (p) => p.value == null ? "" : p.value },
  { headerName: "Decided by", field: "decidedBy", maxWidth: 120, cellRenderer: (p) => p.value === "treasurer" ? chip("Sam", "treasurer") : p.value === "script" ? chip("script", "") : chip("agent", "") },
  { headerName: "PayPal", field: "status", minWidth: 180, cellRenderer: (p) => `${chip(esc(p.value === "SUCCESS" ? "Confirmed" : p.value), p.value === "SUCCESS" ? "paid" : "")} <span class="quiet" style="font-size:11px">${esc(p.data.batchId ?? "")}</span>` },
] });
const holds = agGrid.createGrid($("holds"), { ...common, columnDefs: [
  { headerName: "Game", field: "number", maxWidth: 80, cellClass: "num" },
  { headerName: "Matchup", field: "matchup", minWidth: 160 },
  { headerName: "Why", field: "reason", minWidth: 260, wrapText: true, autoHeight: true },
  { headerName: "The question for Sam", field: "question", minWidth: 260, wrapText: true, autoHeight: true },
  { headerName: "Held by", field: "by", maxWidth: 110, cellRenderer: (p) => chip(esc(p.value), "held") },
] });
const invoices = agGrid.createGrid($("invoices"), { ...common, columnDefs: [
  { headerName: "Team", field: "team", minWidth: 140 },
  { headerName: "Division", field: "division", maxWidth: 130, cellClass: "quiet" },
  { headerName: "Invoice", field: "invoice_number", minWidth: 190, cellClass: "quiet" },
  { headerName: "Amount", field: "amount", maxWidth: 110, cellClass: "num", valueFormatter: (p) => money(p.value) },
  { headerName: "Due", field: "due_date", maxWidth: 120, cellClass: "quiet" },
  { headerName: "Reminders", field: "reminders", maxWidth: 110, cellClass: "num", valueFormatter: (p) => p.value?.length ?? 0 },
  { headerName: "Status", field: "status", maxWidth: 130, cellRenderer: (p) => chip(esc(p.value), p.value === "paid" ? "paid" : p.value === "held" ? "held" : "") },
  { headerName: "PayPal id", field: "invoice_id", minWidth: 200, cellClass: "quiet" },
] });

let last = "";
async function poll() {
  const [l, inv] = await Promise.all([fetch("/api/ledger").then((r) => r.text()), fetch("/api/invoices").then((r) => r.json()).catch(() => null)]);
  const key = l + (inv?.updated ?? "");
  if (key === last) return; last = key;
  const ledger = JSON.parse(l) || { payouts: {}, holds: {}, folds: {}, events: [] };
  const prow = Object.values(ledger.payouts).map((p) => { const g = byId.get(p.gameId); return { number: p.number || g?.number, matchup: g ? matchup(g) : p.officialId ? "end of day" : "", court: g?.court ?? "", officials: p.items.map((i) => i.official_id.replace("off-", "Official ").toUpperCase().replace("OFFICIAL ", "Official ")).join(", "), amount: p.items.reduce((s, i) => s + Number(i.amount), 0), seconds: p.secondsFromBuzzer ?? null, decidedBy: p.decidedBy, status: p.status, batchId: p.batchId } }).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  payouts.setGridOption("rowData", prow); $("payouts-empty").hidden = prow.length > 0; $("payouts").hidden = prow.length === 0;
  const paid = prow.filter((p) => p.status === "SUCCESS" || p.status === "DRY_RUN");
  $("n-payouts").textContent = prow.length; $("m-payouts").textContent = `${money(paid.reduce((s, p) => s + p.amount, 0))} ${paid.some((p) => p.status === "DRY_RUN") ? "(dry run)" : "confirmed by PayPal"}`;
  const hrow = Object.values(ledger.holds).map((h) => { const g = byId.get(h.gameId); return { number: h.number, matchup: g ? matchup(g) : "", reason: h.reason, question: h.question, by: h.by } }).sort((a, b) => a.number - b.number);
  holds.setGridOption("rowData", hrow); $("holds-empty").hidden = hrow.length > 0; $("holds").hidden = hrow.length === 0; $("n-holds").textContent = hrow.length;
  const irow = inv ? Object.values(inv.records).sort((a, b) => a.division.localeCompare(b.division) || a.team.localeCompare(b.team)) : [];
  invoices.setGridOption("rowData", irow); $("invoices-empty").hidden = irow.length > 0; $("invoices").hidden = irow.length === 0; $("n-invoices").textContent = irow.length;
  const ipaid = irow.filter((r) => r.status === "paid");
  $("m-invoices").textContent = irow.length ? `${ipaid.length} paid, ${money(ipaid.reduce((s, r) => s + Number(r.amount), 0))} in; ${irow.filter((r) => r.status === "sent" || r.status === "split").length} open` : "";
  const dollarsOut = paid.reduce((s, p) => s + p.amount, 0), dollarsIn = ipaid.reduce((s, r) => s + Number(r.amount), 0);
  $("sums").innerHTML = `<span><span class="num">${money(dollarsIn).replace(".00", "")}</span> entry fees in</span><span><span class="num">${money(dollarsOut).replace(".00", "")}</span> paid to officials, all days</span><span><span class="num">${hrow.length}</span> waiting on Sam</span><span><span class="num">${Object.values(ledger.folds).flat().length}</span> folded to end of day</span>`;
}
function fit() {
  const wide = !narrow.matches;
  payouts.setColumnsVisible(["court", "officials", "decidedBy", "status"], wide);
  holds.setColumnsVisible(["reason", "by"], wide);
  invoices.setColumnsVisible(["division", "invoice_number", "reminders", "invoice_id"], wide);
}
narrow.addEventListener("change", fit); fit();
await poll();
setInterval(poll, 3000);
