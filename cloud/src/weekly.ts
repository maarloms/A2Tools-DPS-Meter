// Wochenrückblick per Discord-Webhook: Einstellungen je Raum (Dashboard) und Cron-Versand.
//
//  GET    /api/rooms/:code/webhook       Stand (nie die URL selbst, nur "…abcd")
//  PATCH  /api/rooms/:code/webhook       { url?, enabled? }        Admin
//  DELETE /api/rooms/:code/webhook                                 Admin
//  POST   /api/rooms/:code/webhook/test  Test-Post (laufende Woche) Admin
//
// Cron (wrangler.jsonc "triggers"): Mittwochs nach dem Reset stündlich; jeder Raum bekommt
// die abgelaufene Woche genau einmal (room_webhooks.last_week). Wochen ohne Kämpfe werden
// still übersprungen. Datenquelle: encounters/player_stats wie Übersicht und Wochenrückblick
// im Dashboard – nur Mitglieder, nur zählende Bosse (ohne Feldbosse), ohne Training.

import { Env, roomDigest } from "./auth";
import { relevant } from "./bosses";
import { activeMembers } from "./members";
import {
  MAX_RETRY_WAIT_MS, Recap, SendOutcome, TEST_MIN_INTERVAL_MS, Week, bossDpsChange, buildPayload, buildPingPayload,
  classifyStatus, currentWeek, lastWeek, parseWebhookUrl, retryAfterMs, webhookHint, WEEK_MS,
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
  const recap = await buildRecap(db, env, room, currentWeek(now), now);
  const payload = recap.fights ? buildPayload(recap, { origin: row.origin, test: true, now }) : buildPingPayload(room, row.origin);
  const res = await send(env, row.url, payload, false);
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

  const best = await db
    .prepare(
      `SELECT e.id AS fightId, e.boss, e.duration_ms AS durationMs, e.killed, SUM(ps.dps) AS groupDps
       FROM encounters e JOIN player_stats ps ON ps.encounter_id = e.id AND ${IS_MEMBER}
       WHERE e.room = ?1 AND e.start_ms >= ?2 AND e.start_ms < ?3 AND e.is_train = 0 AND ${REL_E}
       GROUP BY e.id ORDER BY e.killed DESC, groupDps DESC LIMIT 1`,
    )
    .bind(room, week.from, to, ml)
    .first<{ fightId: string; boss: string; durationMs: number; killed: number; groupDps: number }>();

  const top = (
    await db
      .prepare(
        `SELECT lc, dps, boss FROM (SELECT ps.player_lc AS lc, ps.dps AS dps, ps.boss AS boss,
           ROW_NUMBER() OVER (PARTITION BY ps.player_lc ORDER BY ps.dps DESC) AS rn
         FROM player_stats ps WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND ps.start_ms < ?3 AND ps.is_train = 0 AND ${REL_PS} AND ${IS_MEMBER})
         WHERE rn = 1 ORDER BY dps DESC LIMIT 3`,
      )
      .bind(room, week.from, to, ml)
      .all<{ lc: string; dps: number; boss: string }>()
  ).results;

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

  return {
    room,
    week,
    fights: group?.fights ?? 0,
    kills: group?.kills ?? 0,
    prevFights: group?.prevFights ?? 0,
    prevKills: group?.prevKills ?? 0,
    best: best ? { fightId: best.fightId, boss: best.boss, groupDps: best.groupDps, durationMs: best.durationMs, killed: !!best.killed } : null,
    top: top.map((t) => ({ name: names.get(t.lc) ?? t.lc, dps: t.dps, boss: t.boss })),
    dpsChange: bossDpsChange(perBoss),
  };
}

// ---------- Versand ----------

interface SendResult {
  outcome: SendOutcome;
  code: number;
  waitMs?: number;
}

/**
 * Ein POST an Discord. Bei 429 mit kurzer Wartezeit (≤ 5 s) einmal neu, sonst Abbruch.
 * DISCORD_API_BASE (nur Tests): Host austauschen, Pfad bleibt.
 */
async function send(env: Env, hook: string, payload: unknown, allowWait: boolean): Promise<SendResult> {
  const target = env.DISCORD_API_BASE ? hook.replace(/^https:\/\/discord\.com/, env.DISCORD_API_BASE.replace(/\/$/, "")) : hook;
  for (let attempt = 0; attempt < 2; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(`${target}?wait=true`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "a2dps-cloud (Wochenrueckblick)" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
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

/** Ergebnis speichern; `week` = erledigte Woche (null = Test oder später nochmal versuchen) */
async function saveOutcome(db: D1Database, room: string, res: SendResult, week: string | null, now: number) {
  const status = res.outcome === "ok" ? "ok" : res.outcome === "invalid" ? "invalid" : "error";
  await db
    .prepare(
      `UPDATE room_webhooks SET status = ?2, last_code = ?3, last_error = ?4,
         last_week = COALESCE(?5, last_week), last_post_ms = CASE WHEN ?6 = 1 THEN ?7 ELSE last_post_ms END
       WHERE room = ?1`,
    )
    .bind(room, status, res.code || null, ERROR_TEXT[res.outcome], week, res.outcome === "ok" ? 1 : 0, now)
    .run();
}

/**
 * Cron: für jeden eingeschalteten Raum die abgelaufene Woche posten (einmal).
 * Rückgabe für Logs/Tests: je Raum, was passiert ist.
 */
export async function runWeekly(env: Env, now: number): Promise<{ room: string; result: string }[]> {
  const week = lastWeek(now);
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
    try {
      const recap = await buildRecap(env.DB, env, row.room, week, now);
      if (!recap.fights) {
        await env.DB.prepare("UPDATE room_webhooks SET last_week = ?2 WHERE room = ?1").bind(row.room, week.key).run();
        out.push({ room: row.room, result: "no_fights" });
        continue;
      }
      const res = await send(env, row.url, buildPayload(recap, { origin: row.origin }), true);
      // Erledigt: gepostet, ungültig oder abgelehnt. Rate-Limit/Störung: nächster Cron-Lauf.
      const done = res.outcome === "ok" || res.outcome === "invalid" || res.outcome === "rejected";
      await saveOutcome(env.DB, row.room, res, done ? week.key : null, now);
      out.push({ room: row.room, result: res.outcome });
    } catch (e) {
      console.error(`Wochenrückblick ${row.room}: ${(e as Error).message}`);
      out.push({ room: row.room, result: "error" });
    }
  }
  return out;
}
