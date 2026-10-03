// Lesende D1-Abfragen direkt im Worker (kein Durable-Object-Aufruf noetig):
// Kampfliste, Bestenliste, Rekorde, Gruppenvergleich, Trends.
// Alles nur fuer Gruppenmitglieder (Tabelle members) – fremde Namen sind in
// den FightRecords ohnehin maskiert.

import { TopEntry, unmasker } from "./fights";
import { memberNames } from "./store";

const DAY = 86_400_000;

function int(v: string | null, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : def;
}

/** Zeitraum in Tagen → Startzeit (0 = alles) */
function since(url: URL): number {
  const days = int(url.searchParams.get("days"), 0, 0, 3650);
  return days ? Date.now() - days * DAY : 0;
}

/** Optionaler Boss-Filter "mobCode:dungeonId" */
function bossFilter(url: URL): { mob: number; dungeon: number } | null {
  const b = url.searchParams.get("boss");
  if (!b) return null;
  const m = /^(\d{1,12}):(\d{1,12})$/.exec(b);
  return m ? { mob: Number(m[1]), dungeon: Number(m[2]) } : null;
}

const MEMBER_JOIN = "JOIN members m ON m.room = ps.room AND m.name_lc = ps.player_lc";

export async function handleStats(db: D1Database, room: string, rest: string, url: URL): Promise<unknown | null> {
  const train = url.searchParams.get("train") === "1" ? 1 : 0;

  switch (rest) {
    // ---------- Kampfliste ----------
    case "/fights": {
      const limit = int(url.searchParams.get("limit"), 50, 1, 100);
      const before = int(url.searchParams.get("before"), Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
      const boss = bossFilter(url);
      const rows = (
        await db
          .prepare(
            `SELECT id, boss, mob_code AS mobCode, dungeon_id AS dungeonId, start_ms AS startMs, duration_ms AS durationMs,
               total_damage AS totalDamage, max_hp AS maxHp, is_train AS isTrain, actor_count AS actorCount, uploaders, top
             FROM encounters
             WHERE room = ?1 AND start_ms < ?2 AND (?3 = 1 OR is_train = 0)
               AND (?4 IS NULL OR (mob_code = ?4 AND dungeon_id = ?5))
             ORDER BY start_ms DESC LIMIT ?6`,
          )
          .bind(room, before, train, boss?.mob ?? null, boss?.dungeon ?? null, limit + 1)
          .all<Record<string, any>>()
      ).results;
      const unmask = unmasker(await memberNames(db, room));
      const fights = rows.slice(0, limit).map((r) => ({
        ...r,
        isTrain: !!r.isTrain,
        uploaders: JSON.parse(r.uploaders) as string[],
        top: (JSON.parse(r.top) as TopEntry[]).map((t) => ({ ...t, name: unmask(t.name) })),
      }));
      return { fights, next: rows.length > limit ? rows[limit - 1].startMs : null };
    }

    case "/members": {
      const rows = (
        await db
          .prepare("SELECT name, last_seen AS lastSeen FROM members WHERE room = ?1 ORDER BY name_lc")
          .bind(room)
          .all()
      ).results;
      return { members: rows };
    }

    // ---------- Bosse mit Bestwerten ----------
    case "/stats/bosses": {
      const bosses = (
        await db
          .prepare(
            `SELECT mob_code AS mobCode, dungeon_id AS dungeonId, boss, COUNT(*) AS fights, MAX(start_ms) AS lastMs
             FROM encounters WHERE room = ?1 AND (?2 = 1 OR is_train = 0)
             GROUP BY mob_code, dungeon_id ORDER BY lastMs DESC LIMIT 300`,
          )
          .bind(room, train)
          .all<Record<string, any>>()
      ).results;
      // SQLite: bei genau einem MAX() stammen die uebrigen Spalten aus der Zeile mit dem Maximum
      const best = (
        await db
          .prepare(
            `SELECT ps.mob_code AS mobCode, ps.dungeon_id AS dungeonId, ps.player, ps.job, ps.job_id AS jobId,
               MAX(ps.dps) AS dps, ps.start_ms AS startMs, ps.encounter_id AS fightId
             FROM player_stats ps ${MEMBER_JOIN}
             WHERE ps.room = ?1 AND (?2 = 1 OR ps.is_train = 0)
             GROUP BY ps.mob_code, ps.dungeon_id`,
          )
          .bind(room, train)
          .all<Record<string, any>>()
      ).results;
      const key = (r: any) => `${r.mobCode}:${r.dungeonId}`;
      const bestBy = new Map(best.map((b) => [key(b), b]));
      return { bosses: bosses.map((b) => ({ ...b, key: key(b), best: bestBy.get(key(b)) ?? null })) };
    }

    // ---------- Bestenliste eines Bosses ----------
    case "/stats/leaderboard": {
      const boss = bossFilter(url);
      if (!boss) return { error: "boss_required" };
      const from = since(url);
      const players = (
        await db
          .prepare(
            `SELECT ps.player, ps.job, ps.job_id AS jobId, MAX(ps.dps) AS bestDps, ps.share AS bestShare,
               ps.start_ms AS bestMs, ps.encounter_id AS bestFightId,
               COUNT(*) AS fights, AVG(ps.dps) AS avgDps, AVG(ps.share) AS avgShare, AVG(ps.crit_rate) AS avgCrit
             FROM player_stats ps ${MEMBER_JOIN}
             WHERE ps.room = ?1 AND ps.mob_code = ?2 AND ps.dungeon_id = ?3 AND ps.start_ms >= ?4 AND (?5 = 1 OR ps.is_train = 0)
             GROUP BY ps.player_lc ORDER BY bestDps DESC`,
          )
          .bind(room, boss.mob, boss.dungeon, from, train)
          .all()
      ).results;
      const top = (
        await db
          .prepare(
            `SELECT ps.player, ps.job, ps.job_id AS jobId, ps.dps, ps.share, ps.dmg, ps.start_ms AS startMs,
               ps.duration_ms AS durationMs, ps.encounter_id AS fightId
             FROM player_stats ps ${MEMBER_JOIN}
             WHERE ps.room = ?1 AND ps.mob_code = ?2 AND ps.dungeon_id = ?3 AND ps.start_ms >= ?4 AND (?5 = 1 OR ps.is_train = 0)
             ORDER BY ps.dps DESC LIMIT 15`,
          )
          .bind(room, boss.mob, boss.dungeon, from, train)
          .all()
      ).results;
      const fights = await db
        .prepare(
          `SELECT COUNT(*) AS fights, MIN(duration_ms) AS shortestMs, AVG(duration_ms) AS avgMs, MAX(boss) AS boss
           FROM encounters WHERE room = ?1 AND mob_code = ?2 AND dungeon_id = ?3 AND start_ms >= ?4 AND (?5 = 1 OR is_train = 0)`,
        )
        .bind(room, boss.mob, boss.dungeon, from, train)
        .first();
      return { boss: { ...boss, ...fights }, players, top };
    }

    // ---------- Persoenliche Rekorde ----------
    case "/stats/player": {
      const name = (url.searchParams.get("name") ?? "").toLowerCase().slice(0, 32);
      if (!name) return { error: "name_required" };
      const from = since(url);
      const records = (
        await db
          .prepare(
            `SELECT mob_code AS mobCode, dungeon_id AS dungeonId, boss, MAX(dps) AS bestDps, share AS bestShare,
               start_ms AS bestMs, encounter_id AS bestFightId, COUNT(*) AS fights, AVG(dps) AS avgDps,
               AVG(crit_rate) AS avgCrit, AVG(back_rate) AS avgBack
             FROM player_stats WHERE room = ?1 AND player_lc = ?2 AND start_ms >= ?3 AND (?4 = 1 OR is_train = 0)
             GROUP BY mob_code, dungeon_id ORDER BY fights DESC, bestDps DESC LIMIT 200`,
          )
          .bind(room, name, from, train)
          .all()
      ).results;
      const recent = (
        await db
          .prepare(
            `SELECT boss, mob_code AS mobCode, dungeon_id AS dungeonId, dps, share, crit_rate AS critRate, start_ms AS startMs,
               duration_ms AS durationMs, encounter_id AS fightId
             FROM player_stats WHERE room = ?1 AND player_lc = ?2 AND (?3 = 1 OR is_train = 0)
             ORDER BY start_ms DESC LIMIT 20`,
          )
          .bind(room, name, train)
          .all()
      ).results;
      return { name, records, recent };
    }

    // ---------- Gruppenvergleich ----------
    case "/stats/compare": {
      const from = since(url);
      const members = (
        await db
          .prepare(
            `SELECT ps.player, COUNT(*) AS fights, AVG(ps.dps) AS avgDps, MAX(ps.dps) AS bestDps, AVG(ps.share) AS avgShare,
               AVG(ps.crit_rate) AS avgCrit, AVG(ps.back_rate) AS avgBack, SUM(ps.dmg) AS totalDmg, MAX(ps.start_ms) AS lastMs
             FROM player_stats ps ${MEMBER_JOIN}
             WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND (?3 = 1 OR ps.is_train = 0)
             GROUP BY ps.player_lc ORDER BY avgDps DESC`,
          )
          .bind(room, from, train)
          .all()
      ).results;
      // Bestwerte je Boss und Mitglied (fuer die Vergleichsmatrix)
      const matrix = (
        await db
          .prepare(
            `SELECT ps.mob_code AS mobCode, ps.dungeon_id AS dungeonId, ps.boss, ps.player, MAX(ps.dps) AS bestDps, COUNT(*) AS fights
             FROM player_stats ps ${MEMBER_JOIN}
             WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND (?3 = 1 OR ps.is_train = 0)
             GROUP BY ps.mob_code, ps.dungeon_id, ps.player_lc`,
          )
          .bind(room, from, train)
          .all()
      ).results;
      // Gemeinsame Kaempfe: wer hatte wie oft den hoechsten DPS, wenn mehrere Mitglieder dabei waren
      const wins = (
        await db
          .prepare(
            `WITH ranked AS (
               SELECT ps.encounter_id, ps.player, ps.dps,
                 RANK() OVER (PARTITION BY ps.encounter_id ORDER BY ps.dps DESC) AS rk,
                 COUNT(*) OVER (PARTITION BY ps.encounter_id) AS n
               FROM player_stats ps ${MEMBER_JOIN}
               WHERE ps.room = ?1 AND ps.start_ms >= ?2 AND (?3 = 1 OR ps.is_train = 0))
             SELECT player, COUNT(*) AS together, SUM(rk = 1) AS firsts FROM ranked WHERE n > 1 GROUP BY lower(player)`,
          )
          .bind(room, from, train)
          .all()
      ).results;
      return { members, matrix, wins };
    }

    // ---------- Verlauf / Trends ----------
    case "/stats/trends": {
      const from = since(url) || Date.now() - 90 * DAY;
      const boss = bossFilter(url);
      const week = url.searchParams.get("bucket") === "week";
      const tz = int(url.searchParams.get("tz"), 0, -840, 840); // Minuten Versatz zu UTC (Browser)
      const fmt = week ? "%Y-W%W" : "%Y-%m-%d";
      const points = (
        await db
          .prepare(
            `SELECT ps.player, strftime(?1, ps.start_ms / 1000 + ?2, 'unixepoch') AS period,
               AVG(ps.dps) AS avgDps, MAX(ps.dps) AS bestDps, COUNT(*) AS fights, AVG(ps.share) AS avgShare,
               MIN(ps.start_ms) AS firstMs
             FROM player_stats ps ${MEMBER_JOIN}
             WHERE ps.room = ?3 AND ps.start_ms >= ?4 AND (?5 = 1 OR ps.is_train = 0)
               AND (?6 IS NULL OR (ps.mob_code = ?6 AND ps.dungeon_id = ?7))
             GROUP BY lower(ps.player), period ORDER BY period`,
          )
          .bind(fmt, tz * 60, room, from, train, boss?.mob ?? null, boss?.dungeon ?? null)
          .all()
      ).results;
      return { bucket: week ? "week" : "day", from, points };
    }
  }
  return null;
}
