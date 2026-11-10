/* The board: the real tournament document on a Bryntum Scheduler, every game a flap tile whose face
   is its money state from the agent's ledger. Polls the ledger, so a payout made by the agent flips
   the tile while you watch. Sam's tap on a held game posts to the server, which pays through the
   same gate and the same PayPal call as the agent. */
import { Scheduler, StringHelper } from "/vendor/bryntum/scheduler.module.js";
import { normalise, matchup, sentence, get, heldNote, GAME_MINUTES } from "/feed.js";

const enc = (s) => StringHelper.encodeHtml(String(s ?? ""));
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const hhmm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
const SHORT = {};
const sh = (t) => SHORT[t] ?? t;

const [doc, sheet, card] = await Promise.all([get("/api/tournament"), get("/api/sheet"), get("/api/rate-card")]);
let T = normalise(doc);
const days = [...new Set(T.games.map((g) => g.start.slice(0, 10)))].sort();
let day = days.find((d) => d.endsWith("05-16")) ?? days[0];
let ledger = { payouts: {}, holds: {}, folds: {}, events: [] };
let replay = null;
const flipped = new Set();
/* the first paint after the ledger is read: tiles flip in across the day, earliest games first */
let firstPaint = false;
let opened = null;   // the game shown in the drawer (read by the tile renderer, so declared before the scheduler)
const bootDelay = (g) => {
  const span = Math.max(1, dayEnd(day) - dayStart(day));
  const lane = courtsOn(day).findIndex((c) => c.id === g.courtId);
  return Math.round(Math.min(1, Math.max(0, (new Date(g.start) - dayStart(day)) / span)) * 760 + Math.max(0, lane) * 45);
};
const events = (t) => t.games.map((g) => ({ id: g.id, resourceId: g.courtId, name: matchup(g), startDate: g.start, duration: GAME_MINUTES, durationUnit: "minute" }));

/* ---- money state per game, from the ledger ---- */
function stateOf(g) {
  const payout = Object.values(ledger.payouts).find((p) => p.gameId === g.id && !p.senderBatchId.endsWith("-showup"));
  const showup = Object.values(ledger.payouts).find((p) => p.gameId === g.id && p.senderBatchId.endsWith("-showup"));
  const hold = ledger.holds[g.id];
  const folds = Object.values(ledger.folds).flat().filter((f) => f.gameId === g.id);
  const p = payout ?? showup;
  if (hold) return { kind: "held", hold };
  if (p && (p.status === "SUCCESS" || p.status === "DRY_RUN")) return { kind: "paid", payout: p, folds, dry: p.status === "DRY_RUN" };
  if (p && (p.status === "PENDING" || p.status === "PROCESSING")) return { kind: "paying", payout: p };
  if (p && p.status.startsWith("ERROR")) return { kind: "held", hold: { reason: `PayPal did not pay: ${p.status}`, question: null, at: p.createdAt } };
  if (folds.length) return { kind: "folded", folds };
  if (g.status === "forfeit" && String(g.note).startsWith("not played")) return { kind: "unplayed" };
  if (g.status !== "scheduled") return { kind: "final" }; // saved on the scorer's phone, the agent has not written yet
  return { kind: "scheduled" };
}
/** The replay's clock: the latest game the agent acted on, plus a game's length. */
function cursor() {
  const acted = ledger.events.filter((e) => e.gameId).map((e) => T.games.find((g) => g.id === e.gameId)).filter(Boolean);
  if (!acted.length) return null;
  const latest = acted.reduce((a, b) => (a.start > b.start ? a : b));
  return new Date(new Date(latest.start).getTime() + GAME_MINUTES * 60000);
}
function kindWithClock(g, now) {
  const s = stateOf(g);
  if (s.kind !== "scheduled" || !now) return s;
  const st = new Date(g.start).getTime();
  if (st <= now.getTime() && now.getTime() < st + GAME_MINUTES * 60000) return { kind: "live" };
  return s;
}

/* ---- the tile ---- */
function noteHTML(g, s) {
  if (s.kind === "paid") {
    const secs = s.payout.secondsFromBuzzer;
    if (s.payout.decidedBy === "treasurer") return `<span class="note">Paid, Sam's call</span>`;
    if (secs == null) return `<span class="note">Paid${s.dry ? ", dry run" : ""}</span>`;
    return `<span class="note"><span class="num">${secs}&#8239;s</span></span>`;
  }
  if (s.kind === "paying") return `<span class="note">Paying through PayPal</span>`;
  if (s.kind === "held") return `<span class="note">${heldNote(s.hold)}</span>`;
  if (s.kind === "folded") return `<span class="note">Folds to end of day</span>`;
  if (s.kind === "live") return `<span class="note">In play</span>`;
  if (s.kind === "final") return `<span class="note">${enc(g.status === "forfeit" ? "Forfeit" : "Final")}${g.hs != null ? ` ${Number(g.hs)} to ${Number(g.as)}` : ""}, agent working</span>`;
  if (s.kind === "unplayed") return `<span class="note">Not played, refunded</span>`;
  if (String(g.note).startsWith("moved from")) return `<span class="note">Moved, was ${enc(g.note.slice(11).split(":")[0])}</span>`;
  return `<span class="note">${enc(sentence(g.division))}</span>`;
}
const vsHTML = (g) => g.home ? `<span>${enc(sh(g.home))}</span><span>v ${enc(sh(g.away))}</span>` : `<span>${enc(sentence(g.stage))}</span>`;
function tileHTML(g, s) {
  const face = (cls) => `<div class="face ${cls}" aria-hidden="true"><span class="vs">${vsHTML(g)}</span>${noteHTML(g, s)}</div>`;
  const boot = firstPaint ? ` boot-in" style="--d:${bootDelay(g)}ms` : "";
  return `<div class="flap ${s.kind}${flipped.has(g.id) ? " just-flipped" : ""}${g.id === opened ? " picked" : ""}${boot}">${s.kind === "held" ? face("top") + face("bottom") : face("top")}</div>`;
}
const label = (g, s) => `Game ${g.number}, ${g.division.toLowerCase()}, ${matchup(g)}, ${g.court}, ${g.start.slice(11)}, ${({ paid: "final, officials paid", paying: "final, paying", held: "held for Sam", folded: "final, folds to end of day", live: "in play", final: "final, the agent is working", unplayed: "not played, refunded", scheduled: "not started" })[s.kind]}`;

