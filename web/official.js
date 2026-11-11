/* An official's pay, read from the same three records as the board: the tournament document, the
   officials' sheet and the agent's ledger. Nothing here is computed that the ledger does not hold: a
   game is "paid" only when PayPal's batch says SUCCESS, and the seconds are the ledger's own. */
import { normalise, matchup, sentence, get, heldNote } from "/feed.js";

const $ = (id) => document.getElementById(id);
const enc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => "$" + Number(n).toLocaleString("en-CA", { maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 });
const dayName = (d) => new Date(d + "T12:00").toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long" });
const roleName = (r) => (r === "referee" ? "referee" : "table official");
const title = (g) => (g.home && g.away ? matchup(g) : sentence(g.stage));
const NBSP = "&#8239;";

const [doc, sheet, card] = await Promise.all([get("/api/tournament"), get("/api/sheet"), get("/api/rate-card")]);
let T = normalise(doc);
let ledger = { payouts: {}, holds: {}, folds: {}, events: [] };
let lastText = "";
const seen = new Set(); // payouts already shown as paid, so only a new one flips

const officials = sheet.officials;
function current() {
  let h = ""; try { h = decodeURIComponent(location.hash.slice(1)).toLowerCase(); } catch { /* a malformed hash shows the default official */ }
  const byId = officials.find((o) => o.id === h || o.id === `off-${h}`);
  return byId ?? officials.find((o) => o.id === "off-d") ?? officials[0];
}
const letter = (o) => o.label.replace(/^Official\s+/i, "");

function renderPick(me) {
  $("who-pick").innerHTML = officials.map((o) => `<button type="button" data-id="${o.id}" aria-label="${enc(o.label)}"${o.id === me.id ? ' aria-pressed="true"' : ""}>${enc(letter(o))}</button>`).join("");
}
$("who-pick").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) location.hash = letter(officials.find((o) => o.id === b.dataset.id)).toLowerCase(); });
addEventListener("hashchange", () => render(true));

/** Every game this official is on, with its money state from the ledger. */
function myGames(me) {
  const rows = [];
  for (const g of T.games) {
    const a = sheet.assignments[g.id]; if (!a) continue;
    const role = a.referees.includes(me.id) ? "referee" : a.table === me.id ? "table" : null;
    if (!role) continue;
    const amount = role === "referee" ? card.per_game.referee : card.per_game.table;
    const payout = Object.values(ledger.payouts).find((p) => p.gameId === g.id && p.status === "SUCCESS" && p.items.some((i) => i.official_id === me.id));
    const item = payout?.items.find((i) => i.official_id === me.id);
    const fold = (ledger.folds[me.id] ?? []).find((f) => f.gameId === g.id);
    const day = g.start.slice(0, 10);
    const evening = fold && Object.values(ledger.payouts).find((p) => !p.gameId && p.status === "SUCCESS" && p.senderBatchId.includes(day) && p.senderBatchId.endsWith(`-${me.id}`) && p.items.some((i) => i.game == null || i.game === g.number));
    const hold = ledger.holds[g.id];
    let kind;
    if (payout) kind = "paid";
    else if (fold) kind = "folded";
    else if (hold) kind = "held";
    else if (g.status === "forfeit" && String(g.note).startsWith("not played")) kind = "unplayed";
    else if (g.status !== "scheduled") kind = "final";
    else kind = "next";
    rows.push({ g, role, amount: item ? Number(item.amount) : amount, kind, payout, fold, evening, hold, day });
  }
  return rows;
}

function stateLine(r) {
  const p = r.payout;
  if (r.kind === "paid") {
    const sam = p.decidedBy === "treasurer";
    const when = p.secondsFromBuzzer != null ? `Paid ${sam ? "on Sam's call, " : ""}<span class="num">${p.secondsFromBuzzer}</span>${NBSP}s after ${sam ? "Sam's tap" : "the buzzer"}, confirmed by PayPal` : `Paid${sam ? " on Sam's call" : ""}, confirmed by PayPal`;
    return `${when}. <span class="ref">${enc(p.batchId ?? "")}</span>`;
  }
  if (r.kind === "folded") return r.evening ? `You asked to be paid once a day: paid with the evening payout, confirmed by PayPal. <span class="ref">${enc(r.evening.batchId ?? "")}</span>` : "You asked to be paid once a day: this game goes into tonight's payout.";
  if (r.kind === "held") return `${enc(heldNote(r.hold))}. The agent sent nothing and asked Sam; you are paid when Sam decides.`;
  if (r.kind === "unplayed") return "Not played: the court closed. Nothing is owed for this game.";
  if (r.kind === "final") return "Final. The agent is reading the sheet, the rate card and PayPal now.";
  return `${sentence(roleName(r.role))} on the sheet. Paid ${money(r.amount)} about 40 seconds after the score is saved${current()?.payout_preference === "end_of_day" ? ", or with the evening payout, as you asked" : ""}.`;
}

