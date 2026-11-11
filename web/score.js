/* The scorer's phone: the one input the whole system turns on. A save here bumps the document's
   version, stamps the save time on the game, and the agent on duty (src/cli/watch.ts) takes it from
   there. The ledger is polled so the row shows when the officials were paid. */
import { normalise, matchup, sentence, get, heldNote } from "/feed.js";

const $ = (id) => document.getElementById(id);
const [doc0, ledger0] = await Promise.all([get("/api/tournament"), fetch("/api/ledger").then((r) => r.json()).catch(() => null)]);
let T = normalise(doc0);
let ledger = ledger0 ?? { payouts: {}, holds: {}, folds: {} };
const days = [...new Set(T.games.map((g) => g.start.slice(0, 10)))].sort();
const toScore = (d) => T.games.filter((g) => g.start.startsWith(d) && g.status === "scheduled").length;
let day = [...days].sort((a, b) => toScore(b) - toScore(a) || a.localeCompare(b))[0] ?? days[0];
let court = "all";
let open = null;
const notes = {};   // what the last save on a game said, kept across redraws (HTML, built here only)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// the board's "Score this game" lands here as /score.html#<game id>
const hashId = (() => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; } })();
const linked = T.games.find((g) => g.id === hashId);
if (linked) { day = linked.start.slice(0, 10); open = linked.id; }
const names = { "2026-05-14": "Thu", "2026-05-15": "Fri", "2026-05-16": "Sat", "2026-05-17": "Sun" };