/* ---- the scheduler ---- */
const dayStart = (d) => { const first = T.games.filter((g) => g.start.startsWith(d)).map((g) => g.start.slice(11)).sort()[0] ?? "09:00"; return new Date(`${d}T${first.slice(0, 2)}:00`); };
const dayEnd = (d) => { const last = T.games.filter((g) => g.start.startsWith(d)).map((g) => g.start.slice(11)).sort().at(-1) ?? "18:00"; const h = Number(last.slice(0, 2)) + 2; return new Date(`${d}T${String(h).padStart(2, "0")}:00`); };
/** Only the courts with a game that day: the real document books different gyms on different days. */
const courtsOn = (d) => T.courts.filter((c) => T.games.some((g) => g.courtId === c.id && g.start.startsWith(d))).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
const scheduler = new Scheduler({
  appendTo: "courts",
  startDate: dayStart(day), endDate: dayEnd(day),
  viewPreset: { base: "hourAndDay", tickWidth: 84, headers: [{ unit: "hour", dateFormat: "H:mm" }] },
  columns: [{ text: "Court", field: "name", width: 92, htmlEncode: false, renderer: ({ record }) => `<div class="court">${enc(record.name)}</div>` }],
  resources: courtsOn(day),
  events: events(T),
  rowHeight: 52, barMargin: 2, readOnly: true, eventStyle: null, eventColor: null, autoHeight: true,
  // the board wears its own surface, not a Bryntum theme; without this the component fetches one from a CDN
  detectCSSCompatibilityIssues: false,
  features: { eventTooltip: false, eventEdit: false, eventDragCreate: false, eventDrag: false, eventResize: false, eventMenu: false, scheduleMenu: false, cellMenu: false, headerMenu: false, cellEdit: false, regionResize: false, scheduleTooltip: false, timeRanges: { showCurrentTimeLine: false, showHeaderElements: true } },
  eventRenderer({ eventRecord, renderData }) {
    const g = T.games.find((x) => x.id === eventRecord.id);
    const s = kindWithClock(g, cursor());
    renderData.ariaLabel = label(g, s);
    renderData.eventStyle = null;
    return tileHTML(g, s);
  },
});
/** The day's hours fill the board's width, so the last game is never cut at the edge. Skipped while
 * the grid is hidden on a phone, where Bryntum has no width to measure. */
function fitHours() {
  const w = $("courts").clientWidth; if (!w) return;
  const hours = (dayEnd(day) - dayStart(day)) / 3600000;
  scheduler.tickSize = Math.max(64, Math.floor((w - 94) / hours));
}
addEventListener("resize", fitHours);
fitHours();
/* ---- a tile opens its game: a held game on the held card, any other game in the game drawer ---- */
let picked = null;   // the held game on the card, when Sam picked one from the board
let drawerHTML = ""; // what the drawer holds now, so a poll that changes nothing leaves focus and motion alone
let lastFocus = null;
function setDay(d) { day = d; scheduler.resourceStore.data = courtsOn(day); scheduler.setTimeSpan(dayStart(day), dayEnd(day)); fitHours(); renderClosure(); }
function openGame(id) {
  const g = T.games.find((x) => x.id === id); if (!g) return;
  if (!g.start.startsWith(day)) setDay(g.start.slice(0, 10));
  if (ledger.holds[id]) { closeGame(false); picked = id; render(); $("held-card").scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); $("held-title").focus(); return; }
  if (!opened) lastFocus = document.activeElement;
  opened = id; render();
  history.replaceState(null, "", `#${id}`);
  $("game-title")?.focus({ preventScroll: true });
}
function closeGame(restore = true) {
  if (!opened) return;
  opened = null; render();
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  if (restore && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
scheduler.element.addEventListener("click", (e) => {
  const el = e.target.closest(".b-sch-event-wrap"); if (!el) return;
  const rec = scheduler.resolveEventRecord(el); if (rec) openGame(rec.id);
});
$("phone").addEventListener("click", (e) => { const li = e.target.closest("[data-game]"); if (li) openGame(li.dataset.game); });
$("entries").addEventListener("click", (e) => { const li = e.target.closest("[data-game]"); if (li) openGame(li.dataset.game); });
// the scorer's "Watch it on the board" lands here as /#<game id>
const hashId = () => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; } };
addEventListener("hashchange", () => { if (location.hash.length > 1) openGame(hashId()); });
$("scrim").addEventListener("click", () => closeGame());
$("game-card").addEventListener("click", (e) => {
  if (e.target.closest("#game-close")) return closeGame();
  const step = e.target.closest("[data-open]"); if (step) return openGame(step.dataset.open);
  const copy = e.target.closest("[data-copy]");
  if (copy) navigator.clipboard?.writeText(copy.dataset.copy).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1600); }, () => {});
});
addEventListener("keydown", (e) => {
  const dr = $("game-card"); if (!opened || dr.hidden) return;
  if (e.key === "Escape") { e.preventDefault(); closeGame(); return; }
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.closest("input, select, textarea")) {
    const b = dr.querySelector(`[data-dir="${e.key === "ArrowLeft" ? "-1" : "1"}"]`);
    if (b) { e.preventDefault(); openGame(b.dataset.open); }
    return;
  }
  if (e.key === "Tab") { // the drawer is modal: focus goes round inside it
    const f = [...dr.querySelectorAll("button, a[href], h2[tabindex]")];
    const inside = dr.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === f[0])) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === f.at(-1))) { e.preventDefault(); f[0].focus(); }
  }
});

