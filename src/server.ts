/**
 * The board's server: static files from web/, the Bryntum package, and the agent's results as JSON.
 *
 *   node --env-file=.env src/server.ts        ->  http://localhost:4173/
 */
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { loadFromFile } from "./app/feed.ts";
import { loadSheet, loadRateCard } from "./agent/sheet.ts";
import { loadLedger, saveLedger } from "./ledger.ts";
import { resolveHold, type TreasurerChoice } from "./agent/resolve.ts";
import { handleWebhook } from "./webhooks.ts";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT ?? 4173);
const LEDGER = process.env.LEDGER ?? "results/ledger.json";
const PAYPAL_MODE = (process.env.PAYPAL_CLIENT_ID ? "live" : "dry") as "live" | "dry";

/** Sam's tap on a held game: POST /api/holds/<gameId> {"choice":"pay_full"|"pay_show_up"|"pay_nobody"} */
async function treasurerDecides(gameId: string, choice: TreasurerChoice) {
  const t = await loadFromFile("data/tournament-2026.json");
  const ledger = await loadLedger(LEDGER, t.slug);
  const hold = ledger.holds[gameId];
  const game = t.games.find((g) => g.id === gameId);
  if (!game || !hold) return { ok: false, message: "no such held game" };
  game.status = hold.flags?.forfeit ? "forfeit" : "final"; // the board's copy of the document has no scores; the hold carries the state
  const runId = Object.values(ledger.payouts).map((p) => p.senderBatchId.match(/^northside-2026-(.+)-g\d+/)?.[1]).find(Boolean) ?? process.env.RUN_ID ?? "live";
  const out = await resolveHold({ tournament: t, game, sheet: await loadSheet(), card: await loadRateCard(), ledger, runId, choice, paypal: PAYPAL_MODE });
  await saveLedger(LEDGER, ledger);
  return out;
}
const bryntum = dirname(require.resolve("@bryntum/scheduler/package.json"));
const agGrid = join(dirname(require.resolve("ag-grid-community")), "..", ".."); // dist/package/main.cjs.js -> the package root
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };

const DOC = process.env.TOURNAMENT_FILE ?? "data/tournament-2026.json";

/** The scorer's app saving a score: POST /api/games/<id> {"status":"final"|"forfeit"|"scheduled","hs":52,"as":47}.
 *  Bumps the document's version and stamps the save time on the game, which is the buzzer the agent measures from. */
async function saveScore(gameId: string, body: { status?: string; hs?: number | null; as?: number | null; note?: string }) {
  const doc = JSON.parse(await readFile(DOC, "utf8"));
  for (const d of doc.divisions) for (const g of d.games) if (g.id === gameId) {
    const status = body.status === "final" || body.status === "forfeit" ? body.status : "scheduled";
    g.hs = body.hs ?? null; g.as = body.as ?? null; g.note = body.note ?? (status === "forfeit" ? "forfeit" : "");
    g.status = status; g.finalAt = status === "scheduled" ? null : new Date().toISOString();
    doc.version = (doc.version ?? 0) + 1; doc.updated_at = new Date().toISOString().replace("T", " ").slice(0, 19);
    await writeFile(DOC, JSON.stringify(doc, null, 2) + "\n");
    return { ok: true, game: { id: g.id, status: g.status, hs: g.hs, as: g.as, finalAt: g.finalAt }, version: doc.version };
  }
  return { ok: false, message: `no game ${gameId}` };
}

const api: Record<string, string> = {
  "/api/tournament": DOC,
  "/api/association": "data/association.json",
  "/api/sheet": "data/officials-2026.json",
  "/api/rate-card": "data/rate-card.json",
  "/api/ledger": LEDGER,
  "/api/invoices": "results/invoices.json",
  "/api/chase": "results/chase.json",
  "/api/replay": "results/buzzer-replay.json",
  "/api/first-live-run": "results/first-live-run.json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let path = url.pathname;
  try {
    if (req.method === "POST" && path === "/webhooks/paypal") {
      const out = await handleWebhook(req.headers, await readBody(req), LEDGER);
      return json(res, out.ok ? 200 : 400, out);
    }
    if (req.method === "POST" && path.startsWith("/api/games/")) {
      const out = await saveScore(decodeURIComponent(path.slice("/api/games/".length)), JSON.parse(await readBody(req) || "{}"));
      return json(res, out.ok ? 200 : 404, out);
    }
    if (path === "/api/tournament" && url.searchParams.has("v")) {
      const doc = JSON.parse(await readFile(DOC, "utf8"));
      if (Number(url.searchParams.get("v")) === Number(doc.version)) { res.writeHead(304); return res.end(); }
    }
    if (req.method === "POST" && path.startsWith("/api/holds/")) {
      const body = JSON.parse(await readBody(req) || "{}");
      const out = await treasurerDecides(decodeURIComponent(path.slice("/api/holds/".length)), body.choice);
      return json(res, out.ok ? 200 : 409, out);
    }
    if (api[path]) return send(res, await readFile(api[path]).catch(() => Buffer.from("null")), ".json");
    if (path.startsWith("/api/")) return json(res, 404, { isError: true, message: `no such endpoint ${path}` });
    let file: string;
    if (path.startsWith("/vendor/bryntum/")) file = join(bryntum, normalize(path.slice("/vendor/bryntum/".length)));
    else if (path.startsWith("/vendor/ag-grid/")) file = join(agGrid, normalize(path.slice("/vendor/ag-grid/".length)));
    else if (path.startsWith("/brand/")) file = join(".design/brand", normalize(path.slice("/brand/".length)));
    else if (path.startsWith("/type/")) file = join(".design/type", normalize(path.slice("/type/".length)));
    else { if (path === "/") path = "/index.html"; file = join("web", normalize(path)); }
    if (file.includes("..")) return json(res, 400, { isError: true, message: "bad path" });
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) return json(res, 404, { isError: true, message: `not found: ${path}` });
    return send(res, await readFile(file), extname(file));
  } catch (e) {
    return json(res, 500, { isError: true, message: (e as Error).message });
  }
});
server.listen(PORT, () => console.log(`Final Buzzer board on http://localhost:${PORT}/`));

function send(res: import("node:http").ServerResponse, body: Buffer, ext: string) {
  res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(body);
}
function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => resolve(s)); req.on("error", reject); });
}
function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
