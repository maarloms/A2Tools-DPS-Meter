// Lesende D1-Abfragen direkt im Worker (kein Durable-Object-Aufruf nötig):
// Kampfliste, Übersicht, Mein Bereich, Vergleich, Bestenliste, Trends, Mitglieder.
// Gezeigt werden ausschließlich Gruppenmitglieder (siehe members.ts). Fremde zählen
// nur im Gesamtschaden der Kämpfe und damit in den Anteilen mit.

import { Env } from "./auth";
import { activeMembers, fixedMembers, listMembers, setHidden } from "./members";

const DAY = 86_400_000;

function int(v: string | null, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : def;
}

/** Zeitraum in Tagen → Startzeit (0 = alles) */
function since(url: URL, def = 0): number {
  const days = int(url.searchParams.get("days"), def, 0, 3650);
  return days ? Date.now() - days * DAY : 0;
}

/** Optionaler Boss-Filter "mobCode:dungeonId" */
function bossFilter(url: URL): { mob: number; dungeon: number } | null {
  const b = url.searchParams.get("boss");
  if (!b) return null;
  const m = /^(\d{1,12}):(\d{1,12})$/.exec(b);
  return m ? { mob: Number(m[1]), dungeon: Number(m[2]) } : null;
}

/** SQL-Bedingung "ist Mitglied"; ?9 = JSON-Array der Mitgliedsnamen (klein) */
const IS_MEMBER = "ps.player_lc IN (SELECT value FROM json_each(?9))";
/** Boss-Filter; ?7/?8 = mobCode/dungeonId oder NULL */
const BOSS = "(?7 IS NULL OR (ps.mob_code = ?7 AND ps.dungeon_id = ?8))";

type Boss = { mob: number; dungeon: number } | null;

/** Zeitreihe je Mitglied: Ø/Best-DPS und Ø-Anteil pro Tag oder Woche */
async function series(db: D1Database, room: string, ml: string, from: number, url: URL, player: string | null) {
  const boss = bossFilter(url);
  const week = url.searchParams.get("bucket") === "week";
  const tz = int(url.searchParams.get("tz"), 0, -840, 840); // Minuten Versatz zu UTC (Browser)
  return {
    bucket: week ? "week" : "day",
    points: (
      await db
        .prepare(
          `SELECT MAX(ps.player) AS player, strftime(?1, ps.start_ms / 1000 + ?2, 'unixepoch') AS period,
             AVG(ps.dps) AS avgDps, MAX(ps.dps) AS bestDps, COUNT(*) AS fights, AVG(ps.share) AS avgShare
           FROM player_stats ps
           WHERE ps.room = ?3 AND ps.start_ms >= ?4 AND ps.is_train = 0 AND ${BOSS} AND ${IS_MEMBER}
             AND (?5 IS NULL OR ps.player_lc = ?5)
           GROUP BY ps.player_lc, period ORDER BY period`,
        )
        .bind(week ? "%Y-W%W" : "%Y-%m-%d", tz * 60, room, from, player, null, boss?.mob ?? null, boss?.dungeon ?? null, ml)
        .all()
    ).results,
  };
}

