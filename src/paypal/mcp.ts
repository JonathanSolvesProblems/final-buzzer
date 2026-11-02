/**
 * PayPal's MCP server as the agent's hands for invoicing, refunds and reporting.
 *
 * The server (@paypal/mcp) runs as a child process over stdio with a short-lived access token
 * minted from the sandbox app's credentials. Each agent gets only the tools its job needs: the
 * allowlist is enforced here, not in the prompt.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { accessToken } from "./auth.ts";
import type { ToolDef } from "../agent/loop.ts";

const require = createRequire(import.meta.url);

export interface PayPalMcp {
  client: Client;
  /** Tools as the loop sees them, restricted to `names`. Unknown names throw, so a typo cannot widen the list. */
  tools: (names: string[]) => ToolDef[];
  /** Call a tool directly from code (the harness paying invoices out, not the model). */
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

/** `groups` is the server's own filter, e.g. ["invoices.create", "invoices.send"]. */
export async function connectPayPalMcp(groups: string[]): Promise<PayPalMcp> {
  const token = await accessToken();
  const serverPath = require.resolve("@paypal/mcp/dist/index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, `--tools=${groups.join(",")}`],
    env: { ...process.env as Record<string, string>, PAYPAL_ACCESS_TOKEN: token, PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENV === "live" ? "PRODUCTION" : "SANDBOX" },
    stderr: "pipe",
  });
  const client = new Client({ name: "final-buzzer", version: "0.1.0" });
  await client.connect(transport);
  const listed = (await client.listTools()).tools;

  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* the server answers prose for some calls */ }
    // the toolkit reports some HTTP failures as a normal result with ok:false; treat them as errors too
    const failed = parsed && typeof parsed === "object" && (parsed as any).ok === false;
    if (failed) {
      const status = Number((parsed as any).status ?? 0);
      const message = String((parsed as any).message ?? text).slice(0, 500);
      return { isError: true, errorCategory: status === 401 || status === 403 ? "permission" : status >= 500 ? "transient" : "validation", isRetryable: status >= 500, details: parsed,
        message: status === 403 ? `${message} In the sandbox app, the matching feature (Invoicing, Transaction Search) must be ticked under Features.` : message };
    }
    if (res.isError) {
      return { isError: true, errorCategory: /permission|unauthori[sz]ed|403/i.test(text) ? "permission" : /not found|invalid|required/i.test(text) ? "validation" : "business", isRetryable: false, message: text.slice(0, 500), details: parsed };
    }
    return parsed;
  };

  return {
    client, call,
    tools: (names) => names.map((n) => {
      const t = listed.find((x) => x.name === n);
      if (!t) throw new Error(`PayPal MCP server has no tool ${n}; it offers ${listed.map((x) => x.name).join(", ")}`);
      return { name: t.name, description: t.description ?? t.name, input_schema: t.inputSchema as Record<string, unknown>, run: (input: Record<string, unknown>) => call(t.name, input) };
    }),
    close: () => client.close(),
  };
}
