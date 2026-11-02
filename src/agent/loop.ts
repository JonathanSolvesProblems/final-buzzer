/**
 * The agent loop on the Claude Messages API. Control flow is stop_reason and nothing else:
 * "tool_use" runs the tools and calls again, "end_turn" is done, "max_tokens" is a cut-off reply
 * and is retried with more room. The iteration cap is a safety net, never the stop.
 *
 * A tool marked terminal (the decision) ends the loop once it has run.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  terminal?: boolean;
  run: (input: any) => Promise<unknown> | unknown;
}

export interface TraceStep {
  t: string;                        // ISO time
  ms: number;                       // since loop start
  kind: "model" | "tool" | "note";
  name?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LoopResult {
  terminal: { name: string; input: any } | null;
  steps: TraceStep[];
  usage: { input_tokens: number; output_tokens: number; calls: number };
  endedBy: "terminal" | "end_turn" | "cap" | "error";
  error?: string;
  model: string;
  startedAt: string;
  finishedAt: string;
}

export const DEFAULT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";

export async function runLoop(opts: {
  system: string;
  user: string;
  tools: ToolDef[];
  model?: string;
  maxCalls?: number;
  maxTokens?: number;
  onStep?: (s: TraceStep) => void;
}): Promise<LoopResult> {
  const client = new Anthropic();
  const model = opts.model ?? DEFAULT_MODEL;
  const t0 = Date.now();
  const steps: TraceStep[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };
  const push = (s: Omit<TraceStep, "t" | "ms">) => { const step = { t: new Date().toISOString(), ms: Date.now() - t0, ...s }; steps.push(step); opts.onStep?.(step); };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
  const toolDefs: Anthropic.Tool[] = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema }));
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const maxCalls = opts.maxCalls ?? 12;
  let maxTokens = opts.maxTokens ?? 1500;
  let nudged = false;
  const done = (endedBy: LoopResult["endedBy"], terminal: LoopResult["terminal"], error?: string): LoopResult =>
    ({ terminal, steps, usage, endedBy, error, model, startedAt: new Date(t0).toISOString(), finishedAt: new Date().toISOString() });

  while (usage.calls < maxCalls) {
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({ model, max_tokens: maxTokens, system: opts.system, messages, tools: toolDefs });
    } catch (e) {
      push({ kind: "note", text: `model call failed: ${(e as Error).message}` });
      return done("error", null, (e as Error).message);
    }
    usage.calls++; usage.input_tokens += res.usage.input_tokens; usage.output_tokens += res.usage.output_tokens;
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    push({ kind: "model", text, stop_reason: res.stop_reason ?? undefined, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } });
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "max_tokens") {
      maxTokens = Math.min(maxTokens * 2, 8000);
      messages.push({ role: "user", content: "Your reply was cut off. Continue, and finish by calling decide." });
      continue;
    }
    if (res.stop_reason === "tool_use") {
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const results: Anthropic.ToolResultBlockParam[] = [];
      let terminal: LoopResult["terminal"] = null;
      for (const u of uses) {
        const def = byName.get(u.name);
        let output: unknown; let isError = false;
        if (!def) { output = { isError: true, errorCategory: "validation", isRetryable: false, message: `no tool named ${u.name}` }; isError = true; }
        else {
          try { output = await def.run(u.input); } catch (e) { output = { isError: true, errorCategory: "transient", isRetryable: true, message: (e as Error).message }; isError = true; }
          if ((output as any)?.isError) isError = true;
        }
        push({ kind: "tool", name: u.name, input: u.input, output });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(output), is_error: isError || undefined });
        if (def?.terminal && !isError) terminal = { name: u.name, input: u.input };
      }
      messages.push({ role: "user", content: results });
      if (terminal) return done("terminal", terminal);
      continue;
    }
    // end_turn (or anything else) without the decision: one nudge, then stop.
    if (!nudged) {
      nudged = true;
      messages.push({ role: "user", content: "You have not called decide. Call it now with your decision." });
      push({ kind: "note", text: "nudged: ended without a decision" });
      continue;
    }
    return done("end_turn", null);
  }
  push({ kind: "note", text: `stopped at the call cap of ${maxCalls}` });
  return done("cap", null);
}
