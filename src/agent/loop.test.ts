import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoop, type MessagesClient, type ToolDef } from "./loop.ts";

/** A scripted model: each call answers with the next scripted message, and records what it was sent. */
function scripted(turns: Array<{ stop: string; content: any[] }>): MessagesClient & { sent: any[] } {
  const sent: any[] = [];
  return {
    sent,
    // the loop mutates one messages array between calls, so keep a snapshot of what each call saw
    messages: { create: async (req: any) => { sent.push({ ...req, messages: structuredClone(req.messages) }); const t = turns.shift()!; return { id: "m", type: "message", role: "assistant", model: "fake", content: t.content, stop_reason: t.stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } } as any; } },
  };
}
const use = (id: string, name: string, input: any = {}) => ({ type: "tool_use", id, name, input });
const tools: ToolDef[] = [
  { name: "read", description: "read", input_schema: { type: "object", properties: {} }, run: () => ({ sheet: "ok" }) },
  { name: "boom", description: "fails", input_schema: { type: "object", properties: {} }, run: () => { throw new Error("no answer"); } },
  { name: "decide", description: "decide", input_schema: { type: "object", properties: {} }, terminal: true, run: (i: any) => ({ recorded: i.choice }) },
];

test("tool_use runs the tool, appends the result and calls again; the terminal tool ends the loop", async () => {
  const client = scripted([
    { stop: "tool_use", content: [{ type: "text", text: "reading" }, use("1", "read")] },
    { stop: "tool_use", content: [use("2", "decide", { choice: "pay_now" })] },
  ]);
  const r = await runLoop({ system: "s", user: "u", tools, client });
  assert.equal(r.endedBy, "terminal");
  assert.equal(r.terminal?.name, "decide");
  assert.equal(r.usage.calls, 2);
  const second = client.sent[1].messages;
  assert.equal(second.at(-1).role, "user");
  assert.equal(second.at(-1).content[0].type, "tool_result");
  assert.equal(second.at(-1).content[0].tool_use_id, "1");
  assert.match(second.at(-1).content[0].content, /sheet/);
});

test("end_turn without a decision gets one nudge, then stops", async () => {
  const client = scripted([
    { stop: "end_turn", content: [{ type: "text", text: "done I think" }] },
    { stop: "end_turn", content: [{ type: "text", text: "still done" }] },
  ]);
  const r = await runLoop({ system: "s", user: "u", tools, client });
  assert.equal(r.endedBy, "end_turn");
  assert.equal(r.terminal, null);
  assert.equal(client.sent.length, 2);
  assert.match(client.sent[1].messages.at(-1).content, /call it now/i);
});

test("max_tokens is a cut-off reply, not an answer: the loop continues with more room", async () => {
  const client = scripted([
    { stop: "max_tokens", content: [{ type: "text", text: "half a" }] },
    { stop: "tool_use", content: [use("3", "decide", { choice: "hold" })] },
  ]);
  const r = await runLoop({ system: "s", user: "u", tools, client, maxTokens: 100 });
  assert.equal(r.endedBy, "terminal");
  assert.equal(client.sent[1].max_tokens, 200);
});

test("a tool that throws becomes a structured error result, never a crash", async () => {
  const client = scripted([
    { stop: "tool_use", content: [use("4", "boom")] },
    { stop: "tool_use", content: [use("5", "decide", { choice: "hold" })] },
  ]);
  const r = await runLoop({ system: "s", user: "u", tools, client });
  const res = client.sent[1].messages.at(-1).content[0];
  assert.equal(res.is_error, true);
  assert.match(res.content, /no answer/);
  assert.equal(r.endedBy, "terminal");
});

test("the call cap is a safety net: the loop stops and says so", async () => {
  const client = scripted(Array.from({ length: 5 }, (_, i) => ({ stop: "tool_use", content: [use(String(i), "read")] })));
  const r = await runLoop({ system: "s", user: "u", tools, client, maxCalls: 3 });
  assert.equal(r.endedBy, "cap");
  assert.equal(r.usage.calls, 3);
});

test("a model error is reported as an error, not as a decision", async () => {
  const client: MessagesClient = { messages: { create: async () => { throw new Error("credit balance is too low"); } } };
  const r = await runLoop({ system: "s", user: "u", tools, client });
  assert.equal(r.endedBy, "error");
  assert.match(r.error ?? "", /credit/);
});
