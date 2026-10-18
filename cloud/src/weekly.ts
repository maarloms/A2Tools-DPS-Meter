// Wochenrückblick per Discord-Webhook: Einstellungen je Raum (Dashboard), Cron-Versand und Wochenbild.
//
//  GET    /api/rooms/:code/webhook       Stand (nie die URL selbst, nur "…abcd")
//  PATCH  /api/rooms/:code/webhook       { url?, enabled? }        Admin
//  DELETE /api/rooms/:code/webhook                                 Admin
//  POST   /api/rooms/:code/webhook/test  Test-Post (laufende Woche) Admin
//
//  Wochenbild (lokal gerendert, tools/wochenbild; Auth: Bearer WEEKLY_RENDER_KEY, ohne Secret 404):
//  GET    /api/weekly/pending            Räume, deren abgelaufene Woche noch auf ein Bild wartet, mit Recap-Daten
//  POST   /api/weekly/:room/image        PNG (≤ 1 MB) → Discord als Karte mit Bild, Woche erledigt
//
// Cron (wrangler.jsonc "triggers"): Mittwochs nach dem Reset stündlich; jeder Raum bekommt
// die abgelaufene Woche genau einmal (room_webhooks.last_week). Ist WEEKLY_RENDER_KEY gesetzt, wartet
// der Cron bis IMAGE_DEADLINE_MS nach dem Reset auf das Bild und sendet erst dann die Text-Karte.
// Wochen ohne Kämpfe werden still übersprungen. Datenquelle: encounters/player_stats wie Übersicht und
// Wochenrückblick im Dashboard – nur Mitglieder, nur zählende Bosse (ohne Feldbosse), ohne Training.
// Die Auswertung der abgelaufenen Woche wird je Raum einmal berechnet und in room_webhooks.recap_json
// abgelegt (Cron, pending und Bild-Upload lesen sie von dort, statt D1 mehrfach abzufragen).

import { Env, checkRenderKey, roomDigest } from "./auth";
import { relevant } from "./bosses";
import { activeMembers } from "./members";
import { ROOM_CODE_RE } from "./protocol";
import {
  CLAIM_MS, IMAGE_DEADLINE_MS, IMAGE_NAME, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_RETRY_WAIT_MS, Recap, SendOutcome,
  TEST_MIN_INTERVAL_MS, Week, WeekFight, bossDpsChange, bossTable, buildImagePayload, buildPayload, buildPingPayload,
  classifyStatus, currentWeek, lastWeek, parseWebhookUrl, pendingView, pickFights, pngSize, retryAfterMs, waitingForImage,
  webhookHint, WEEK_MS,
} from "./weekly-core";

interface Row {
  room: string;
  url: string;
  enabled: number;
  status: string;
  last_code: number | null;
  last_error: string | null;
  origin: string;
  last_week: string | null;
  last_post_ms: number | null;
  last_test_ms: number | null;
  recap_week: string | null;
  recap_json: string | null;
  claim_ms: number | null;
  image_week: string | null;
  image_status: string | null;
}

const REL_PS = relevant("ps");
const REL_E = relevant("e");
/** ?4 = JSON-Array der Mitgliedsnamen (klein) */
const IS_MEMBER = "ps.player_lc IN (SELECT value FROM json_each(?4))";

async function load(db: D1Database, room: string): Promise<Row | null> {
  return db.prepare("SELECT * FROM room_webhooks WHERE room = ?1").bind(room).first<Row>();
}

/** Was Clients sehen dürfen – ohne URL */
function publicView(r: Row | null) {
  if (!r) return { configured: false, enabled: false };
  return {
    configured: true,
    hint: webhookHint(r.url),
    enabled: !!r.enabled,
    status: r.status,
    lastCode: r.last_code,
    lastError: r.last_error,
    lastWeek: r.last_week,
    lastPostMs: r.last_post_ms,
    imageWeek: r.image_week,
    imageStatus: r.image_status,
  };
}

// ---------- Einstellungen (Dashboard) ----------

