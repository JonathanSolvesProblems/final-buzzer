import "./env.ts";
/**
 * The board's server: static files from web/, the Bryntum package, and the agent's results as JSON.
 *
 *   node --env-file=.env src/server.ts        ->  http://localhost:4173/
 */
import { createServer, type IncomingMessage } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { loadFromFile } from "./app/feed.ts";
import { loadSheet, loadRateCard } from "./agent/sheet.ts";
import { checkMove, GAME_MINUTES } from "./agent/replan.ts";
import { loadLedger, saveLedger } from "./ledger.ts";
import { resolveHold, type TreasurerChoice } from "./agent/resolve.ts";
import { handleWebhook, WEBHOOK_LOG } from "./webhooks.ts";
import { runClosure } from "./agent/closure.ts";
import { spendModelRun, peekBudget } from "./budget.ts";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT ?? 4173);
const LEDGER = process.env.LEDGER ?? "results/ledger.json";
const HEARTBEAT = process.env.HEARTBEAT_FILE ?? "results/agent.json"; // written by the agent on duty (src/cli/watch.ts)
// PAYPAL_MODE=dry keeps Sam's tap off PayPal even when .env carries sandbox keys (the board test uses it)
const PAYPAL_MODE = (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_MODE !== "dry" ? "live" : "dry") as "live" | "dry";
/** Sam's actions (a tap on a held game, closing a gym) are the treasurer's alone. The public deployment sets
 *  SAM_PIN and asks for it in a header; unset (local runs, the board test) means no PIN. Scoring stays open:
 *  that is the table official's job, and the agent's daily budget caps what it can cost. */
const SAM_PIN = process.env.SAM_PIN ?? "";
const wrongPins = new Map<string, { n: number; until: number }>();
const caller = (req: IncomingMessage) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
const lockedOut = (req: IncomingMessage) => { const w = wrongPins.get(caller(req)); return !!w && w.n >= 5 && Date.now() < w.until; };
/** A copy with no PayPal keys shows the committed results and never rewrites them: Sam's actions need the sandbox. */
const KEYLESS = !process.env.PAYPAL_CLIENT_ID;
function samAllowed(req: IncomingMessage) {
  if (KEYLESS) return false;
  if (!SAM_PIN) return true;
  if (lockedOut(req)) return false;
  const given = String(req.headers["x-sam-pin"] ?? "");
  if (given === SAM_PIN) { wrongPins.delete(caller(req)); return true; }
  if (given) { const w = wrongPins.get(caller(req)); const fresh = !w || Date.now() >= w.until; wrongPins.set(caller(req), { n: fresh ? 1 : w.n + 1, until: Date.now() + 10 * 60_000 }); }
  return false;
}
const notSam = (req: IncomingMessage) => ({ ok: false, needsPin: true, message: KEYLESS ? "This copy has no PayPal sandbox keys, so it shows the committed results and Sam's actions are off. Add keys to .env to act as Sam." : lockedOut(req) ? "Too many wrong PINs from here. Try again in ten minutes." : req.headers["x-sam-pin"] ? "That is not the treasurer's PIN." : "This is Sam's call. Enter the treasurer's PIN to act as Sam." });

