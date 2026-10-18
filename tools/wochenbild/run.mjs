// Wöchentlicher Lauf: offene Räume holen, Wochenbild rendern, hochladen (der Worker postet es an Discord).
//
//   WEEKLY_BASE_URL=https://<worker-host>  WEEKLY_RENDER_KEY=<secret>  node run.mjs [--design d] [--dry-run] [--room <code>] [--out-dir <ordner>]
//
// --dry-run: holt pending (falls Key/URL gesetzt) bzw. nimmt --data <datei>, rendert nur in den Ausgabeordner, lädt nichts hoch.
// Basis-URL und Key NUR aus der Umgebung – nie als Argument, nie im Log.
// Exit-Code: 0 = alles erledigt oder nichts zu tun, 1 = mindestens ein Raum nicht gepostet, 2 = Konfiguration/Zugang falsch.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_DESIGN, parseArgs, renderPng } from "./render.mjs";

const args = parseArgs(process.argv.slice(2));
const design = String(args.design ?? DEFAULT_DESIGN).toLowerCase();
const dryRun = !!args["dry-run"];
const stamp = new Date().toISOString().slice(0, 10);
const outDir = resolve(String(args["out-dir"] ?? join(tmpdir(), `wochenbild-${stamp}`)));
const RETRY_WAIT_MS = [20_000, 60_000];

const base = (process.env.WEEKLY_BASE_URL ?? "").trim().replace(/\/+$/, "");
const key = (process.env.WEEKLY_RENDER_KEY ?? "").trim();

const log = (msg) => console.log(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ConfigError extends Error {}

async function api(path, init = {}) {
  let resp;
  try {
    resp = await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(`Worker nicht erreichbar (${e.cause?.code ?? e.name})`);
  }
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  if (resp.status === 401) throw new ConfigError("401: WEEKLY_RENDER_KEY passt nicht zum Secret im Worker");
  if (resp.status === 404 && path === "/api/weekly/pending") throw new ConfigError("404: Bild-Weg im Worker aus (Secret WEEKLY_RENDER_KEY fehlt) oder falsche WEEKLY_BASE_URL");
  return { status: resp.status, json: json ?? {}, text };
}

async function loadRooms() {
  if (args.data) {
    const data = JSON.parse(readFileSync(resolve(String(args.data)), "utf8"));
    return { rooms: Array.isArray(data.rooms) ? data.rooms : [data], source: "Datei" };
  }
  if (!base || !key) throw new ConfigError("WEEKLY_BASE_URL und WEEKLY_RENDER_KEY müssen gesetzt sein (oder --dry-run --data <datei>)");
  if (!/^https?:\/\//.test(base)) throw new ConfigError("WEEKLY_BASE_URL muss mit https:// beginnen");
  const r = await api("/api/weekly/pending");
  if (r.status !== 200 || !Array.isArray(r.json.rooms)) throw new Error(`pending: HTTP ${r.status} ${r.json.error ?? ""}`.trim());
  const until = r.json.replacedMs ? new Date(r.json.replacedMs).toISOString().replace(".000Z", "Z") : "?";
  return { rooms: r.json.rooms, source: `Worker (Woche ${r.json.week?.key ?? "?"}, offen bis zum Reset ${until})` };
}

async function upload(room, png) {
  for (let attempt = 0; ; attempt++) {
    const r = await api(`/api/weekly/${encodeURIComponent(room)}/image`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
    if (r.status === 200) return { ok: true, result: "gepostet" };
    if (r.status === 409) return { ok: true, result: `übersprungen (${r.json.error ?? "409"}: bereits gepostet oder nicht mehr erwartet)` };
    const outcome = r.json.outcome;
    if (r.status === 502 && (outcome === "retry" || outcome === "rate_limited") && attempt < RETRY_WAIT_MS.length) {
      log(`  Discord ${outcome} (HTTP ${r.json.code}) – neuer Versuch in ${RETRY_WAIT_MS[attempt] / 1000} s`);
      await sleep(RETRY_WAIT_MS[attempt]);
      continue;
    }
    if (r.status === 502 && outcome === "rejected") return { ok: false, result: `Discord hat das Bild abgelehnt (HTTP ${r.json.code}) – Woche bleibt offen, nächster Lauf versucht es erneut` };
    if (r.status === 502 && outcome === "invalid") return { ok: false, result: "Webhook ungültig – im Dashboard neu hinterlegen" };
    return { ok: false, result: `HTTP ${r.status} ${r.json.error ?? outcome ?? ""} ${r.json.message ?? ""}`.trim() };
  }
}

async function main() {
  if (dryRun && !args.data && (!base || !key)) args.data = join(import.meta.dirname, "sample.json");
  const { rooms: all, source } = await loadRooms();
  const rooms = args.room ? all.filter((r) => r.room === args.room) : all;
  log(`Quelle: ${source}; ${rooms.length} Raum/Räume offen; Entwurf ${design}${dryRun ? "; Probelauf ohne Upload" : ""}`);
  if (!rooms.length) {
    log("Nichts zu tun.");
    return 0;
  }
  mkdirSync(outDir, { recursive: true });
  const summary = [];
  for (const room of rooms) {
    log(`Raum ${room.room}: ${room.fights} Kämpfe, ${room.players?.length ?? 0} Mitglieder`);
    let res;
    try {
      res = await renderPng(room, { design });
    } catch (e) {
      summary.push({ room: room.room, ok: false, result: `Rendern fehlgeschlagen: ${e.message}` });
      continue;
    }
    const file = join(outDir, `wochenbild-${room.room}-${room.week?.key ?? stamp}-${res.design}.png`);
    writeFileSync(file, res.png);
    log(`  ${file} (${res.width}×${res.height}, ${(res.png.length / 1024).toFixed(0)} KB)`);
    if (res.tooLarge) {
      summary.push({ room: room.room, ok: false, file, result: "PNG größer als 1 MB – anderen Entwurf nehmen" });
      continue;
    }
    if (dryRun) {
      summary.push({ room: room.room, ok: true, file, result: "gerendert (Probelauf)" });
      continue;
    }
    const up = await upload(room.room, res.png);
    summary.push({ room: room.room, ok: up.ok, file, result: up.result });
  }
  for (const s of summary) log(`${s.ok ? "OK    " : "FEHLER"} ${s.room}: ${s.result}`);
  log(`ERGEBNIS ${JSON.stringify({ design, dryRun, rooms: summary.map(({ room, ok, result }) => ({ room, ok, result })) })}`);
  return summary.every((s) => s.ok) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Fehler: ${e.message}`);
    process.exit(e instanceof ConfigError ? 2 : 1);
  },
);
