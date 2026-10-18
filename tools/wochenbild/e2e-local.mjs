// Lokaler End-to-End-Test: wrangler dev (frische D1, eigener Ordner) + Discord-Ersatz + test/seed.mjs + run.mjs.
// Nie gegen Produktion. Ports: E2E_PORT (Standard 8791) und +1 für den Discord-Ersatz (nie 8765 – Cockpit).
//   node e2e-local.mjs            mit WEEKLY_RENDER_KEY: Probelauf, Upload, zweiter Lauf "nichts zu tun", falscher Key
//   E2E_NOKEY=1 node e2e-local.mjs  ohne Secret: /api/weekly/pending → 404, Cron postet nichts (keine Text-Karte)
// Das empfangene Bild landet in <tmp>/wochenbild-e2e/discord-empfangen.png.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const WT = resolve(import.meta.dirname, "..", "..");
const OUT = join(tmpdir(), "wochenbild-e2e");
mkdirSync(OUT, { recursive: true });
const CLOUD = join(WT, "cloud");
const TOOL = join(WT, "tools", "wochenbild");
const PORT = Number(process.env.E2E_PORT || 8791);
const STUB = PORT + 1;
const withKey = process.env.E2E_NOKEY !== "1";
const KEY = "e2e-render-key-0123456789abcdef";
const ROOM = "testraum";
const SECRET = "dev-secret-bitte-aendern-123";
const ADMIN = "admin-e2e-0123456789";
const BASE = `http://127.0.0.1:${PORT}`;
const win = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hits = [];
const stub = createServer((req, res) => {
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const ct = req.headers["content-type"] ?? "";
    const pngAt = raw.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    hits.push({ url: req.url.replace(/webhooks\/\d+\/[^?]+/, "webhooks/…"), ct: ct.split(";")[0], bytes: raw.length, png: pngAt >= 0,
      hasImageEmbed: raw.includes(Buffer.from("attachment://wochenbild.png")) });
    if (pngAt >= 0) writeFileSync(join(OUT, "discord-empfangen.png"), raw.subarray(pngAt, raw.indexOf("IEND", pngAt) + 8));
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"id":"1"}');
  });
});
await new Promise((r) => stub.listen(STUB, "127.0.0.1", r));

const state = mkdtempSync(join(tmpdir(), "a2dps-e2e-"));
const vars = join(state, "e2e.vars");
writeFileSync(vars, `ROOMS="${ROOM}:${SECRET}"\nSESSION_KEY="e2e-session-key-0123456789-0123456789"\nADMIN_SECRET="${ADMIN}"\nDISCORD_API_BASE="http://127.0.0.1:${STUB}"\n` +
  (withKey ? `WEEKLY_RENDER_KEY="${KEY}"\n` : ""));