/** Sam's tap on a held game: POST /api/holds/<gameId> {"choice":"pay_full"|"pay_show_up"|"pay_nobody"} */
async function treasurerDecides(gameId: string, choice: TreasurerChoice) {
  const t = await loadFromFile(DOC);
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
/** A score is a whole number from 0 to 199 or nothing: the endpoint is open, so nothing else is ever stored. */
const points = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 199 ? v : null);
let saving: Promise<unknown> = Promise.resolve();
async function saveScore(gameId: string, body: { status?: unknown; hs?: unknown; as?: unknown }) {
  const doc = JSON.parse(await readFile(DOC, "utf8"));
  for (const d of doc.divisions) for (const g of d.games) if (g.id === gameId) {
    if (body.status !== "final" && body.status !== "forfeit" && body.status !== "scheduled") return { ok: false, refused: true, message: "status is final, forfeit or scheduled" };
    const status = body.status;
    const hs = points(body.hs), as = points(body.as);
    // a final is two whole scores that differ: anything else would start a payout on a game nobody finished
    if (status === "final" && (hs == null || as == null)) return { ok: false, refused: true, message: "A final needs both scores, whole numbers from 0 to 199." };
    if (status === "final" && hs === as) return { ok: false, refused: true, message: "A basketball game cannot end level. Check the scores." };
    // the same final saved again within a few seconds is one tap landing twice, not a second save
    if (status === "final" && g.status === "final" && g.hs === hs && g.as === as && g.finalAt && Date.now() - Date.parse(g.finalAt) < 15000)
      return { ok: true, game: { id: g.id, status: g.status, hs: g.hs, as: g.as, finalAt: g.finalAt }, version: doc.version, repeat: true };
    g.hs = hs; g.as = as;
    // the note is the server's own word, never the caller's; a game the re-plan moved keeps saying where it came from
    g.note = status === "forfeit" ? "forfeit" : typeof g.note === "string" && g.note.startsWith("moved from") ? g.note : "";
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
      // one save at a time: each reads, changes and writes the whole document, so two at once would lose one
      const gameId = decodeURIComponent(path.slice("/api/games/".length)), saveBody = JSON.parse(await readBody(req) || "{}");
      const run = saving.then(() => saveScore(gameId, saveBody));
      saving = run.catch(() => undefined);
      const out = await run;
      // the scorer learns at once whether the agent will run on this save or hold it (the day's demo budget)
      return json(res, out.ok ? 200 : (out as any).refused ? 400 : 404, out.ok ? { ...out, budget: await peekBudget() } : out);
    }
    if (path === "/api/budget") return json(res, 200, await peekBudget());
    // the agent on duty's last heartbeat, so the board can say whether anyone is watching the scorer's saves
    if (path === "/api/agent") {
      const beat = await readFile(HEARTBEAT, "utf8").then(JSON.parse).catch(() => null);
      return json(res, 200, beat ? { ...beat, ageSeconds: Math.round((Date.now() - Date.parse(beat.at)) / 1000) } : null);
    }
    // every PayPal webhook the receiver has seen, as received (one JSON line each)
    if (path === "/api/webhooks") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); return res.end(await readFile(WEBHOOK_LOG, "utf8").catch(() => "")); }
    if (path === "/api/tournament" && url.searchParams.has("v")) {
      const doc = JSON.parse(await readFile(DOC, "utf8"));
      if (Number(url.searchParams.get("v")) === Number(doc.version)) { res.writeHead(304); return res.end(); }
    }
    if (req.method === "POST" && path.startsWith("/api/holds/")) {
      if (!samAllowed(req)) return json(res, 401, notSam(req));
      const body = JSON.parse(await readBody(req) || "{}");
      const out = await treasurerDecides(decodeURIComponent(path.slice("/api/holds/".length)), body.choice);
      return json(res, out.ok ? 200 : 409, out);
    }
    /** Would this move break the schedule? POST /api/check-move {"gameId":"g061","court":"Gym D","start":"11:30"}.
     *  The same rules the re-plan agent's moves are checked against (src/agent/replan.ts). Read-only: nothing
     *  is saved, so it needs no PIN. The start snaps to the day's own slots. */
    if (req.method === "POST" && path === "/api/check-move") {
      const body = JSON.parse(await readBody(req) || "{}");
      const t = await loadFromFile(DOC);
      const g = t.games.find((x) => x.id === String(body.gameId ?? ""));
      if (!g) return json(res, 404, { isError: true, message: "no such game" });
      const court = t.courts.find((c) => c.name === String(body.court ?? "") || c.id === String(body.court ?? ""));
      if (!court) return json(res, 400, { isError: true, message: "no such court" });
      if (!/^\d\d:\d\d$/.test(String(body.start ?? ""))) return json(res, 400, { isError: true, message: "start is HH:MM" });
      const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
      const day = g.start.slice(0, 10);
      const starts = [...new Set(t.games.filter((x) => x.start.startsWith(day)).map((x) => x.start.slice(11, 16)))].sort();
      const last = mins(starts.at(-1)!) + GAME_MINUTES;
      const grid = [...starts, `${String(Math.floor(last / 60)).padStart(2, "0")}:${String(last % 60).padStart(2, "0")}`];
      const start = grid.reduce((a, b) => Math.abs(mins(b) - mins(body.start)) < Math.abs(mins(a) - mins(body.start)) ? b : a);
      const same = court.name === g.court && start === g.start.slice(11, 16);
      // played means the document says so or the ledger has acted on it: the replay's games stay "scheduled" in the document
      const led = await readFile(LEDGER, "utf8").then(JSON.parse).catch(() => null);
      const acted = !!led && (Object.values(led.payouts ?? {}).some((p: any) => p.gameId === g.id) || !!led.holds?.[g.id] || Object.values(led.folds ?? {}).flat().some((f: any) => f.gameId === g.id));
      const check = g.status !== "scheduled" || acted ? { ok: false, problems: [`game ${g.number} has been played`], officials_to_reassign: 0, notes: [] } : checkMove(t, await loadSheet(), g, court.name, start);
      return json(res, 200, { ...check, same, saved: false, game: g.number, from: { court: g.court, start: g.start.slice(11, 16) }, to: { court: court.name, start } });
    }
    /** A gym closes: POST /api/replan {"court":"Gym D","from":"14:00","day":"2026-05-16"}. The agent re-plans,
     *  the moves are written into the document, the refunds go through PayPal, and the plan comes back. */
    if (req.method === "POST" && path === "/api/replan") {
      if (!samAllowed(req)) return json(res, 401, notSam(req));
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.court || !body.from) return json(res, 400, { ok: false, message: "court and from (HH:MM) are required" });
      const budget = await spendModelRun("replan");
      if (!budget.ok) return json(res, 429, { ok: false, message: budget.message });
      const r = await runClosure({ closure: { day: String(body.day ?? "2026-05-16"), court: String(body.court), from: String(body.from) }, paypal: PAYPAL_MODE, runId: process.env.RUN_ID ?? "live", docPath: DOC, apply: true });
      const { trace, ...plan } = r;
      return json(res, 200, { ok: true, ...plan, steps: trace.filter((s) => s.kind === "tool").map((s) => ({ name: s.name, input: s.input, ok: (s.output as any)?.ok })) });
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
    if (!s || !s.isFile()) {
      if (extname(path) && extname(path) !== ".html") return json(res, 404, { isError: true, message: `not found: ${path}` });
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Not on the board | Final Buzzer</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#E9EAEC;color:#16171A;font:16px/1.5 system-ui,sans-serif"><main style="padding:24px;max-width:36ch"><h1 style="font-size:28px;margin:0 0 8px">That page is not on the board</h1><p style="margin:0 0 16px">There is nothing at this address.</p><p style="margin:0"><a href="/" style="color:inherit;font-weight:600">Back to the board</a></p></main></body></html>`);
      return;
    }
    return send(res, await readFile(file), extname(file));
  } catch (e) {
    return json(res, 500, { isError: true, message: (e as Error).message });
  }
});
server.listen(PORT, () => console.log(`Final Buzzer board on http://localhost:${PORT}/`));

