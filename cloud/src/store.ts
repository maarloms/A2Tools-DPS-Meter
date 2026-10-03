// D1-Zugriffe fuer Kaempfe (aufgerufen aus dem Durable Object des Raums,
// das Uploads pro Raum serialisiert) und Mitgliederverwaltung.

import { LIMITS } from "./protocol";
import {
  EncounterDetail,
  MERGE_VERSION,
  StoredUpload,
  UploadDetail,
  mergeEncounter,
  obscureNickname,
  packJson,
  shortHash,
  unpackJson,
} from "./fights";

export async function memberNames(db: D1Database, room: string): Promise<string[]> {
  const r = await db.prepare("SELECT name FROM members WHERE room = ?1 ORDER BY last_seen DESC LIMIT 200").bind(room).all<{ name: string }>();
  return r.results.map((x) => x.name);
}

/**
 * Traegt ein Mitglied ein. Ist es neu, werden seine bisher maskierten Eintraege
 * ("Fr****1") in player_stats auf den echten Namen umgeschrieben.
 */
export async function registerMember(db: D1Database, room: string, name: string, now = Date.now(), rewrite = true): Promise<boolean> {
  const lc = name.toLowerCase();
  const existing = await db.prepare("SELECT name FROM members WHERE room = ?1 AND name_lc = ?2").bind(room, lc).first<{ name: string }>();
  await db
    .prepare(
      "INSERT INTO members (room, name_lc, name, last_seen) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(room, name_lc) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen",
    )
    .bind(room, lc, name, now)
    .run();
  if (existing) return false;
  const mask = obscureNickname(name);
  if (rewrite && mask !== name) {
    // Nur wenn kein anderes Mitglied dieselbe Maske hat
    const others = await memberNames(db, room);
    const clash = others.some((o) => o.toLowerCase() !== lc && obscureNickname(o) === mask);
    if (!clash) {
      await db
        .prepare("UPDATE OR IGNORE player_stats SET player = ?1, player_lc = ?2 WHERE room = ?3 AND player_lc = ?4")
        .bind(name, lc, room, mask.toLowerCase())
        .run();
    }
  }
  return true;
}

interface EncRow {
  id: string;
  start_ms: number;
  target_id: number;
}

/** Sucht einen bestehenden Kampf, zu dem dieser Upload gehoert. */
async function findEncounter(db: D1Database, room: string, uploadId: string, d: UploadDetail): Promise<string | null> {
  const prev = await db.prepare("SELECT encounter_id FROM uploads WHERE id = ?1").bind(uploadId).first<{ encounter_id: string }>();
  if (prev) return prev.encounter_id;

  const w = LIMITS.sameTargetWindowMs;
  const rows = (
    await db
      .prepare(
        `SELECT id, start_ms, target_id FROM encounters
         WHERE room = ?1 AND mob_code = ?2 AND dungeon_id = ?3 AND (?2 != 0 OR boss = ?4)
           AND start_ms BETWEEN ?5 AND ?6
         ORDER BY ABS(start_ms - ?7) LIMIT 5`,
      )
      .bind(room, d.mobCode, d.dungeonId, d.boss, d.startMs - w, d.startMs + w, d.startMs)
      .all<EncRow>()
  ).results;
  for (const e of rows) {
    const near = Math.abs(e.start_ms - d.startMs) <= LIMITS.sameFightWindowMs;
    const sameTarget = d.targetId !== 0 && e.target_id === d.targetId;
    if (!near && !sameTarget) continue;
    // Derselbe Uploader hat dort schon einen ANDEREN Kampf → anderer Pull
    const own = await db
      .prepare("SELECT 1 AS x FROM uploads WHERE encounter_id = ?1 AND lower(uploader) = ?2 AND id != ?3 LIMIT 1")
      .bind(e.id, d.uploader.toLowerCase(), uploadId)
      .first();
    if (!own) return e.id;
  }
  return null;
}

export interface SaveResult {
  uploadId: string;
  encounterId: string;
  replaced: boolean;
  perspectives: number;
  detail: EncounterDetail;
  removedUploads: string[];
}

/** Speichert einen Upload, fuehrt den Kampf neu zusammen und aktualisiert player_stats. */
export async function saveUpload(
  db: D1Database,
  room: string,
  detail: UploadDetail,
  rawBytes: number,
  known: string[],
  now = Date.now(),
): Promise<SaveResult> {
  const uploadId = await shortHash(`${room}|${detail.uploader.toLowerCase()}|${detail.recordId}`);
  const existing = await db.prepare("SELECT 1 AS x FROM uploads WHERE id = ?1").bind(uploadId).first();
  const encounterId = (await findEncounter(db, room, uploadId, detail)) ?? (await shortHash(`${room}|enc|${uploadId}`));

  await db
    .prepare(
      `INSERT INTO uploads (id, room, encounter_id, uploader, record_id, start_ms, duration_ms, uploaded_at, raw_bytes, detail)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET encounter_id = excluded.encounter_id, start_ms = excluded.start_ms,
         duration_ms = excluded.duration_ms, uploaded_at = excluded.uploaded_at, raw_bytes = excluded.raw_bytes, detail = excluded.detail`,
    )
    .bind(uploadId, room, encounterId, detail.uploader, detail.recordId, detail.startMs, detail.durationMs, now, rawBytes, await packJson(detail))
    .run();

  const merged = await remerge(db, room, encounterId, known, now);
  const removedUploads = await enforceRetention(db, room);
  return { uploadId, encounterId, replaced: !!existing, perspectives: merged.uploads.length, detail: merged, removedUploads };
}