const npx = (args, opts = {}) => spawn(win ? "npx.cmd" : "npx", args, { cwd: CLOUD, shell: win, ...opts });
let dev;
let code = 1;
try {
  const m = await new Promise((r) => npx(["wrangler", "d1", "migrations", "apply", "a2dps", "--local", "--persist-to", state], { stdio: "ignore", env: { ...process.env, CI: "1" } }).on("exit", r));
  if (m !== 0) throw new Error("migrations");
  let log = "";
  dev = npx(["wrangler", "dev", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state, "--env-file", vars, "--show-interactive-dev-session=false"], { stdio: ["ignore", "pipe", "pipe"] });
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  for (let i = 0; ; i++) {
    try { await fetch(`${BASE}/`); break; } catch { if (i > 180) throw new Error(log); await sleep(500); }
  }
  console.log(`wrangler dev auf ${BASE} (Key ${withKey ? "gesetzt" : "NICHT gesetzt"})`);
  if (!withKey) {
    const r = await fetch(`${BASE}/api/weekly/pending`, { headers: { authorization: `Bearer ${KEY}` } });
    console.log(`ohne Secret: GET /api/weekly/pending → ${r.status}`);
    // Früher schickte der Cron ohne Secret sofort die Text-Karte – jetzt nie
    const seed = spawnSync(process.execPath, ["test/seed.mjs"], { cwd: CLOUD, env: { ...process.env, BASE, ROOM, SECRET }, encoding: "utf8" });
    console.log("seed:", seed.status);
    await fetch(`${BASE}/api/rooms/${ROOM}/webhook`, { method: "PATCH", headers: { authorization: `Bearer ${SECRET}`, "x-a2-admin": ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ url: `https://discord.com/api/webhooks/123456789012345678/${"T".repeat(60)}`, enabled: true }) });
    for (const dt of [0, 4, 24]) {
      await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("15 7-23 * * 3")}&time=${Date.now() + dt * 3_600_000}`);
    }
    await sleep(500);
    console.log(`ohne Secret: Cron → ${hits.length} Discord-Posts`);
    code = r.status === 404 && hits.length === 0 ? 0 : 1;
  } else {
    const seed = spawnSync(process.execPath, ["test/seed.mjs"], { cwd: CLOUD, env: { ...process.env, BASE, ROOM, SECRET }, encoding: "utf8" });
    console.log("seed:", seed.status, (seed.stdout || "").trim().split("\n").slice(-2).join(" | "));
    const set = await fetch(`${BASE}/api/rooms/${ROOM}/webhook`, { method: "PATCH", headers: { authorization: `Bearer ${SECRET}`, "x-a2-admin": ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ url: `https://discord.com/api/webhooks/123456789012345678/${"T".repeat(60)}`, enabled: true }) });
    console.log("webhook gesetzt:", set.status);
    const env = { ...process.env, WEEKLY_BASE_URL: BASE, WEEKLY_RENDER_KEY: KEY };
    // NICHT spawnSync: der Discord-Stub läuft in diesem Prozess und muss antworten können
    const runAsync = (args, e = env) => new Promise((res) => {
      const c = spawn(process.execPath, ["run.mjs", ...args], { cwd: TOOL, env: e });
      let stdout = "", stderr = "";
      c.stdout.on("data", (d) => (stdout += d));
      c.stderr.on("data", (d) => (stderr += d));
      c.on("exit", (status) => res({ status, stdout, stderr }));
    });
    const run = async (args) => {
      const r = await runAsync(args);
      console.log(`\n$ node run.mjs ${args.join(" ")}  → exit ${r.status}\n${r.stdout}${r.stderr}`);
      if ((r.stdout + r.stderr).includes(KEY)) throw new Error("KEY im Log!");
      return r.status;
    };
    const d1 = await run(["--dry-run", "--out-dir", OUT]);
    const hitsAfterDry = hits.length;
    const r1 = await run(["--out-dir", OUT]);
    const r2 = await run([]);
    const bad = await runAsync([], { ...env, WEEKLY_RENDER_KEY: "falsch-falsch-falsch-falsch" });
    console.log(`falscher Key → exit ${bad.status}: ${(bad.stdout + bad.stderr).trim().split("\n").at(-1)}`);
    // Cron jetzt → sendet nie etwas (Woche ohnehin schon per Bild erledigt)
    await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("15 7-23 * * 3")}&time=${Date.now()}`);
    await sleep(500);
    const st = await (await fetch(`${BASE}/api/rooms/${ROOM}/webhook`, { headers: { authorization: `Bearer ${SECRET}` } })).json();
    console.log("Discord-Stub:", JSON.stringify(hits));
    console.log("Webhook-Stand:", JSON.stringify(st));
    const ok = d1 === 0 && hitsAfterDry === 0 && r1 === 0 && r2 === 0 && bad.status === 2 && hits.length === 1 && hits[0].ct === "multipart/form-data" && hits[0].png && hits[0].hasImageEmbed && st.imageStatus === "ok";
    console.log(ok ? "\nE2E OK" : "\nE2E FEHLER");
    if (!ok) console.log(log.split("\n").filter((l) => /Discord|rror/.test(l)).slice(-15).join("\n"));
    code = ok ? 0 : 1;
  }
} catch (e) {
  console.error(e.message ?? e);
} finally {
  if (dev) spawnSync("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
  stub.close();
  for (let i = 0; i < 10; i++) { try { rmSync(state, { recursive: true, force: true }); break; } catch { await sleep(500); } }
}
process.exit(code);