const who = (id) => sheet.officials.find((o) => o.id === id)?.label ?? id;
const roleName = (r) => (r === "referee" ? "referee" : "table official");
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const fmtS = (s) => (s < 120 ? `${(Math.round(s * 10) / 10).toFixed(1)}&#8239;s` : `${Math.round(s / 60)}&#8239;min`);
/** The games Previous and Next step through: the day in start order, held games left to the held card. */
const stepList = () => T.games.filter((g) => g.start.startsWith(day) && !ledger.holds[g.id]).sort((a, b) => a.start.localeCompare(b.start) || a.court.localeCompare(b.court, "en", { numeric: true }));
/** Who the sheet puts on a game, at the rate card's amounts: what the buzzer will pay. */
function onSheet(g) {
  const a = sheet.assignments[g.id]; if (!a) return [];
  return [...a.referees.filter(Boolean).map((id) => ({ official_id: id, role: "referee", amount: card.per_game.referee })), ...(a.table ? [{ official_id: a.table, role: "table", amount: card.per_game.table }] : [])];
}
function payTable(items, title) {
  if (!items.length) return "";
  const total = items.reduce((t, x) => t + Number(x.amount), 0);
  return `<h3>${title}</h3><table class="d-pay"><tbody>${items.map((x) => `<tr><th scope="row"><a href="/official.html#${enc(String(x.official_id).replace(/^off-/, ""))}">${enc(who(x.official_id))}</a></th><td>${cap(roleName(x.role))}</td><td class="num">${money(x.amount)}</td></tr>`).join("")}</tbody>` +
    `<tfoot><tr><th scope="row">Total</th><td></td><td class="num">${money(total)}</td></tr></tfoot></table>`;
}
/** What the agent asked for, in the reader's words. */
const READ = { read_game_sheet: "the game sheet", read_rate_card: "the rate card", check_paypal_for_game: "PayPal's record of this game", officials_day_schedule: "the officials' day" };
const listOf = (xs) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs.at(-1);
/** The agent's run as timed steps from the buzzer: its reads grouped by the turn that asked for them, then its choice.
 * The run's clock starts at loopStart = (when the record was written) minus (how long the run took). */
