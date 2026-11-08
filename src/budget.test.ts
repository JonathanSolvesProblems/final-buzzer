import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "final-buzzer-budget-"));
process.env.BUDGET_FILE = join(dir, "budget.json");
process.env.MODEL_RUNS_PER_DAY = "2";
const { spendModelRun, peekBudget } = await import("./budget.ts");

test("the public demo's daily cap refuses the third run and says so, and a peek spends nothing", async () => {
  assert.equal((await peekBudget()).used, 0);
  assert.equal((await spendModelRun("game 1")).ok, true);
  assert.equal((await spendModelRun("game 2")).ok, true);
  const third = await spendModelRun("game 3");
  assert.equal(third.ok, false);
  assert.match(third.message, /used up/);
  const peek = await peekBudget();
  assert.equal(peek.used, 2);
  assert.equal(peek.exhausted, true);
  assert.equal(peek.message, third.message);
  await rm(dir, { recursive: true, force: true });
});