export async function handleWebhook(db: D1Database, env: Env, room: string, rest: string, url: URL, req: Request): Promise<unknown | null> {
  if (rest === "/webhook/test") return req.method === "POST" ? testPost(db, env, room) : null;
  if (rest !== "/webhook") return null;

  if (req.method === "GET") return publicView(await load(db, room));

  if (req.method === "DELETE") {
    await db.prepare("DELETE FROM room_webhooks WHERE room = ?1").bind(room).run();
    return publicView(null);
  }

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => null)) as { url?: unknown; enabled?: unknown } | null;
    if (!body || (body.url === undefined && body.enabled === undefined)) return { error: "bad_request" };
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return { error: "bad_request" };
    const now = Date.now();
    const cur = await load(db, room);
    if (body.url !== undefined) {
      const hook = parseWebhookUrl(body.url);
      if (!hook) return { error: "bad_url", message: "Nur Discord-Webhooks: https://discord.com/api/webhooks/…" };
      // Neue URL: Status zurücksetzen, Links zeigen auf die Adresse, unter der eingerichtet wurde
      const enabled = body.enabled === undefined ? (cur ? cur.enabled : 0) : body.enabled ? 1 : 0;
      await db
        .prepare(
          `INSERT INTO room_webhooks (room, url, enabled, status, last_code, last_error, origin, updated_ms)
           VALUES (?1, ?2, ?3, 'ok', NULL, NULL, ?4, ?5)
           ON CONFLICT(room) DO UPDATE SET url = excluded.url, enabled = excluded.enabled, status = 'ok',
             last_code = NULL, last_error = NULL, origin = excluded.origin, updated_ms = excluded.updated_ms`,
        )
        .bind(room, hook, enabled, url.origin, now)
        .run();
    } else {
      if (!cur) return { error: "no_webhook", message: "Erst eine Webhook-URL hinterlegen" };
      await db.prepare("UPDATE room_webhooks SET enabled = ?2, updated_ms = ?3 WHERE room = ?1").bind(room, body.enabled ? 1 : 0, now).run();
    }
    return publicView(await load(db, room));
  }
  return null;
}

async function testPost(db: D1Database, env: Env, room: string) {
  const row = await load(db, room);
  if (!row) return { error: "no_webhook", message: "Erst eine Webhook-URL hinterlegen" };
  const now = Date.now();
  if (row.last_test_ms && now - row.last_test_ms < TEST_MIN_INTERVAL_MS) {
    return { error: "too_soon", message: "Bitte kurz warten, bevor du noch einen Test sendest" };
  }
  await db.prepare("UPDATE room_webhooks SET last_test_ms = ?2 WHERE room = ?1").bind(room, now).run();
  // Laufende Woche: NICHT zwischenspeichern (der Schlüssel wäre nächste Woche der der abgelaufenen Woche)
  const recap = await buildRecap(db, env, room, currentWeek(now), now);
  const payload = recap.fights ? buildPayload(recap, { origin: row.origin, test: true, now }) : buildPingPayload(room, row.origin);
  const res = await send(env, row.url, jsonBody(payload), false);
  await saveOutcome(db, room, res, null, now);
  return { ok: res.outcome === "ok", outcome: res.outcome, code: res.code, ...publicView(await load(db, room)) };
}

// ---------- Auswertung aus D1 ----------