function render() {
  $("days").innerHTML = days.map((d) => `<button type="button" data-day="${d}" aria-pressed="${d === day}">${names[d] ?? d} <span class="num">${Number(d.slice(8))}</span></button>`).join("");
  $("days").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { day = b.dataset.day; court = "all"; render(); }));
  const dayGames = T.games.filter((g) => g.start.startsWith(day));
  const courts = [...new Set(dayGames.map((g) => g.court))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  $("courts").innerHTML = [`<button type="button" data-court="all" aria-pressed="${court === "all"}">All courts</button>`, ...courts.map((c) => `<button type="button" data-court="${c}" aria-pressed="${court === c}">${c}</button>`)].join("");
  $("courts").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { court = b.dataset.court; render(); }));
  const list = dayGames.filter((g) => court === "all" || g.court === court);
  $("games").innerHTML = list.map((g) => {
    const p = Object.values(ledger.payouts).find((x) => x.gameId === g.id && (x.status === "SUCCESS" || x.status === "DRY_RUN"));
    const h = ledger.holds[g.id];
    const folded = Object.values(ledger.folds ?? {}).flat().some((f) => f.gameId === g.id);
    const score = g.hs != null && g.status !== "scheduled" ? ` ${Number(g.hs)} to ${Number(g.as)}.` : "";
    // the ledger first, as on the board: a game the agent paid or held reads that way whatever the document says
    const state = h ? `<span class="state">${heldNote(h)}</span>` : p ? `${score} <span class="state paid">Officials paid${p.secondsFromBuzzer != null ? ", " + p.secondsFromBuzzer + " s after the buzzer" : ""}</span>` : folded ? `<span class="state">Folds to end of day</span>` : g.status === "scheduled" ? "" : `<span class="state">${sentence(g.status)}${score.replace(/[.]$/, "")}, agent working</span>`;
    const isOpen = open === g.id;
    return `<li class="${isOpen ? "open" : ""}" data-id="${g.id}">
      <b>${matchup(g)}</b><span class="when">${g.start.slice(11)} ${g.court}</span>
      <small>Game ${g.number}, ${sentence(g.division)}. ${state}</small>
      ${isOpen ? `<div class="sheet"><label>${g.home ?? "Home"}<input type="number" inputmode="numeric" min="0" max="199" id="hs" value="${g.hs == null ? "" : Number(g.hs)}"></label><span class="v">v</span><label>${g.away ?? "Away"}<input type="number" inputmode="numeric" min="0" max="199" id="as" value="${g.as == null ? "" : Number(g.as)}"></label></div>
      <div class="acts"><button class="btn" type="button" id="final">Final</button><button class="btn second" type="button" id="forfeit">Forfeit</button><button class="btn second" type="button" id="reopen">Reopen</button></div><p class="saved" id="saved" aria-live="polite">${notes[g.id] ?? ""}</p>` : ""}
    </li>`;
  }).join("");
  $("games").querySelectorAll("li").forEach((li) => li.addEventListener("click", (e) => { if (e.target.closest(".sheet, .acts, .saved")) return; open = open === li.dataset.id ? null : li.dataset.id; render(); }));
  if (open) {
    const g = T.games.find((x) => x.id === open);
    let saving = false;
    const whole = (v) => Number.isInteger(v) && v >= 0 && v <= 199;
    const save = async (status) => {
      if (saving) return;
      const hs = $("hs").value === "" ? null : Number($("hs").value), as = $("as").value === "" ? null : Number($("as").value);
      if (status === "final" && (hs == null || as == null)) { $("saved").textContent = "Both scores first."; return; }
      if (status === "final" && !(whole(hs) && whole(as))) { $("saved").textContent = "Scores are whole numbers from 0 to 199."; return; }
      if (status === "final" && hs === as) { $("saved").textContent = "A basketball game cannot end level. Check the scores."; return; }
      saving = true; for (const id of ["final", "forfeit", "reopen"]) $(id).disabled = true;
      const body = status === "forfeit" ? { status, hs: 20, as: 0, note: "forfeit" } : status === "scheduled" ? { status, hs: null, as: null } : { status, hs, as };
      const r = await fetch(`/api/games/${encodeURIComponent(g.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch((e) => ({ ok: false, message: `The page could not reach the server: ${e.message}` }));
      const at = r.ok && r.game.finalAt ? new Date(r.game.finalAt).toLocaleTimeString("en-GB") : "";
      notes[g.id] = !r.ok ? esc(r.message) : status === "scheduled" ? "Reopened." :
        r.budget?.exhausted ? `Saved at ${at}. ${esc(r.budget.message)} The agent holds this game for Sam instead of paying it. <a href="/#${encodeURIComponent(g.id)}">See it on the board</a>` :
        `Saved at ${at}. The agent is on it, usually paid within a minute. <a href="/#${encodeURIComponent(g.id)}">Watch it on the board</a>`;
      $("saved").innerHTML = notes[g.id];
      T = normalise(await get("/api/tournament"));
      setTimeout(render, 900);
    };
    if (!$("final")) return; // the open game is on another day or court
    $("final").addEventListener("click", () => save("final"));
    $("forfeit").addEventListener("click", () => save("forfeit"));
    $("reopen").addEventListener("click", () => save("scheduled"));
  }
}
async function poll() {
  try {
    const [doc, l] = await Promise.all([get("/api/tournament"), fetch("/api/ledger").then((r) => r.json()).catch(() => null)]);
    const next = normalise(doc);
    const changed = JSON.stringify(next.games.map((g) => [g.id, g.status])) !== JSON.stringify(T.games.map((g) => [g.id, g.status])) || JSON.stringify(l) !== JSON.stringify(ledger);
    T = next; if (l) ledger = l;
    if (changed && !document.activeElement?.matches("input")) render();
  } catch { /* the next poll will try again */ }
}
render();
if (linked) document.querySelector(`[data-id="${linked.id}"]`)?.scrollIntoView({ block: "center" });
setInterval(poll, 2500);
// the public demo caps the agent's runs per day; when the cap is reached the page says so before anyone scores
fetch("/api/budget").then((r) => r.json()).then((b) => { if (b?.exhausted) document.querySelector(".intro").textContent = `${b.message} A game saved now is held for Sam on the board, not paid.`; }).catch(() => {});