function agentSteps(p, decided, choice) {
  const a = p.agent; if (!a?.steps?.length || decided == null) return [];
  const start = decided - a.ms / 1000;
  const turns = new Map();
  // reads asked for in the same turn land within a few ms of each other: one line per tenth of a second
  for (const s of a.steps) { if (s.name === "decide") continue; const k = Math.round(s.ms / 100); (turns.get(k) ?? turns.set(k, []).get(k)).push(READ[s.name] ?? s.name.replace(/_/g, " ")); }
  const out = [...turns].sort((x, y) => x[0] - y[0]).map(([k, names]) => [Math.max(0, start + k / 10), `The agent asked for ${listOf(names)}`]);
  const dec = a.steps.find((s) => s.name === "decide");
  if (dec) out.push([Math.max(0, start + dec.ms / 1000), choice]);
  return out;
}
/** From the buzzer to the money: each step timed from the ledger's own timestamps, on a 60 second ruler. */
function timeline(p) {
  if (!p.finalAt) return "";
  const sam = p.decidedBy === "treasurer";
  const decided = p.createdAt ? (new Date(p.createdAt) - new Date(p.finalAt)) / 1000 : null;
  const done = p.secondsFromBuzzer;
  const steps = sam ? [] : [[0, "Final saved on the scorer's phone"]];
  const agent = sam ? [] : agentSteps(p, decided, `The agent chose to pay now${p.agent?.calls ? `, after ${p.agent.calls} turns` : ""}`);
  steps.push(...agent);
  if (decided != null && decided >= 0) steps.push([decided, sam ? "Sam made the call on the held game, and the pay went to PayPal" : agent.length ? "The gate checked every amount against the rate card; the pay went to PayPal Payouts" : "The agent checked the sheet, the rate card and PayPal's record, then sent the pay"]);
  if (done != null) steps.push([done, `PayPal confirmed all ${p.items.length} officials paid`]);
  else if (p.status === "DRY_RUN") steps.push([null, "Dry run: PayPal was not called"]);
  let ruler = "";
  if (!sam && done != null) {
    const scale = done > 60 ? Math.ceil(done / 30) * 30 : 60;
    const at = (v) => Math.min(100, (v / scale) * 100).toFixed(1);
    const marks = [...agent.map(([t]) => t), ...(decided != null ? [decided] : [])];
    ruler = `<div class="ruler" role="img" aria-label="Paid ${done} seconds after the buzzer, on a ${scale} second scale"><i class="fill" style="width:${at(done)}%"></i>${marks.map((t) => `<i class="mark" style="left:${at(t)}%"></i>`).join("")}</div>` +
      `<div class="ruler-scale" aria-hidden="true"><span class="num">0</span><span class="num">${scale / 2}&#8239;s</span><span class="num">${scale}&#8239;s</span></div>`;
  }
  return `<h3>${sam ? "From Sam's tap to the money" : "From the buzzer to the money"}</h3>${ruler}<ol class="steps">${steps.map(([t, w]) => `<li><span class="num">${t == null ? "" : fmtS(t)}</span><span>${w}</span></li>`).join("")}</ol>`;
}
function gameCardHTML(g) {
  const s = kindWithClock(g, cursor());
  const list = stepList(); const i = list.findIndex((x) => x.id === g.id);
  const step = (x, dir) => x
    ? `<button class="d-step" type="button" data-open="${enc(x.id)}" data-dir="${dir}" aria-label="${dir < 0 ? "Previous" : "Next"} game, game ${x.number}">${dir < 0 ? "Previous" : "Next"} <span class="num">${x.number}</span></button>`
    : "";
  const bar = `<div class="d-bar">${i >= 0 ? step(list[i - 1], -1) + step(list[i + 1], 1) : ""}<button class="close-x" type="button" id="game-close" aria-label="Close the game">Close</button></div>`;
  const head = `<p class="d-kicker">Game <span class="num">${g.number}</span>, ${enc(sentence(g.division))}, ${enc(g.court)}, <span class="num">${g.start.slice(11)}</span></p><h2 id="game-title" tabindex="-1">${enc(matchup(g))}</h2>`;
  const folds = Object.values(ledger.folds).flat().filter((f) => f.gameId === g.id);
  const foldLine = folds.length ? `<p class="d-note">${folds.map((f) => `${enc(who(f.official_id))} (${roleName(f.role)}, ${money(f.amount)})`).join(", ")} asked to be paid once a day, so ${folds.length > 1 ? "their shares go" : "that share goes"} into the evening payout.</p>` : "";
  const score = g.hs != null ? ` <span class="num">${Number(g.hs)}</span> to <span class="num">${Number(g.as)}</span>` : "";
  let face = s.kind, big, sub, body;
  if (s.kind === "paid") {
    const p = s.payout; const total = p.items.reduce((t, x) => t + Number(x.amount), 0);
    big = `Paid <span class="num">${money(total)}</span>`;
    sub = s.dry ? "Dry run: PayPal was not called" : p.secondsFromBuzzer != null ? `<span class="num">${p.secondsFromBuzzer}</span> seconds after ${p.decidedBy === "treasurer" ? "Sam's tap" : "the buzzer"}, confirmed by PayPal` : "Confirmed by PayPal";
    body = timeline(p) + payTable(p.items, "Who was paid") + foldLine +
      (p.batchId ? `<div class="d-ref"><span>PayPal reference <span class="ref">${enc(p.batchId)}</span></span><button class="close-x" type="button" data-copy="${enc(p.batchId)}">Copy</button></div>` : "") +
      `<p class="d-note">${p.decidedBy === "treasurer" ? "Sam made this call." : "The agent decided. The rate card was checked in code before PayPal was called."}</p>`;
  } else if (s.kind === "paying") {
    big = `Final${score}`; sub = "With PayPal, waiting for confirmation"; body = payTable(s.payout.items, "Being paid");
  } else if (s.kind === "folded") {
    big = "Folds to end of day"; sub = "Paid with the evening payout, as the officials asked"; body = foldLine;
  } else if (s.kind === "final") {
    big = `Final${score}`; sub = "The agent is reading the sheet, the rate card and PayPal now"; body = payTable(onSheet(g), "On the sheet");
  } else if (s.kind === "held") {
    big = "Held for Sam"; sub = enc(heldNote(s.hold)); body = `<p class="d-note">${enc(s.hold.reason ?? "")}</p>` + payTable(onSheet(g), "On the sheet") + `<p class="d-note">Nothing was sent. The officials are paid when Sam decides.</p>`;
  } else if (s.kind === "unplayed") {
    big = "Not played"; sub = "The court closed and no other court could take it"; body = `<p class="d-note">${enc(g.note)}</p>`;
  } else {
    big = s.kind === "live" ? "In play" : "Not started"; sub = "The officials are paid about 40 seconds after the score is saved";
    body = payTable(onSheet(g), "Paid at the final buzzer") + `<p class="d-act"><a class="btn" href="/score.html#${enc(g.id)}">Score this game</a></p>`;
  }
  return `${bar}${head}<div class="d-flap ${face}"><span class="big">${big}</span><span class="sub">${sub}</span></div>${body}`;
}