export async function handleStats(
  db: D1Database,
  env: Env,
  room: string,
  rest: string,
  url: URL,
  req: Request,
): Promise<unknown | null> {
  const members = await activeMembers(db, env, room);
  const mset = new Set(members.map((n) => n.toLowerCase()));
  const ml = JSON.stringify([...mset]);
  const train = url.searchParams.get("train") === "1" ? 1 : 0;

  switch (rest) {
    // ---------- Mitglieder ----------
    case "/members": {
      if (req.method === "PATCH") {
        if (fixedMembers(env, room)) return { error: "fixed", message: "Mitglieder sind fest eingestellt (ROOM_MEMBERS)" };
        const body = (await req.json().catch(() => null)) as { name?: unknown; active?: unknown } | null;
        if (!body || typeof body.name !== "string" || typeof body.active !== "boolean") return { error: "bad_request" };
        const ok = await setHidden(db, room, body.name.slice(0, 32), !body.active);
        return ok ? { ok: true } : { error: "not_found" };
      }
      return listMembers(db, env, room);
    }

    // ---------- Kampfliste (nur Kämpfe mit Mitgliedern; gezeigt werden nur Mitglieder) ----------
    case "/fights": {
      const limit = int(url.searchParams.get("limit"), 50, 1, 100);
      const before = int(url.searchParams.get("before"), Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
      const boss = bossFilter(url);
      const rows = (
        await db
          .prepare(
            `SELECT e.id, e.boss, e.mob_code AS mobCode, e.dungeon_id AS dungeonId, e.start_ms AS startMs,
               e.duration_ms AS durationMs, e.total_damage AS totalDamage, e.max_hp AS maxHp, e.is_train AS isTrain,
               e.actor_count AS actorCount, e.uploaders
             FROM encounters e
             WHERE e.room = ?1 AND e.start_ms < ?2 AND (?3 = 1 OR e.is_train = 0)
               AND (?7 IS NULL OR (e.mob_code = ?7 AND e.dungeon_id = ?8))
               AND EXISTS (SELECT 1 FROM player_stats ps WHERE ps.encounter_id = e.id AND ${IS_MEMBER})
             ORDER BY e.start_ms DESC LIMIT ?4`,
          )
          .bind(room, before, train, limit + 1, null, null, boss?.mob ?? null, boss?.dungeon ?? null, ml)
          .all<Record<string, any>>()
      ).results;
      const page = rows.slice(0, limit);
      const tops = await membersOf(db, page.map((r) => r.id), ml);
      const fights = page.map((r) => ({
        ...r,
        isTrain: !!r.isTrain,
        uploaders: (JSON.parse(r.uploaders) as string[]).filter((u) => mset.has(u.toLowerCase())),
        top: tops.get(r.id) ?? [],
      }));
      return { fights, next: rows.length > limit ? rows[limit - 1].startMs : null };
    }

    // ---------- Übersicht ----------
    case "/stats/overview": {
      const now = Date.now();
      const w1 = now - 7 * DAY;
      const w2 = now - 14 * DAY;
      const cards = (
        await db
          .prepare(
            `SELECT ps.player_lc AS lc,
               AVG(CASE WHEN ps.start_ms >= ?1 THEN ps.dps END) AS avg7,
               AVG(CASE WHEN ps.start_ms >= ?2 AND ps.start_ms < ?1 THEN ps.dps END) AS prev7,
               AVG(ps.dps) AS avgAll, MAX(ps.dps) AS best, COUNT(*) AS fights,
               SUM(CASE WHEN ps.start_ms >= ?1 THEN 1 ELSE 0 END) AS fights7,
               MAX(ps.start_ms) AS lastMs, SUM(ps.dmg) AS totalDmg, AVG(ps.share) AS avgShare
             FROM player_stats ps WHERE ps.room = ?3 AND ps.is_train = 0 AND ${IS_MEMBER}
             GROUP BY ps.player_lc`,
          )
          .bind(w1, w2, room, null, null, null, null, null, ml)
          .all<Record<string, any>>()
      ).results;
      const jobs = await latestJobs(db, room, ml);
      const group = await db
        .prepare(
          `WITH em AS (SELECT ps.encounter_id, COUNT(*) AS n, SUM(ps.dmg) AS d, MAX(ps.start_ms) AS t
                       FROM player_stats ps WHERE ps.room = ?1 AND ps.is_train = 0 AND ${IS_MEMBER} GROUP BY ps.encounter_id)
           SELECT COUNT(*) AS fights, COALESCE(SUM(n >= 2), 0) AS together, COALESCE(SUM(d), 0) AS dmg,
             COALESCE(SUM(t >= ?2), 0) AS fights7 FROM em`,
        )
        .bind(room, w1, null, null, null, null, null, null, ml)
        .first<Record<string, number>>();
      const matrix = await bossMatrix(db, room, ml, 0, null);
      const recentRows = (
        await db
          .prepare(
            `SELECT e.id, e.boss, e.dungeon_id AS dungeonId, e.start_ms AS startMs, e.duration_ms AS durationMs,
               e.total_damage AS totalDamage
             FROM encounters e WHERE e.room = ?1 AND e.is_train = 0
               AND EXISTS (SELECT 1 FROM player_stats ps WHERE ps.encounter_id = e.id AND ${IS_MEMBER})
             ORDER BY e.start_ms DESC LIMIT 6`,
          )
          .bind(room, null, null, null, null, null, null, null, ml)
          .all<Record<string, any>>()
      ).results;
      const tops = await membersOf(db, recentRows.map((r) => r.id), ml);
      return {
        members: members.map((name) => {
          const lc = name.toLowerCase();
          const c = cards.find((x) => x.lc === lc);
          return { name, job: jobs.get(lc)?.job ?? "", jobId: jobs.get(lc)?.jobId ?? 0, fights: 0, ...(c ?? {}) };
        }),
        group: { ...group, bosses: matrix.length },
        matrix,
        recent: recentRows.map((r) => ({ ...r, members: tops.get(r.id) ?? [] })),
      };
    }

    // ---------- Mein Bereich ----------
    case "/stats/player": {
      const name = (url.searchParams.get("name") ?? "").toLowerCase().slice(0, 32);
      if (!name) return { error: "name_required" };
      if (!mset.has(name)) return { error: "not_member" };
      const from = since(url, 30);
      const span = Date.now() - from;
      const kpi = await db
        .prepare(
          `SELECT COUNT(*) AS fights, AVG(ps.dps) AS avgDps, MAX(ps.dps) AS bestDps, AVG(ps.share) AS avgShare,
             AVG(ps.crit_rate) AS avgCrit, AVG(ps.back_rate) AS avgBack, SUM(ps.dmg) AS totalDmg
           FROM player_stats ps WHERE ps.room = ?1 AND ps.player_lc = ?2 AND ps.start_ms >= ?3 AND ps.is_train = 0`,
        )
        .bind(room, name, from)
        .first<Record<string, number>>();
      const prev = from
        ? await db
            .prepare(
              `SELECT AVG(ps.dps) AS avgDps FROM player_stats ps
               WHERE ps.room = ?1 AND ps.player_lc = ?2 AND ps.start_ms >= ?3 AND ps.start_ms < ?4 AND ps.is_train = 0`,
            )
            .bind(room, name, from - span, from)
            .first<{ avgDps: number | null }>()
        : null;
      const records = (
        await db
          .prepare(
            `SELECT mob_code AS mobCode, dungeon_id AS dungeonId, boss, MAX(dps) AS bestDps, share AS bestShare,
               start_ms AS bestMs, encounter_id AS bestFightId, COUNT(*) AS fights, AVG(dps) AS avgDps,
               AVG(share) AS avgShare, AVG(crit_rate) AS avgCrit, AVG(back_rate) AS avgBack
             FROM player_stats WHERE room = ?1 AND player_lc = ?2 AND start_ms >= ?3 AND is_train = 0
             GROUP BY mob_code, dungeon_id ORDER BY fights DESC, bestDps DESC LIMIT 100`,
          )
          .bind(room, name, from)
          .all<Record<string, any>>()
      ).results;
      const recent = (
        await db
          .prepare(
            `SELECT boss, mob_code AS mobCode, dungeon_id AS dungeonId, dps, share, crit_rate AS critRate, start_ms AS startMs,
               duration_ms AS durationMs, encounter_id AS fightId
             FROM player_stats WHERE room = ?1 AND player_lc = ?2 AND is_train = 0
             ORDER BY start_ms DESC LIMIT 10`,
          )
          .bind(room, name)
          .all()
      ).results;
      const job = (await latestJobs(db, room, JSON.stringify([name]))).get(name);
      return {
        name: members.find((m) => m.toLowerCase() === name) ?? name,
        job: job?.job ?? "",
        jobId: job?.jobId ?? 0,
        kpi: { ...kpi, prevAvgDps: prev?.avgDps ?? null, favorite: records[0] ?? null },
        records,
        recent,
        series: await series(db, room, JSON.stringify([name]), from, url, name),
      };
    }

    // ---------- Vergleich ----------
    case "/stats/compare": {
      const from = since(url, 30);
      const boss = bossFilter(url);
      const rows = (
        await db
          .prepare(
            `SELECT ps.player_lc AS lc, COUNT(*) AS fights, AVG(ps.dps) AS avgDps, MAX(ps.dps) AS bestDps,
               AVG(ps.share) AS avgShare, AVG(ps.crit_rate) AS avgCrit, AVG(ps.back_rate) AS avgBack, SUM(ps.dmg) AS totalDmg
             FROM player_stats ps WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND ps.is_train = 0 AND ${BOSS} AND ${IS_MEMBER}
             GROUP BY ps.player_lc`,
          )
          .bind(room, from, null, null, null, null, boss?.mob ?? null, boss?.dungeon ?? null, ml)
          .all<Record<string, any>>()
      ).results;
      // In gemeinsamen Kämpfen (≥ 2 Mitglieder): wer war wie oft vorne?
      const wins = (
        await db
          .prepare(
            `WITH ranked AS (
               SELECT ps.player_lc AS lc, RANK() OVER (PARTITION BY ps.encounter_id ORDER BY ps.dps DESC) AS rk,
                 COUNT(*) OVER (PARTITION BY ps.encounter_id) AS n
               FROM player_stats ps WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND ps.is_train = 0 AND ${BOSS} AND ${IS_MEMBER})
             SELECT lc, COUNT(*) AS together, SUM(rk = 1) AS firsts FROM ranked WHERE n > 1 GROUP BY lc`,
          )
          .bind(room, from, null, null, null, null, boss?.mob ?? null, boss?.dungeon ?? null, ml)
          .all<{ lc: string; together: number; firsts: number }>()
      ).results;
      const jobs = await latestJobs(db, room, ml);
      return {
        members: members.map((name) => {
          const lc = name.toLowerCase();
          const r = rows.find((x) => x.lc === lc);
          const w = wins.find((x) => x.lc === lc);
          return {
            name,
            job: jobs.get(lc)?.job ?? "",
            jobId: jobs.get(lc)?.jobId ?? 0,
            fights: 0,
            ...(r ?? {}),
            together: w?.together ?? 0,
            firsts: w?.firsts ?? 0,
          };
        }),
        matrix: await bossMatrix(db, room, ml, from, boss),
        series: await series(db, room, ml, from, url, null),
      };
    }

    // ---------- Bosse (für Filter) / Top-Leistungen je Boss ----------
    case "/stats/bosses":
      return { bosses: await bossMatrix(db, room, ml, 0, null) };

    case "/stats/leaderboard": {
      const boss = bossFilter(url);
      if (!boss) return { error: "boss_required" };
      const top = (
        await db
          .prepare(
            `SELECT ps.player, ps.job, ps.job_id AS jobId, ps.dps, ps.share, ps.dmg, ps.start_ms AS startMs,
               ps.duration_ms AS durationMs, ps.encounter_id AS fightId
             FROM player_stats ps
             WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND ps.is_train = 0 AND ${BOSS} AND ${IS_MEMBER}
             ORDER BY ps.dps DESC LIMIT 15`,
          )
          .bind(room, since(url), null, null, null, null, boss.mob, boss.dungeon, ml)
          .all()
      ).results;
      return { top };
    }

    case "/stats/trends": {
      const player = (url.searchParams.get("player") ?? "").toLowerCase().slice(0, 32) || null;
      return series(db, room, ml, since(url, 90), url, player);
    }
  }
  return null;
}

/** Mitglieder je Kampf (für Liste/Übersicht), sortiert nach DPS */
async function membersOf(db: D1Database, ids: string[], ml: string) {
  const out = new Map<string, { name: string; job: string; jobId: number; dps: number; share: number }[]>();
  if (!ids.length) return out;
  const rows = (
    await db
      .prepare(
        `SELECT ps.encounter_id AS id, ps.player AS name, ps.job, ps.job_id AS jobId, ps.dps, ps.share
         FROM player_stats ps WHERE ps.encounter_id IN (SELECT value FROM json_each(?1)) AND ${IS_MEMBER}
         ORDER BY ps.dps DESC`,
      )
      .bind(JSON.stringify(ids), null, null, null, null, null, null, null, ml)
      .all<{ id: string; name: string; job: string; jobId: number; dps: number; share: number }>()
  ).results;
  for (const r of rows) {
    const { id, ...p } = r;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(p);
  }
  return out;
}

/** Zuletzt gespielte Klasse je Mitglied */
async function latestJobs(db: D1Database, room: string, ml: string) {
  const rows = (
    await db
      .prepare(
        `WITH r AS (SELECT ps.player_lc AS lc, ps.job, ps.job_id AS jobId,
                      ROW_NUMBER() OVER (PARTITION BY ps.player_lc ORDER BY ps.start_ms DESC) AS rn
                    FROM player_stats ps WHERE ps.room = ?1 AND ${IS_MEMBER})
         SELECT lc, job, jobId FROM r WHERE rn = 1`,
      )
      .bind(room, null, null, null, null, null, null, null, ml)
      .all<{ lc: string; job: string; jobId: number }>()
  ).results;
  return new Map(rows.map((r) => [r.lc, r]));
}

/** Bestwert je Boss und Mitglied; `leader` = wer vorne liegt */
async function bossMatrix(db: D1Database, room: string, ml: string, from: number, boss: Boss) {
  const rows = (
    await db
      .prepare(
        `SELECT ps.mob_code AS mobCode, ps.dungeon_id AS dungeonId, MAX(ps.boss) AS boss, MAX(ps.player) AS player,
           MAX(ps.dps) AS bestDps, AVG(ps.dps) AS avgDps, AVG(ps.share) AS avgShare, COUNT(*) AS fights, MAX(ps.start_ms) AS lastMs
         FROM player_stats ps WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND ps.is_train = 0 AND ${BOSS} AND ${IS_MEMBER}
         GROUP BY ps.mob_code, ps.dungeon_id, ps.player_lc`,
      )
      .bind(room, from, null, null, null, null, boss?.mob ?? null, boss?.dungeon ?? null, ml)
      .all<{ mobCode: number; dungeonId: number; boss: string; player: string; bestDps: number; avgDps: number; avgShare: number; fights: number; lastMs: number }>()
  ).results;
  const byBoss = new Map<string, any>();
  for (const r of rows) {
    const key = `${r.mobCode}:${r.dungeonId}`;
    if (!byBoss.has(key)) byBoss.set(key, { key, mobCode: r.mobCode, dungeonId: r.dungeonId, boss: r.boss, fights: 0, lastMs: 0, players: [] });
    const b = byBoss.get(key);
    b.fights = Math.max(b.fights, r.fights);
    b.lastMs = Math.max(b.lastMs, r.lastMs);
    b.players.push({ name: r.player, bestDps: r.bestDps, avgDps: r.avgDps, avgShare: r.avgShare, fights: r.fights });
  }
  for (const b of byBoss.values()) {
    b.players.sort((x: any, y: any) => y.bestDps - x.bestDps);
    b.leader = b.players[0]?.name ?? null;
    b.best = b.players[0] ? { player: b.players[0].name, dps: b.players[0].bestDps } : null;
  }
  return [...byBoss.values()].sort((a, b) => b.fights - a.fights || b.lastMs - a.lastMs);
}
