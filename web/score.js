/* The scorer's phone: the one input the whole system turns on. A save here bumps the document's
   version, stamps the save time on the game, and the agent on duty (src/cli/watch.ts) takes it from
   there. The ledger is polled so the row shows when the officials were paid. */
import { normalise, matchup, sentence, get, heldNote } from "/feed.js";

const $ = (id) => document.getElementById(id);
let T = normalise(await get("/api/tournament"));
let ledger = { payouts: {}, holds: {} };
const days = [...new Set(T.games.map((g) => g.start.slice(0, 10)))].sort();
let day = days.find((d) => d.endsWith("05-16")) ?? days[0];
let court = "all";
let open = null;
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
    // the ledger first, as on the board: a game the agent paid or held reads that way whatever the document says
    const state = h ? `<span class="state">${heldNote(h)}</span>` : p ? `<span class="state paid">Officials paid${p.secondsFromBuzzer != null ? ", " + p.secondsFromBuzzer + " s after the buzzer" : ""}</span>` : g.status === "scheduled" ? "" : `<span class="state">${sentence(g.status)}${g.hs != null ? ` ${g.hs} to ${g.as}` : ""}, agent working</span>`;
    const isOpen = open === g.id;
    return `<li class="${isOpen ? "open" : ""}" data-id="${g.id}">
      <b>${matchup(g)}</b><span class="when">${g.start.slice(11)} ${g.court}</span>
      <small>Game ${g.number}, ${sentence(g.division)}. ${state}</small>
      ${isOpen ? `<div class="sheet"><label>${g.home ?? "Home"}<input type="number" inputmode="numeric" min="0" max="199" id="hs" value="${g.hs ?? ""}"></label><span class="v">v</span><label>${g.away ?? "Away"}<input type="number" inputmode="numeric" min="0" max="199" id="as" value="${g.as ?? ""}"></label></div>
      <div class="acts"><button class="btn" type="button" id="final">Final</button><button class="btn second" type="button" id="forfeit">Forfeit</button><button class="btn second" type="button" id="reopen">Reopen</button></div><p class="saved" id="saved"></p>` : ""}
    </li>`;
  }).join("");
  $("games").querySelectorAll("li").forEach((li) => li.addEventListener("click", (e) => { if (e.target.closest(".sheet, .acts")) return; open = open === li.dataset.id ? null : li.dataset.id; render(); }));
  if (open) {
    const g = T.games.find((x) => x.id === open);
    const save = async (status) => {
      const hs = $("hs").value === "" ? null : Number($("hs").value), as = $("as").value === "" ? null : Number($("as").value);
      if (status === "final" && (hs == null || as == null)) { $("saved").textContent = "Both scores first."; return; }
      const body = status === "forfeit" ? { status, hs: 20, as: 0, note: "forfeit" } : status === "scheduled" ? { status, hs: null, as: null } : { status, hs, as };
      const r = await fetch(`/api/games/${encodeURIComponent(g.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
      $("saved").textContent = r.ok ? (status === "scheduled" ? "Reopened." : `Saved ${new Date(r.game.finalAt).toLocaleTimeString("en-CA")}. The agent is on it.`) : r.message;
      T = normalise(await get("/api/tournament"));
      setTimeout(render, 900);
    };
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
setInterval(poll, 2500);