/* ---- the header, the figures, the decision ---- */
function renderDays() {
  const names = { "2026-05-14": "Thu", "2026-05-15": "Fri", "2026-05-16": "Sat", "2026-05-17": "Sun" };
  $("days").innerHTML = days.map((d) => `<button class="day" type="button" data-day="${d}" aria-label="${new Date(d + "T12:00").toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long" })}"${d === day ? ' aria-current="date"' : ""}>${names[d] ?? d.slice(5)}<span class="num">${Number(d.slice(8))}</span></button>`).join("");
  $("days").querySelectorAll(".day").forEach((b) => b.addEventListener("click", () => { setDay(b.dataset.day); render(); }));
}
function render() {
  window.stopRiffle?.();
  renderDays();
  const dayGames = T.games.filter((g) => g.start.startsWith(day));
  const now = cursor();
  scheduler.features.timeRanges.store.removeAll();
  if (now && now.toISOString().slice(0, 10) === day) scheduler.features.timeRanges.store.add({ id: "now", startDate: now, name: hhmm(now), cls: "now-line" });
  scheduler.refreshRows?.();

  const states = dayGames.map((g) => ({ g, s: kindWithClock(g, now) }));
  const paid = states.filter((x) => x.s.kind === "paid");
  const secs = paid.map((x) => x.s.payout.secondsFromBuzzer).filter((v) => v != null);
  const dollars = paid.reduce((sum, x) => sum + x.s.payout.items.reduce((a, i) => a + Number(i.amount), 0), 0);
  $("paid-n").textContent = paid.length; $("of").textContent = dayGames.length;
  $("money").textContent = money(dollars);
  $("money-day").textContent = `paid out ${new Date(day + "T12:00").toLocaleDateString("en-CA", { weekday: "long" })}`;
  const last = Object.values(ledger.payouts).filter((p) => p.status === "SUCCESS" && p.secondsFromBuzzer != null && dayGames.some((g) => g.id === p.gameId)).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  if (last) {
    const mid = median(secs);
    const ss = String(Math.round(mid)).padStart(2, "0").slice(-2);
    setDigit("p1", ss[0]); setDigit("p2", ss[1]);
    const g = T.games.find((x) => x.id === last.gameId);
    $("secs-sr").textContent = `${mid} `;
    $("last-game").textContent = `The median of ${secs.length} paid game${secs.length === 1 ? "" : "s"} today, ${mid} s. Game ${g.number}, the latest, took ${last.secondsFromBuzzer} s.`;
  } else { setDigit("p1", "0"); setDigit("p2", "0"); $("last-game").textContent = paid.length ? "Paid in a dry run: PayPal was not called, so there is no time to show." : "No payout yet today."; }
  $("p1").classList.toggle("ghosted", !last); $("p2").classList.toggle("ghosted", !last);
  $("count-line").textContent = `${paid.length} of ${dayGames.length} games paid, ${money(dollars)} paid out.`;

  const holds = Object.values(ledger.holds).filter((h) => dayGames.some((g) => g.id === h.gameId)).sort((a, b) => a.at.localeCompare(b.at));
  const card = $("held-card");
  if (holds.length) {
    const at = Math.max(0, holds.findIndex((x) => x.gameId === picked));
    const h = holds[at]; const g = T.games.find((x) => x.id === h.gameId);
    const f = h.flags ?? {};
    card.hidden = false; card.dataset.game = g.id;
    $("held-title").innerHTML = `Game <span class="num">${g.number}</span> is held for Sam${holds.length > 1 ? `<small>${at + 1} of ${holds.length}<span class="hint">, tap a held tile for another</span></small>` : ""}`;
    $("held-text").textContent = holdLine(h, g);
    $("held-why").textContent = h.reason ?? "";
    $("held-staged").textContent = sheet.staged?.forfeit?.gameId === g.id ? "Staged for this replay: the real game was not forfeited." : sheet.staged?.missing_table_official?.gameId === g.id ? "Staged for this replay: the table official was taken off this game's sheet." : "";
    const full = Number(card_total(g));
    const a = sheet.assignments[g.id];
    // a game PayPal already paid offers no second payment, on the board and in resolve.ts
    $("pay-full").hidden = !!f.already_paid;
    $("pay-full").textContent = f.official_missing && a ? `Pay the ${a.referees.filter(Boolean).length + (a.table ? 1 : 0)} on the sheet, $${full}` : `Pay in full, $${full}`;
    $("pay-showup").hidden = card.dataset.showup === "none" || !f.forfeit;
    $("pay-nobody").textContent = f.already_paid ? "Right, nothing more" : "Pay nobody";
    $("pay-nobody").classList.toggle("second", !f.already_paid);
    $("held-note").textContent = lastAnswer ?? "";
  } else card.hidden = true;

  // a game the agent held while its drawer was open moves to Sam's card on the next draw
  if (opened && ledger.holds[opened]) { picked = opened; opened = null; if (location.hash) history.replaceState(null, "", location.pathname + location.search); return render(); }
  const og = opened && dayGames.find((g) => g.id === opened);
  const dr = $("game-card");
  if (og) { const html = gameCardHTML(og); if (html !== drawerHTML) { dr.innerHTML = html; drawerHTML = html; } } else drawerHTML = "";
  if (dr.hidden === !!og) { dr.hidden = !og; $("scrim").hidden = !og; document.documentElement.classList.toggle("drawer-open", !!og); }

  renderPhone(dayGames, now);
  renderEntries();
  flipped.clear();
}
/** The held card's one line, built from the hold's flags, the sheet, the card and the ledger, so every
 * clause is a field. The agent's own words stay one tap away, under "The agent's note". */