/** Text goes out gzipped when the browser takes it: the scheduler's module alone is 4.6 MB plain. Big bodies are
 *  compressed once and kept, keyed by a hash of their bytes, so a changed file is compressed again. */
const zipped = new Map<string, Buffer>();
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);
function send(res: import("node:http").ServerResponse, body: Buffer, ext: string) {
  const head: Record<string, string> = { "Content-Type": types[ext] ?? "application/octet-stream", "Cache-Control": "no-cache", "Vary": "Accept-Encoding" };
  const accepts = String(res.req.headers["accept-encoding"] ?? "").includes("gzip");
  if (!accepts || !TEXT.has(ext) || body.length < 1024) { res.writeHead(200, head); res.end(body); return; }
  let out: Buffer;
  if (body.length > 200_000) {
    const key = createHash("sha1").update(body).digest("hex");
    out = zipped.get(key) ?? gzipSync(body);
    if (!zipped.has(key)) { if (zipped.size > 40) zipped.clear(); zipped.set(key, out); }
  } else out = gzipSync(body, { level: 6 });
  res.writeHead(200, { ...head, "Content-Encoding": "gzip" });
  res.end(out);
}
function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { let s = ""; req.on("data", (c) => { s += c; }); req.on("end", () => resolve(s)); req.on("error", reject); });
}
function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