export async function buildRecap(db: D1Database, env: Env, room: string, week: Week, now = Date.now()): Promise<Recap> {
  const members = await activeMembers(db, env, room);
  const names = new Map(members.map((n) => [n.toLowerCase(), n]));
  const ml = JSON.stringify([...names.keys()]);
  const prevFrom = week.from - WEEK_MS;
  const to = Math.min(week.to, Math.max(now, week.from));

  const group = await db
    .prepare(
      `SELECT SUM(e.start_ms >= ?2) AS fights, SUM(e.start_ms >= ?2 AND e.killed = 1) AS kills,
         SUM(e.start_ms < ?2) AS prevFights, SUM(e.start_ms < ?2 AND e.killed = 1) AS prevKills
       FROM encounters e
       WHERE e.room = ?1 AND e.start_ms >= ?5 AND e.start_ms < ?3 AND e.is_train = 0 AND ${REL_E}
         AND EXISTS (SELECT 1 FROM player_stats ps WHERE ps.encounter_id = e.id AND ${IS_MEMBER})`,
    )
    .bind(room, week.from, to, ml, prevFrom)
    .first<{ fights: number | null; kills: number | null; prevFights: number | null; prevKills: number | null }>();

  // Alle Kämpfe der Woche (ohne LIMIT: GROUP BY liest ohnehin alle Zeilen, rows_read bleibt gleich)
  const fights = (
    await db
      .prepare(
        `SELECT e.id AS fightId, e.boss, e.mob_code || ':' || e.dungeon_id AS bossKey, e.duration_ms AS durationMs, e.killed,
           SUM(ps.dps) AS groupDps
         FROM encounters e JOIN player_stats ps ON ps.encounter_id = e.id AND ${IS_MEMBER}
         WHERE e.room = ?1 AND e.start_ms >= ?2 AND e.start_ms < ?3 AND e.is_train = 0 AND ${REL_E}
         GROUP BY e.id`,
      )
      .bind(room, week.from, to, ml)
      .all<WeekFight>()
  ).results;

  // Bester Kampfschnitt je Mitglied mit Klasse dieses Kampfs (ohne LIMIT: Fensterfunktion liest ohnehin alles)
  const players = (
    await db
      .prepare(
        `SELECT lc, job, dps, boss FROM (SELECT ps.player_lc AS lc, ps.job_id AS job, ps.dps AS dps, ps.boss AS boss,
           ROW_NUMBER() OVER (PARTITION BY ps.player_lc ORDER BY ps.dps DESC) AS rn
         FROM player_stats ps WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND ps.start_ms < ?3 AND ps.is_train = 0 AND ${REL_PS} AND ${IS_MEMBER})
         WHERE rn = 1 ORDER BY dps DESC`,
      )
      .bind(room, week.from, to, ml)
      .all<{ lc: string; job: number; dps: number; boss: string }>()
  ).results.map((p) => ({ name: names.get(p.lc) ?? p.lc, job: Number(p.job) || 0, dps: p.dps, boss: p.boss }));

  const perBoss = (
    await db
      .prepare(
        `SELECT ps.mob_code || ':' || ps.dungeon_id AS boss, (ps.start_ms >= ?2) AS cur, AVG(ps.dps) AS avgDps
         FROM player_stats ps WHERE ps.room = ?1 AND ps.start_ms >= ?5 AND ps.start_ms < ?3 AND ps.is_train = 0 AND ${REL_PS} AND ${IS_MEMBER}
         GROUP BY ps.mob_code, ps.dungeon_id, cur`,
      )
      .bind(room, week.from, to, ml, prevFrom)
      .all<{ boss: string; cur: number; avgDps: number }>()
  ).results;

  const { best, fastest } = pickFights(fights);
  return {
    room,
    week,
    fights: group?.fights ?? 0,
    kills: group?.kills ?? 0,
    prevFights: group?.prevFights ?? 0,
    prevKills: group?.prevKills ?? 0,
    best,
    top: players.slice(0, 3).map((p) => ({ name: p.name, dps: p.dps, boss: p.boss })),
    dpsChange: bossDpsChange(perBoss),
    players,
    bosses: bossTable(fights, perBoss),
    fastest,
  };
}

/**
 * Auswertung der abgelaufenen Woche: aus room_webhooks.recap_json, sonst einmal berechnen und ablegen.
 * Später eintreffende Uploads dieser Woche ändern das Bild/die Karte dann nicht mehr (gewollt: beide zeigen dasselbe).
 */
async function weekRecap(env: Env, row: Row, week: Week, now: number): Promise<Recap> {
  if (row.recap_week === week.key && row.recap_json) {
    try {
      return JSON.parse(row.recap_json) as Recap;
    } catch {
      /* neu berechnen */
    }
  }
  const recap = await buildRecap(env.DB, env, row.room, week, now);
  const json = JSON.stringify(recap);
  await env.DB.prepare("UPDATE room_webhooks SET recap_week = ?2, recap_json = ?3 WHERE room = ?1").bind(row.room, week.key, json).run();
  row.recap_week = week.key;
  row.recap_json = json;
  return recap;
}