function holdLine(h, g) {
  const f = h.flags ?? {};
  if (f.already_paid) {
    const p = Object.values(ledger.payouts).find((x) => x.gameId === g.id && x.status === "SUCCESS");
    return p ? `PayPal already shows this game paid: $${p.items.reduce((s, i) => s + Number(i.amount), 0)} to ${p.items.length} officials. Nothing more was sent.` : "PayPal already shows this game paid. Nothing more was sent.";
  }
  if (f.forfeit) return `${matchup(g)} was a forfeit. The rate card pays a show-up fee for a forfeit, but has no amount for it yet.`;
  if (f.official_missing) {
    const a = sheet.assignments[g.id];
    return a && !a.table ? `${matchup(g)} has no table official on the sheet. Pay the ${a.referees.filter(Boolean).length} who are on it now, or nobody until the sheet says who sat at the table.` : `${matchup(g)} is missing an official on the sheet.`;
  }
  return h.question ?? h.reason;
}
function card_total(g) { const a = sheet.assignments[g.id]; if (!a) return 0; return (a.referees.filter(Boolean).length * card.per_game.referee) + (a.table ? card.per_game.table : 0); }
function median(xs) { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; }
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
function setDigit(id, v) {
  const el = $(id); if (el.textContent === v) return;
  if (reduced || !el.dataset.ready) { el.textContent = v; el.dataset.ready = "1"; return; }
  el.animate([{ transform: "rotateX(0)" }, { transform: "rotateX(-90deg)" }], { duration: 180, easing: "cubic-bezier(.6,0,.2,1)" }).finished.then(() => { el.textContent = v; el.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0)" }], { duration: 240, easing: "cubic-bezier(.22,.9,.32,1.04)" }); });
}
function renderPhone(dayGames, now) {
  const row = (g, s) => `<li data-game="${g.id}" aria-label="${enc(label(g, s))}"><b>${enc(matchup(g))}</b><span class="when">${g.start.slice(11)} ${enc(g.court)}</span><small>${enc(sentence(g.division))}</small></li>`;
  const live = dayGames.filter((g) => kindWithClock(g, now).kind === "live"), later = dayGames.filter((g) => kindWithClock(g, now).kind === "scheduled");
  const done = dayGames.map((g) => ({ g, s: kindWithClock(g, now) })).filter((x) => ["paid", "paying", "held", "folded"].includes(x.s.kind));
  $("phone").innerHTML =
    (live.length ? `<h3>In play <span class="num">${live.length}</span></h3><ul class="prows">${live.map((g) => row(g, { kind: "live" })).join("")}</ul>` : "") +
    (later.length ? `<h3>Next up <span class="num">${later.length}</span></h3><ul class="prows later">${later.slice(0, 4).map((g) => row(g, { kind: "scheduled" })).join("")}</ul>` : "") +
    `<h3>Final <span class="num">${done.length}</span></h3><ul class="minis">${done.map(({ g, s }, i) => `<li class="${s.kind}${firstPaint ? ` boot-in" style="--d:${Math.min(i * 35, 900)}ms` : ""}" data-game="${g.id}" aria-label="${enc(label(g, s))}"><span>Game <b class="num">${g.number}</b></span><span>${s.kind === "held" ? heldNote(s.hold) : s.kind === "folded" ? "Folds" : s.payout?.secondsFromBuzzer != null ? s.payout.secondsFromBuzzer + " s" : "Paid"}</span></li>`).join("")}</ul>`;
}
function renderEntries() {
  const byId = new Map(T.games.map((g) => [g.id, g]));
  // "payout_created" is the step before "paid"; the log keeps the outcome only
  // PayPal's webhooks arrive several to a payout: one line per game, with the count
  const kept = [];
  for (const e of ledger.events) { if (e.kind === "payout_created") continue; const last = kept[kept.length - 1]; if (e.kind === "webhook" && last?.kind === "webhook" && last.gameId === e.gameId) { last.n += 1; last.at = e.at; } else kept.push({ ...e, n: 1 }); }
  const recent = kept.slice(-6).reverse();
  const lines = recent.map((e) => {
    const g = byId.get(e.gameId); const t = new Date(e.at);
    const when = `<time class="num" datetime="${enc(e.at)}" title="${enc(t.toLocaleString("en-CA"))}">${hhmm(t)}</time>`;
    const G = g ? `Game ${g.number}, ${enc(matchup(g))}` : "";
    const d = e.detail;
    const p = g && Object.values(ledger.payouts).find((x) => x.gameId === g.id && x.status === "SUCCESS");
    switch (e.kind) {
      case "paid": return `${when}<span>${G} final. ${p ? `$${p.items.reduce((a, i) => a + Number(i.amount), 0)} to ${p.items.length} officials, all on the card. ` : ""}Paid ${d?.seconds ?? "?"} seconds after the buzzer.</span>`;
      case "hold": return `${when}<span><b>Held ${G.toLowerCase()}</b>: ${enc(String(d ?? ""))}</span>`;
      case "guard_block": return `${when}<span><b>The gate stopped a payout on ${G.toLowerCase()}</b>: ${enc(String(d ?? ""))}</span>`;
      case "paypal_duplicate": return `${when}<span><b>PayPal refused a second payout on ${G.toLowerCase()}</b>; nothing was sent twice.</span>`;
      case "fold": return `${when}<span>${G}: ${enc((d ?? []).map(who).join(", "))} paid with the evening payout, as they asked.</span>`;
      case "payout_created": return `${when}<span>${G}: payout sent to PayPal, batch ${enc(String(d ?? ""))}.</span>`;
      case "treasurer_paid": return `${when}<span>${G}: Sam chose ${enc(String(d?.choice ?? "").replace("_", " "))}; paid through PayPal.</span>`;
      case "treasurer_pay_nobody": return `${when}<span>${G}: Sam chose to pay nobody.</span>`;
      case "paypal_error": return `${when}<span>${G}: PayPal did not pay: ${enc(String(d ?? ""))}</span>`;
      case "no_paypal": return `${when}<span>${G}: PayPal switched off in this run; nothing could be sent.</span>`;
      case "webhook": return `${when}<span>${G}: PayPal confirmed it by webhook${e.n > 1 ? `, ${e.n} events` : ""}, each signature verified.</span>`;
      default: return `${when}<span>${G} ${enc(e.kind)}</span>`;
    }
  });
  $("entries").innerHTML = lines.map((html, i) => `<li${recent[i].gameId ? ` data-game="${enc(recent[i].gameId)}"` : ""}>${html}</li>`).join("") || `<li><time class="num">--:--</time><span>Nothing yet. The agent writes here as games go final.</span></li>`;
}
function renderRate() {
  const c = card;
  $("rate").innerHTML = `<p><b>$${c.per_game.referee} a ref, $${c.per_game.table} a table official, per game.</b> Two refs and one table official on every game, so a full game pays $${c.per_game.referee * 2 + c.per_game.table}.</p>` +
    `<p>On a forfeit the card pays a show-up fee only, so the agent stops and hands the game to Sam. Show-up fee: ${c.forfeit.show_up_fee == null ? "not set yet" : "$" + c.forfeit.show_up_fee}.</p>` +
    `<p>${c.provisional ? "Provisional until Sam sends his own card." : "Sam's card."} Officials appear as Official A to X until they agree to be named.</p>`;
  $("held-card").dataset.showup = c.forfeit.show_up_fee == null ? "none" : "set";
  $("rate-h").textContent = c.provisional ? "Provisional rate card" : "The rate card";
}

/* ---- Sam's PIN: on the public board a tap that pays, or a gym closing, is Sam's call ---- */
const PIN_KEY = "fb-sam-pin";
const getPin = () => { try { return sessionStorage.getItem(PIN_KEY) || ""; } catch { return ""; } };
const setPin = (p) => { try { sessionStorage.setItem(PIN_KEY, p); } catch { /* a private window forgets it on the next load */ } };
const samHeaders = () => (getPin() ? { "x-sam-pin": getPin() } : {});
/** Asks for the PIN in place (the held card's note, or the plan card), then retries the action. */
function askPin(host, message, retry) {
  host.innerHTML = `<form class="pin"><label>${enc(message)} <input type="password" inputmode="numeric" autocomplete="off" aria-label="Treasurer's PIN" required></label><button class="btn" type="submit">Confirm</button></form>`;
  const form = host.querySelector("form"), input = form.querySelector("input");
  form.addEventListener("submit", (e) => { e.preventDefault(); setPin(input.value.trim()); host.textContent = ""; retry(); });
  input.focus();
}

/* ---- the status line: live, and whether the agent is on duty ---- */
let agentText = "Live";
function busy(what) { $("source").textContent = what ?? agentText; $("source").parentElement.classList.toggle("busy", !!what); }
const agentLine = (a) => !a ? "Live" : a.ageSeconds < 90 ? "Live, agent on duty" : `Live, agent away since ${new Date(a.at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}`;

/* ---- Sam's tap ---- */
let lastAnswer = null;
for (const [id, choice] of [["pay-full", "pay_full"], ["pay-showup", "pay_show_up"], ["pay-nobody", "pay_nobody"]]) {
  $(id).addEventListener("click", async () => {
    const gameId = $("held-card").dataset.game; if (!gameId || !ledger.holds[gameId]) return;
    busy("Paying through PayPal");
    for (const b of ["pay-full", "pay-showup", "pay-nobody"]) $(b).disabled = true;
    let out, status = 0;
    try {
      const res = await fetch(`/api/holds/${encodeURIComponent(gameId)}`, { method: "POST", headers: { "Content-Type": "application/json", ...samHeaders() }, body: JSON.stringify({ choice }) });
      status = res.status; out = await res.json();
    } catch (e) { out = { ok: false, message: `The board could not reach the server: ${e.message}` }; }
    busy(null);
    for (const b of ["pay-full", "pay-showup", "pay-nobody"]) $(b).disabled = false;
    if (status === 401 && out.needsPin) { askPin($("sam-pin"), out.message, () => $(id).click()); return; }
    lastAnswer = out.message;
    $("held-note").textContent = out.message;
    if (out.ok) { flipped.add(gameId); await poll(); setTimeout(() => { lastAnswer = null; }, 8000); }
  });
}

/* ---- a gym closes ---- */
function renderClosure() {
  const dayGames = T.games.filter((g) => g.start.startsWith(day));
  const slots = [...new Set(dayGames.map((g) => g.start.slice(11)))].sort();
  $("close-court").innerHTML = courtsOn(day).map((c) => `<option value="${enc(c.name)}">${enc(c.name)}</option>`).join("");
  $("close-from").innerHTML = slots.map((s) => `<option value="${s}">${s}</option>`).join("");
}
$("close").addEventListener("submit", async (e) => {
  e.preventDefault();
  const court = $("close-court").value, from = $("close-from").value;
  const plan = $("plan");
  $("closer").open = false;
  plan.hidden = false; plan.innerHTML = `<h2>${enc(court)} closes at ${from}</h2><p class="quiet">The agent is re-planning the rest of the day against the schedule's rules.</p>`;
  busy("Re-planning");
  let r, status = 0;
  try { const res = await fetch("/api/replan", { method: "POST", headers: { "Content-Type": "application/json", ...samHeaders() }, body: JSON.stringify({ court, from, day }) }); status = res.status; r = await res.json(); }
  catch (err) { r = { ok: false, message: err.message }; }
  busy(null);
  if (status === 401 && r.needsPin) {
    plan.innerHTML = `<h2>${enc(court)} closes at ${from}</h2><div class="pin-host"></div>`;
    askPin(plan.querySelector(".pin-host"), r.message, () => { $("close-court").value = court; $("close-from").value = from; $("close").requestSubmit(); });
    return;
  }
  if (!r.ok) { plan.innerHTML += `<p class="quiet">${enc(r.message ?? "The server could not run the re-plan.")}</p>`; return; }
  const byN = new Map(T.games.map((g) => [g.number, g]));
  const moves = r.applied.map((m) => { const g = byN.get(m.game_number); return `<li><b>Game ${m.game_number}</b>, ${enc(g ? matchup(g) : "")}: ${enc(m.from.court)} ${m.from.start} to <b>${enc(m.to.court)} ${m.to.start}</b>${m.reassigned.length ? `, officials reassigned (${m.reassigned.length})` : ""}</li>`; }).join("");
  const lost = r.unplayable.map((u) => `<li><b>Game ${u.game_number}</b>, ${enc(u.teams.join(" v "))}: not played. ${enc(u.reason)}</li>`).join("");
  const refunds = r.refunds.map((f) => `<li>${enc(f.team)} (${enc(f.division)}): $${f.amount} ${f.currency}, ${enc(f.rule)}${f.via ? `, through PayPal ${enc(f.via)}` : ""}: ${enc(f.status)}</li>`).join("");
  plan.innerHTML = `<h2>${enc(court)} closed at ${from}</h2><p>${enc(r.summary ?? "")}</p>` +
    (moves ? `<h3>Moved</h3><ul>${moves}</ul>` : "") + (lost ? `<h3>Cannot be played</h3><ul>${lost}</ul>` : "") + (refunds ? `<h3>Refunds pro rata by the fee rule</h3><ul>${refunds}</ul>` : "") +
    (r.rejected.length ? `<h3>Moves the rules refused</h3><ul>${r.rejected.map((x) => `<li>Game ${x.game_number} to ${enc(x.wanted.court)} ${x.wanted.start}: ${enc(x.problems.join("; "))}</li>`).join("")}</ul>` : "") +
    `<p class="quiet">${r.loop.calls} model calls, ${r.steps.filter((s) => s.name === "check_move").length} placements checked, ${Math.round(r.loop.ms / 1000)} s.</p>`;
  await poll();
});

/* ---- polling: the scorer's app writes the document, the agent writes the ledger, the board reads both ---- */
let lastText = "";
async function poll() {
  try {
    const [l, r, d, a] = await Promise.all([
      fetch("/api/ledger").then((x) => x.text()),
      fetch("/api/replay").then((x) => x.json()).catch(() => null),
      fetch(`/api/tournament?v=${T.version}`).then((x) => (x.status === 304 ? null : x.json())).catch(() => null),
      fetch("/api/agent").then((x) => x.json()).catch(() => null),
    ]);
    replay = r;
    agentText = agentLine(a);
    if (!$("source").parentElement.classList.contains("busy")) $("source").textContent = agentText;
    let changed = false;
    if (d) { T = normalise(d); scheduler.eventStore.data = events(T); scheduler.resourceStore.data = courtsOn(day); renderClosure(); changed = true; }
    if (l !== lastText) {
      const next = JSON.parse(l) || { payouts: {}, holds: {}, folds: {}, events: [] };
      // the first read is the whole day arriving, not payouts landing: the boot cascade shows it instead
      if (lastText) for (const p of Object.values(next.payouts ?? {})) if (p.status === "SUCCESS" && ledger.payouts[p.senderBatchId]?.status !== "SUCCESS") flipped.add(p.gameId);
      ledger = next; lastText = l; changed = true;
    }
    if (changed) render();
  } catch (e) { $("source").textContent = "Ledger unreadable"; }
}

renderRate();
renderClosure();
$("club").textContent = T.association || "Northside Youth Basketball";
await poll();
firstPaint = true;
render();
document.documentElement.classList.remove("booting");
document.documentElement.classList.add("booted");
setTimeout(() => { firstPaint = false; }, 1800);
if (location.hash.length > 1) openGame(hashId());
setInterval(poll, 2500);