function render(fromHash = false) {
  const me = current();
  renderPick(me);
  document.title = `Final Buzzer: ${me.label}'s pay`;
  $("me-name").textContent = me.label;
  $("me-pref").textContent = me.payout_preference === "end_of_day" ? "Asked to be paid once a day, in the evening, through PayPal" : "Paid after each game, through PayPal";
  const rows = myGames(me);
  const paidBatches = Object.values(ledger.payouts).filter((p) => p.status === "SUCCESS" && p.items.some((i) => i.official_id === me.id));
  const total = paidBatches.reduce((s, p) => s + p.items.filter((i) => i.official_id === me.id).reduce((a, i) => a + Number(i.amount), 0), 0);
  const secs = rows.filter((r) => r.kind === "paid" && r.payout.secondsFromBuzzer != null && r.payout.decidedBy !== "treasurer").map((r) => r.payout.secondsFromBuzzer).sort((a, b) => a - b);
  const median = secs.length ? (secs.length % 2 ? secs[secs.length >> 1] : Math.round(((secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2) * 10) / 10) : null;
  const owed = rows.filter((r) => ["held", "final"].includes(r.kind) || (r.kind === "folded" && !r.evening)).reduce((s, r) => s + r.amount, 0);
  const next = rows.filter((r) => r.kind === "next" || r.kind === "unplayed").length;
  $("me-tally").innerHTML = [
    `<span class="fig"><span class="num">${money(total)}</span> paid</span>`,
    `<span class="fig"><span class="num">${rows.length - next}</span> of ${rows.length} games worked</span>`,
    median != null ? `<span class="fig"><span class="num">${median}${NBSP}s</span> median from the buzzer to the money</span>` : "",
    owed ? `<span class="fig"><span class="num">${money(owed)}</span> waiting</span>` : "",
  ].join("");

  const byDay = new Map();
  for (const r of rows) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)).push(r);
  $("days").innerHTML = [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, list]) => {
    const dayPaid = list.filter((r) => r.kind === "paid" || (r.kind === "folded" && r.evening)).reduce((s, r) => s + r.amount, 0);
    const items = list.map((r) => {
      const just = r.kind === "paid" && !seen.has(r.payout.senderBatchId) && lastText && !fromHash;
      return `<li class="${r.kind}${r.kind === "folded" && r.evening ? " paid" : ""}${just ? " just" : ""}"><a href="/#${enc(r.g.id)}" aria-label="${enc(`Game ${r.g.number}, ${title(r.g)}, ${r.g.start.slice(11)}, ${r.g.court}, ${roleName(r.role)}, ${money(r.amount)}`)}">` +
        `<span class="when">${r.g.start.slice(11)}<small>Game ${r.g.number}</small></span>` +
        `<span class="what">${enc(title(r.g))}<small>${enc(sentence(r.g.division))}, ${enc(r.g.court)}, ${roleName(r.role)}</small></span>` +
        `<span class="amt">${money(r.amount)}</span>` +
        `<span class="state">${stateLine(r)}</span></a></li>`;
    }).join("");
    return `<section class="day" aria-label="${enc(dayName(day))}"><h2>${enc(dayName(day))}${dayPaid ? ` <span class="num">${money(dayPaid)} paid</span>` : ""}</h2><ol class="rows">${items}</ol></section>`;
  }).join("") || `<p class="empty-day">${enc(me.label)} is not on the sheet this weekend.</p>`;
  for (const r of rows) if (r.payout) seen.add(r.payout.senderBatchId);
}

async function poll() {
  try {
    const [l, d] = await Promise.all([
      fetch("/api/ledger").then((x) => x.text()),
      fetch(`/api/tournament?v=${T.version}`).then((x) => (x.status === 304 ? null : x.json())).catch(() => null),
    ]);
    let changed = false;
    if (d) { T = normalise(d); changed = true; }
    if (l !== lastText) { ledger = JSON.parse(l) || ledger; changed = true; }
    const first = !lastText;
    lastText = l;
    if (changed) render(first);
    $("source").textContent = "Live";
  } catch { $("source").textContent = "Ledger unreadable"; }
}
await poll();
setInterval(poll, 3000);
