import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromFile, isFinal, matchup } from "./feed.ts";

test("the real 2026 document normalises to 88 numbered games in start order", async () => {
  const t = await loadFromFile("data/tournament-2026.json");
  assert.equal(t.slug, "northside-2026");
  assert.equal(t.games.length, 88);
  assert.equal(t.games[0].number, 1);
  assert.equal(t.games.at(-1)!.number, 88);
  for (let i = 1; i < t.games.length; i++) assert.ok(t.games[i - 1].start <= t.games[i].start, "games are in start order");
  assert.equal(t.games.filter(isFinal).length, 0, "nothing is final in the document as served");
});

test("numbering follows the document's court order within a time slot, whatever a court is called", async () => {
  const t = await loadFromFile("data/tournament-2026.json");
  const slot = t.games.filter((g) => g.start === "2026-05-16T11:30");
  const doc = JSON.parse(await (await import("node:fs/promises")).readFile("data/tournament-2026.json", "utf8"));
  const order = doc.courts.map((c: any) => c.id);
  for (let i = 1; i < slot.length; i++) assert.ok(order.indexOf(slot[i - 1].courtId) < order.indexOf(slot[i].courtId));
  assert.equal(t.games.find((g) => g.home === "Lakeshore 2" && g.start === "2026-05-16T11:30")!.number, 26);
});

test("Lakeside's bare court numbers get their venue", async () => {
  const t = await loadFromFile("data/tournament-2026.json");
  const lcc = t.games.filter((g) => g.venue === "Lakeside College");
  assert.ok(lcc.length > 0);
  assert.ok(lcc.every((g) => g.court === "Lakeside 1" || g.court === "Lakeside 2"), lcc.map((g) => g.court).join(","));
});

test("a matchup names both teams or falls back to the stage", async () => {
  const t = await loadFromFile("data/tournament-2026.json");
  const pool = t.games.find((g) => g.stage === "pool")!;
  assert.match(matchup(pool), / v /);
  const fin = t.games.find((g) => g.stage === "final" && !g.home)!;
  assert.equal(matchup(fin), "final");
});