/** Liest alle Uploads eines Kampfs, fuehrt zusammen und schreibt encounters + player_stats. */
async function remerge(db: D1Database, room: string, encounterId: string, known: string[], now: number): Promise<EncounterDetail> {
  const rows = (
    await db
      .prepare("SELECT id, uploader, raw_bytes, detail FROM uploads WHERE encounter_id = ?1 ORDER BY uploaded_at")
      .bind(encounterId)
      .all<{ id: string; uploader: string; raw_bytes: number; detail: string }>()
  ).results;
  const uploads: StoredUpload[] = [];
  for (const r of rows) uploads.push({ id: r.id, uploader: r.uploader, rawBytes: r.raw_bytes, detail: await unpackJson<UploadDetail>(r.detail) });
  const d = mergeEncounter(encounterId, uploads, known);
  const s = d.summary;

  const knownLc = new Set([...known, ...s.uploaders].map((n) => n.toLowerCase()));
  const statRows = d.players.filter((p, i) => p.dmg > 0 && (i < LIMITS.statsTopPlayers || knownLc.has(p.name.toLowerCase())));

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO encounters (id, room, mob_code, target_id, boss, dungeon_id, start_ms, duration_ms, total_damage, max_hp,
           is_train, actor_count, uploaders, top, detail, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(id) DO UPDATE SET mob_code = excluded.mob_code, target_id = excluded.target_id, boss = excluded.boss,
           dungeon_id = excluded.dungeon_id, start_ms = excluded.start_ms, duration_ms = excluded.duration_ms,
           total_damage = excluded.total_damage, max_hp = excluded.max_hp, is_train = excluded.is_train,
           actor_count = excluded.actor_count, uploaders = excluded.uploaders, top = excluded.top,
           detail = excluded.detail, updated_at = excluded.updated_at`,
      )
      .bind(
        encounterId, room, s.mobCode, s.targetId, s.boss, s.dungeonId, s.startMs, s.durationMs, s.totalDamage, s.maxHp,
        s.isTrain ? 1 : 0, s.actorCount, JSON.stringify(s.uploaders), JSON.stringify(s.top), await packJson(d), now,
      ),
    db.prepare("DELETE FROM player_stats WHERE encounter_id = ?1").bind(encounterId),
  ];
  for (const p of statRows) {
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO player_stats (encounter_id, room, player, player_lc, job, job_id, source, self_report, dps, dmg, share,
             crit_rate, back_rate, hits, heal, cp, mob_code, boss, dungeon_id, start_ms, duration_ms, is_train)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`,
        )
        .bind(
          encounterId, room, p.name, p.name.toLowerCase(), p.job, p.jobId, p.source, p.selfReport ? 1 : 0, p.dps, p.dmg, p.share,
          p.critRate, p.backRate, p.hits, p.heal, p.cp, s.mobCode, s.boss, s.dungeonId, s.startMs, s.durationMs, s.isTrain ? 1 : 0,
        ),
    );
  }
  await db.batch(stmts); // atomar
  return d;
}

/** Aelteste Kaempfe ueber dem Limit loeschen. Liefert geloeschte Upload-IDs (fuer Rohdaten im DO). */
async function enforceRetention(db: D1Database, room: string): Promise<string[]> {
  const old = (
    await db
      .prepare("SELECT id FROM encounters WHERE room = ?1 ORDER BY start_ms DESC LIMIT 50 OFFSET ?2")
      .bind(room, LIMITS.maxEncountersPerRoom)
      .all<{ id: string }>()
  ).results;
  const removed: string[] = [];
  for (const e of old) removed.push(...(await deleteEncounter(db, e.id)));
  return removed;
}

/** Loescht einen Kampf samt Uploads und Statistik. Liefert die Upload-IDs. */
export async function deleteEncounter(db: D1Database, encounterId: string): Promise<string[]> {
  const ups = (await db.prepare("SELECT id FROM uploads WHERE encounter_id = ?1").bind(encounterId).all<{ id: string }>()).results;
  await db.batch([
    db.prepare("DELETE FROM player_stats WHERE encounter_id = ?1").bind(encounterId),
    db.prepare("DELETE FROM uploads WHERE encounter_id = ?1").bind(encounterId),
    db.prepare("DELETE FROM encounters WHERE id = ?1").bind(encounterId),
  ]);
  return ups.map((u) => u.id);
}

/**
 * Laedt einen Kampf. Stammt seine Zusammenfuehrung aus einer aelteren
 * Version, wird er aus den gespeicherten Uploads neu zusammengefuehrt.
 */
export async function loadEncounter(db: D1Database, room: string, id: string, known: string[] = []): Promise<EncounterDetail | null> {
  const row = await db.prepare("SELECT detail FROM encounters WHERE id = ?1 AND room = ?2").bind(id, room).first<{ detail: string }>();
  if (!row) return null;
  const d = await unpackJson<EncounterDetail>(row.detail);
  return (d.v ?? 2) < MERGE_VERSION ? remerge(db, room, id, known, Date.now()) : d;
}

