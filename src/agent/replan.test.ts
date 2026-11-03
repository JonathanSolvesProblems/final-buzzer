import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromFile } from "../app/feed.ts";
import { loadSheet } from "./sheet.ts";
import { affectedGames, freeSlots, checkMove, refundFor, shareFloor } from "./replan.ts";

const t = await loadFromFile("data/tournament-2026.json");
const sheet = await loadSheet();
const doc = JSON.parse(await (await import("node:fs/promises")).readFile("data/tournament-2026.json", "utf8"));
const courts = doc.courts.map((c: any) => ({ id: c.id, name: /^\d+$/.test(c.name) ? `Lakeside ${c.name}` : c.name, venue: c.venue ?? "" }));
const closure = { day: "2026-05-16", court: "Gym D", from: "14:00" };

test("a closure at 14:00 on Gym D takes out the afternoon games there", () => {
  const a = affectedGames(t, closure);
  assert.ok(a.length >= 1);
  assert.ok(a.every((g) => shareFloor(g.court, "Gym D") && g.start >= "2026-05-16T14:00"));
  assert.ok(a.some((g) => g.court === "Gym D"));
});
test("free slots exclude the closed court and taken slots, and offer one extra slot per court", () => {
  const s = freeSlots(t, closure, courts);
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => x.court !== "Gym D"));
  assert.ok(s.some((x) => x.start === "19:00"), "an extra slot after the last start");
  assert.ok(!s.some((x) => t.games.some((g) => g.court === x.court && g.start === `2026-05-16T${x.start}`)), "no taken slot offered");
});
test("a move onto a taken slot is rejected, a move onto a free slot is accepted", () => {
  const g = affectedGames(t, closure).find((x) => x.court === "Gym D")!;
  const taken = t.games.find((x) => x.start.startsWith("2026-05-16") && x.court !== "Gym D" && x.id !== g.id)!;
  assert.equal(checkMove(t, sheet, g, taken.court, taken.start.slice(11)).ok, false);
  const free = freeSlots(t, closure, courts).find((s) => checkMove(t, sheet, g, s.court, s.start).ok);
  assert.ok(free, "some free slot passes for the first affected game");
});
test("a team cannot be placed within two hours of its own other game", () => {
  const g = affectedGames(t, closure).find((x) => x.court === "Gym D" && x.home && t.games.some((y) => y.id !== x.id && y.division === x.division && y.start.startsWith("2026-05-16") && (y.home === x.home || y.away === x.home)))!;
  const other = t.games.find((x) => x.id !== g.id && x.division === g.division && x.start.startsWith("2026-05-16") && (x.home === g.home || x.away === g.home))!;
  const c = checkMove(t, sheet, g, "Gym A", other.start.slice(11));
  assert.ok(c.problems.some((p) => /less than two hours/.test(p)), c.problems.join("; "));
});
test("the refund is the fee divided by the games the team was scheduled to play", () => {
  const g = t.games.find((x) => x.stage === "pool" && x.home)!;
  const r = refundFor(t, g.home!, g.division, 350);
  assert.ok(r.gamesScheduled >= 2);
  assert.equal(r.perGame, Math.round((350 / r.gamesScheduled) * 100) / 100);
});

test("joined courts share a floor with their halves, and nothing else", async () => {
  const { shareFloor } = await import("./replan.ts");
  assert.ok(shareFloor("Gym CD", "Gym C"));
  assert.ok(shareFloor("Gym D", "Gym CD"));
  assert.ok(shareFloor("Gym EF", "Gym E"));
  assert.ok(!shareFloor("Gym CD", "Gym EF"));
  assert.ok(!shareFloor("Gym C", "Gym D"));
  assert.ok(!shareFloor("Lakeside 1", "Lakeside 2"));
});
test("a joined court is refused while one of its halves has a game", () => {
  const sun = { day: "2026-05-17", court: "Gym E", from: "09:00" };
  const g = affectedGames(t, sun).find((x) => x.court === "Gym E")!;
  const halfBusy = t.games.find((x) => x.start === g.start && (x.court === "Gym C" || x.court === "Gym D"));
  if (halfBusy) {
    const c = checkMove(t, sheet, g, "Gym CD", g.start.slice(11), new Set(), sun);
    assert.equal(c.ok, false);
    assert.match(c.problems.join(), /shares its floor/);
  }
  const ef = checkMove(t, sheet, g, "Gym EF", g.start.slice(11), new Set(), sun);
  assert.equal(ef.ok, false, "Gym EF shares a floor with the closed Gym E");
});
test("a playoff game cannot move past the start of the game its result feeds", () => {
  const quarter = t.games.find((x) => x.stage === "quarter" && t.games.some((d) => d.feeds.includes(x.id)))!;
  const dependent = t.games.find((d) => d.feeds.includes(quarter.id))!;
  const tooLate = dependent.start.slice(11);
  const c = checkMove(t, sheet, quarter, "Gym F", tooLate);
  assert.ok(c.problems.some((p) => /needs this game's result/.test(p)), c.problems.join("; "));
});
test("the half of a joined court that stays open is offered at the times the joined court's games leave", () => {
  const sun = { day: "2026-05-17", court: "Gym E", from: "09:00" };
  const leaving = affectedGames(t, sun).filter((g) => g.court === "Gym EF").map((g) => g.start.slice(11));
  const f = freeSlots(t, sun, t.courts).filter((s) => s.court === "Gym F").map((s) => s.start);
  assert.ok(leaving.length > 0);
  for (const s of leaving) if (!t.games.some((g) => g.court === "Gym F" && g.start === `2026-05-17T${s}`)) assert.ok(f.includes(s), `Gym F should be free at ${s}`);
});
