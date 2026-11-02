import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromFile } from "../app/feed.ts";
import { loadSheet } from "./sheet.ts";
import { affectedGames, freeSlots, checkMove, refundFor } from "./replan.ts";

const t = await loadFromFile("data/tournament-2026.json");
const sheet = await loadSheet();
const doc = JSON.parse(await (await import("node:fs/promises")).readFile("data/tournament-2026.json", "utf8"));
const courts = doc.courts.map((c: any) => ({ id: c.id, name: /^\d+$/.test(c.name) ? `Lakeside ${c.name}` : c.name, venue: c.venue ?? "" }));
const closure = { day: "2026-05-16", court: "Gym D", from: "14:00" };

test("a closure at 14:00 on Gym D takes out the afternoon games there", () => {
  const a = affectedGames(t, closure);
  assert.ok(a.length >= 1);
  assert.ok(a.every((g) => g.court === "Gym D" && g.start >= "2026-05-16T14:00"));
});
test("free slots exclude the closed court and taken slots, and offer one extra slot per court", () => {
  const s = freeSlots(t, closure, courts);
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => x.court !== "Gym D"));
  assert.ok(s.some((x) => x.start === "19:00"), "an extra slot after the last start");
  assert.ok(!s.some((x) => t.games.some((g) => g.court === x.court && g.start === `2026-05-16T${x.start}`)), "no taken slot offered");
});
test("a move onto a taken slot is rejected, a move onto a free slot is accepted", () => {
  const g = affectedGames(t, closure)[0];
  const taken = t.games.find((x) => x.start.startsWith("2026-05-16") && x.court !== "Gym D" && x.id !== g.id)!;
  assert.equal(checkMove(t, sheet, g, taken.court, taken.start.slice(11)).ok, false);
  const free = freeSlots(t, closure, courts).find((s) => checkMove(t, sheet, g, s.court, s.start).ok);
  assert.ok(free, "some free slot passes for the first affected game");
});
test("a team cannot be placed within two hours of its own other game", () => {
  const g = affectedGames(t, closure)[0];
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