/**
 * Versand-Sperre: nur einer (Cron oder Bild-Upload) sendet je Raum und Woche. true = Sperre erhalten.
 * Bedingung im UPDATE selbst, damit zwei gleichzeitige Aufrufe nicht beide gewinnen.
 */
async function claim(db: D1Database, room: string, week: string, now: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE room_webhooks SET claim_ms = ?3
       WHERE room = ?1 AND (last_week IS NULL OR last_week != ?2) AND (claim_ms IS NULL OR claim_ms < ?4)`,
    )
    .bind(room, week, now, now - CLAIM_MS)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

async function release(db: D1Database, room: string) {
  await db.prepare("UPDATE room_webhooks SET claim_ms = NULL WHERE room = ?1").bind(room).run();
}

// ---------- Versand ----------

interface SendResult {
  outcome: SendOutcome;
  code: number;
  waitMs?: number;
}

interface Body {
  make: () => BodyInit;
  headers: Record<string, string>;
}

const jsonBody = (payload: unknown): Body => {
  const text = JSON.stringify(payload);
  return { make: () => text, headers: { "content-type": "application/json" } };
};

/** multipart/form-data: payload_json + files[0] (Content-Type setzt fetch samt boundary selbst) */
const imageBody = (payload: unknown, png: Uint8Array): Body => {
  const text = JSON.stringify(payload);
  return {
    make: () => {
      const fd = new FormData();
      fd.append("payload_json", text);
      fd.append("files[0]", new File([png], IMAGE_NAME, { type: "image/png" }));
      return fd;
    },
    headers: {},
  };
};

/**
 * Ein POST an Discord. Bei 429 mit kurzer Wartezeit (≤ 5 s) einmal neu, sonst Abbruch.
 * DISCORD_API_BASE (nur Tests): Host austauschen, Pfad bleibt.
 */
async function send(env: Env, hook: string, body: Body, allowWait: boolean): Promise<SendResult> {
  const target = env.DISCORD_API_BASE ? hook.replace(/^https:\/\/discord\.com/, env.DISCORD_API_BASE.replace(/\/$/, "")) : hook;
  for (let attempt = 0; attempt < 2; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(`${target}?wait=true`, {
        method: "POST",
        headers: { ...body.headers, "user-agent": "a2dps-cloud (Wochenrueckblick)" },
        body: body.make(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { outcome: "retry", code: 0 };
    }
    const outcome = classifyStatus(resp.status);
    if (outcome !== "rate_limited") {
      await resp.body?.cancel();
      return { outcome, code: resp.status };
    }
    const waitMs = retryAfterMs(await resp.json().catch(() => null), resp.headers.get("retry-after"));
    if (!allowWait || attempt > 0 || waitMs > MAX_RETRY_WAIT_MS) return { outcome, code: 429, waitMs };
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return { outcome: "rate_limited", code: 429 };
}

const ERROR_TEXT: Record<SendOutcome, string | null> = {
  ok: null,
  invalid: "Webhook ungültig (in Discord gelöscht oder Token falsch) – bitte neu hinterlegen",
  rate_limited: "Discord-Rate-Limit – neuer Versuch beim nächsten Lauf",
  retry: "Discord nicht erreichbar – neuer Versuch beim nächsten Lauf",
  rejected: "Discord hat die Nachricht abgelehnt",
};

/** Ergebnis speichern und Versand-Sperre lösen; `week` = erledigte Woche (null = Test oder später nochmal versuchen) */
async function saveOutcome(db: D1Database, room: string, res: SendResult, week: string | null, now: number) {
  const status = res.outcome === "ok" ? "ok" : res.outcome === "invalid" ? "invalid" : "error";
  await db
    .prepare(
      `UPDATE room_webhooks SET status = ?2, last_code = ?3, last_error = ?4,
         last_week = COALESCE(?5, last_week), last_post_ms = CASE WHEN ?6 = 1 THEN ?7 ELSE last_post_ms END, claim_ms = NULL
       WHERE room = ?1`,
    )
    .bind(room, status, res.code || null, ERROR_TEXT[res.outcome], week, res.outcome === "ok" ? 1 : 0, now)
    .run();
}

/** Erledigt: gepostet, ungültig oder abgelehnt. Rate-Limit/Störung: nächster Lauf. */
const isDone = (o: SendOutcome) => o === "ok" || o === "invalid" || o === "rejected";

/**
 * Cron: für jeden eingeschalteten Raum die abgelaufene Woche posten (einmal).
 * Rückgabe für Logs/Tests: je Raum, was passiert ist.
 */
export async function runWeekly(env: Env, now: number): Promise<{ room: string; result: string }[]> {
  const week = lastWeek(now);
  const imageEnabled = !!env.WEEKLY_RENDER_KEY;
  const rows = (
    await env.DB
      .prepare("SELECT * FROM room_webhooks WHERE enabled = 1 AND status != 'invalid' AND (last_week IS NULL OR last_week != ?1) ORDER BY room")
      .bind(week.key)
      .all<Row>()
  ).results;
  const out: { room: string; result: string }[] = [];
  for (const row of rows) {
    if (!(await roomDigest(env, row.room))) {
      out.push({ room: row.room, result: "unknown_room" });
      continue;
    }
    // Bild-Weg: bis zur Frist auf das Bild warten (keine D1-Abfragen); abgelehntes Bild → sofort Text
    if (waitingForImage(now, week, imageEnabled, row.image_week)) {
      out.push({ room: row.room, result: "waiting_image" });
      continue;
    }
    try {
      const recap = await weekRecap(env, row, week, now);
      if (!recap.fights) {
        await env.DB.prepare("UPDATE room_webhooks SET last_week = ?2 WHERE room = ?1").bind(row.room, week.key).run();
        out.push({ room: row.room, result: "no_fights" });
        continue;
      }
      if (!(await claim(env.DB, row.room, week.key, now))) {
        out.push({ room: row.room, result: "busy" });
        continue;
      }
      const res = await send(env, row.url, jsonBody(buildPayload(recap, { origin: row.origin })), true);
      await saveOutcome(env.DB, row.room, res, isDone(res.outcome) ? week.key : null, now);
      out.push({ room: row.room, result: res.outcome });
    } catch (e) {
      console.error(`Wochenrückblick ${row.room}: ${(e as Error).message}`);
      await release(env.DB, row.room).catch(() => {});
      out.push({ room: row.room, result: "error" });
    }
  }
  return out;
}

// ---------- Wochenbild (Render-Agent) ----------

function apiJson(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

/** Body bis `max` Bytes lesen; null = zu groß (Rest wird verworfen) */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/** Wartet dieser Raum diese Woche auf ein Bild? */
const imagePending = (row: Row, week: Week) =>
  !!row.enabled && row.status !== "invalid" && row.last_week !== week.key && row.image_week !== week.key;

/**
 * /api/weekly/* – nur für den lokalen Render-Agenten. Ohne Secret WEEKLY_RENDER_KEY gibt es die Routen nicht (404).
 * Antworten enthalten nie Webhook-URLs.
 */
export async function handleWeeklyApi(req: Request, env: Env, url: URL): Promise<Response> {
  const auth = await checkRenderKey(env, req);
  if (auth === "disabled") return apiJson({ error: "not_found" }, 404);
  // Browser haben hier nichts zu suchen (kein CORS); Server-zu-Server-Aufrufe schicken keine Origin
  if (req.headers.get("origin")) return apiJson({ error: "origin_not_allowed" }, 403);
  if (auth !== "ok") return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "www-authenticate": 'Bearer realm="a2dps-weekly"' },
  });

  // Nur Tests (TEST_HOOKS=1): Zeitpunkt vorgeben, damit "abgelaufene Woche" die Testkämpfe trifft
  const testNow = env.TEST_HOOKS === "1" ? Number(req.headers.get("x-a2-test-now")) : NaN;
  const now = Number.isFinite(testNow) && testNow > 0 ? testNow : Date.now();
  const week = lastWeek(now);

  if (url.pathname === "/api/weekly/pending") {
    if (req.method !== "GET") return apiJson({ error: "method_not_allowed" }, 405);
    const rows = (
      await env.DB
        .prepare(
          `SELECT * FROM room_webhooks WHERE enabled = 1 AND status != 'invalid' AND (last_week IS NULL OR last_week != ?1)
             AND (image_week IS NULL OR image_week != ?1) ORDER BY room`,
        )
        .bind(week.key)
        .all<Row>()
    ).results;
    const rooms = [];
    for (const row of rows) {
      if (!(await roomDigest(env, row.room))) continue;
      const recap = await weekRecap(env, row, week, now);
      if (recap.fights) rooms.push(pendingView(recap));
    }
    return apiJson({ week: { key: week.key, from: week.from, to: week.to }, deadlineMs: week.to + IMAGE_DEADLINE_MS, rooms }, 200);
  }

  const m = /^\/api\/weekly\/([^/]+)\/image$/.exec(url.pathname);
  if (!m) return apiJson({ error: "not_found" }, 404);
  if (req.method !== "POST") return apiJson({ error: "method_not_allowed" }, 405);
  const room = decodeURIComponent(m[1]).toLowerCase();
  if (!ROOM_CODE_RE.test(room) || !(await roomDigest(env, room))) return apiJson({ error: "not_found" }, 404);

  const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "image/png") {
    await req.body?.cancel();
    return apiJson({ error: "bad_type", message: "Content-Type: image/png erwartet" }, 415);
  }
  if (Number(req.headers.get("content-length") || "0") > MAX_IMAGE_BYTES) {
    await req.body?.cancel();
    return apiJson({ error: "too_large", maxBytes: MAX_IMAGE_BYTES }, 413);
  }
  const png = await readLimited(req, MAX_IMAGE_BYTES);
  if (!png) return apiJson({ error: "too_large", maxBytes: MAX_IMAGE_BYTES }, 413);
  const dim = pngSize(png);
  if (!dim) return apiJson({ error: "bad_image", message: "kein PNG" }, 400);
  if (dim.width > MAX_IMAGE_SIDE || dim.height > MAX_IMAGE_SIDE) return apiJson({ error: "bad_image", message: `höchstens ${MAX_IMAGE_SIDE} px je Seite` }, 400);

  const row = await load(env.DB, room);
  if (!row || !imagePending(row, week)) return apiJson({ error: "not_pending", message: "Für diese Woche wird kein Bild (mehr) erwartet" }, 409);
  if (!(await claim(env.DB, room, week.key, now))) return apiJson({ error: "busy", message: "Versand läuft gerade" }, 409);

  try {
    const recap = await weekRecap(env, row, week, now);
    if (!recap.fights) {
      await release(env.DB, room);
      return apiJson({ error: "no_fights" }, 409);
    }
    const res = await send(env, row.url, imageBody(buildImagePayload(recap, { origin: row.origin }), png), true);
    // Bild abgelehnt (z. B. 400): Woche NICHT erledigt, der Cron schickt sofort die Text-Karte.
    // Rate-Limit/Störung: Agent darf es erneut versuchen, sonst Text-Karte nach der Frist.
    const done = res.outcome === "ok" || res.outcome === "invalid";
    await saveOutcome(env.DB, room, res, done ? week.key : null, now);
    const imageWeek = res.outcome === "ok" || res.outcome === "rejected" ? week.key : null;
    await env.DB
      .prepare("UPDATE room_webhooks SET image_week = COALESCE(?2, image_week), image_status = ?3 WHERE room = ?1")
      .bind(room, imageWeek, res.outcome)
      .run();
    const body = { ok: res.outcome === "ok", outcome: res.outcome, code: res.code, week: week.key };
    return apiJson(body, res.outcome === "ok" ? 200 : 502);
  } catch (e) {
    console.error(`Wochenbild ${room}: ${(e as Error).message}`);
    await release(env.DB, room).catch(() => {});
    return apiJson({ error: "internal" }, 500);
  }
}
