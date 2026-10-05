// D1-Zugriffe fuer Kaempfe (aufgerufen aus dem Durable Object des Raums,
// das Uploads pro Raum serialisiert) und Mitgliederverwaltung.

import { LIMITS } from "./protocol";
import { isHidden, upsertBoss } from "./bosses";
import {
  EncounterDetail,
  MERGE_VERSION,
  StoredUpload,
  UploadDetail,
  mergeEncounter,
  obscureNickname,
  frontRateOf,
  packJson,
  peakDps,
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
  dungeon_id: number;
}

/**
 * Sucht einen bestehenden Kampf, zu dem dieser Upload gehoert.
 *
 * Die Dungeon-ID ist kein hartes Kriterium: Meter derselben Gruppe melden fuer
 * denselben Kampf oft verschiedene (eine veraltete aus der letzten Instanz, 0
 * ohne Gruppenliste), und jeder Upload landete dann in einem eigenen Kampf.
 * Bei zwei verschiedenen, bekannten Dungeons muss der Start nah beieinander
 * liegen; dieselbe Entity-ID allein genuegt dann nicht.
 *
 * Dieselbe Entity zaehlt auch, wenn sich die Kampfzeiten ueberschneiden: ein
 * Meter, der einen Kampf ueber eine lange Pause zieht, beginnt ihn
 * Viertelstunden vor einem anderen, der erst nach der Pause dazukam.
 */
async function findEncounter(db: D1Database, room: string, uploadId: string, d: UploadDetail): Promise<string | null> {
  const prev = await db.prepare("SELECT encounter_id FROM uploads WHERE id = ?1").bind(uploadId).first<{ encounter_id: string }>();
  if (prev) return prev.encounter_id;

  const w = LIMITS.sameTargetWindowMs;
  const rows = (
    await db
      .prepare(
        `SELECT id, start_ms, target_id, dungeon_id FROM encounters
         WHERE room = ?1 AND mob_code = ?2 AND (?2 != 0 OR boss = ?4)
           AND (start_ms BETWEEN ?5 AND ?6
             OR (?8 != 0 AND target_id = ?8 AND start_ms <= ?9 AND start_ms + duration_ms >= ?7))
         ORDER BY (dungeon_id = ?3) DESC, ABS(start_ms - ?7) LIMIT 5`,
      )
      .bind(room, d.mobCode, d.dungeonId, d.boss, d.startMs - w, d.startMs + w, d.startMs, d.targetId, d.startMs + d.durationMs)
      .all<EncRow>()
  ).results;
  for (const e of rows) {
    const near = Math.abs(e.start_ms - d.startMs) <= LIMITS.sameFightWindowMs;
    const otherDungeon = e.dungeon_id !== d.dungeonId && e.dungeon_id !== 0 && d.dungeonId !== 0;
    const sameTarget = d.targetId !== 0 && e.target_id === d.targetId && !otherDungeon;
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
  /** Neue Bestwerte dieses Kampfs, die vorher noch nicht gemeldet waren */
  records: RecordHit[];
}

export interface RecordHit {
  name: string;
  kind: "dps" | "peak";
  value: number;
  prev: number;
}

/** Kürzere Kämpfe zählen nicht: ein paar Sekunden Burst ergäben sonst Fantasie-Schnitte. */
export const RECORD_MIN_MS = 20_000;

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
  const records = await newRecords(db, room, encounterId, merged, known);
  const removedUploads = await enforceRetention(db, room);
  return { uploadId, encounterId, replaced: !!existing, perspectives: merged.uploads.length, detail: merged, removedUploads, records };
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
  const peaks = peaksOf(d);
  const statRows = d.players.filter((p, i) => p.dmg > 0 && (i < LIMITS.statsTopPlayers || knownLc.has(p.name.toLowerCase())));

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO encounters (id, room, mob_code, target_id, boss, dungeon_id, start_ms, duration_ms, total_damage, max_hp,
           is_train, actor_count, uploaders, top, detail, updated_at, killed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(id) DO UPDATE SET mob_code = excluded.mob_code, target_id = excluded.target_id, boss = excluded.boss,
           dungeon_id = excluded.dungeon_id, start_ms = excluded.start_ms, duration_ms = excluded.duration_ms,
           total_damage = excluded.total_damage, max_hp = excluded.max_hp, is_train = excluded.is_train,
           actor_count = excluded.actor_count, uploaders = excluded.uploaders, top = excluded.top,
           detail = excluded.detail, updated_at = excluded.updated_at, killed = excluded.killed`,
      )
      .bind(
        encounterId, room, s.mobCode, s.targetId, s.boss, s.dungeonId, s.startMs, s.durationMs, s.totalDamage, s.maxHp,
        s.isTrain ? 1 : 0, s.actorCount, JSON.stringify(s.uploaders), JSON.stringify(s.top), await packJson(d), now,
        s.killed ? 1 : 0,
      ),
    db.prepare("DELETE FROM player_stats WHERE encounter_id = ?1").bind(encounterId),
  ];
  if (!s.isTrain) stmts.push(upsertBoss(db, room, s.mobCode, s.boss, s.maxHp));
  for (const p of statRows) {
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO player_stats (encounter_id, room, player, player_lc, job, job_id, source, self_report, dps, dmg, share,
             crit_rate, back_rate, hits, heal, cp, mob_code, boss, dungeon_id, start_ms, duration_ms, is_train, peak_dps, front_rate, killed, gear_score)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)`,
        )
        .bind(
          encounterId, room, p.name, p.name.toLowerCase(), p.job, p.jobId, p.source, p.selfReport ? 1 : 0, p.dps, p.dmg, p.share,
          p.critRate, p.backRate, p.hits, p.heal, p.cp, s.mobCode, s.boss, s.dungeonId, s.startMs, s.durationMs, s.isTrain ? 1 : 0,
          peaks.get(p.name.toLowerCase()) ?? p.dps,
          frontRateOf(p),
          s.killed ? 1 : 0,
          p.gs ?? 0,
        ),
    );
  }
  await db.batch(stmts); // atomar
  return d;
}

/**
 * Neue Bestwerte unserer Mitglieder in diesem Kampf: Schnitt und Peak gegen alle anderen Kämpfe
 * desselben Bosses in derselben Instanz (ohne Training, ab RECORD_MIN_MS). Der erste Kampf gegen
 * einen Boss ist kein Rekord. Jeder Rekord wird einmal gespeichert; geliefert werden nur die
 * neu gespeicherten, damit ein zweiter Upload desselben Kampfs ihn nicht nochmal meldet.
 */
async function newRecords(db: D1Database, room: string, encounterId: string, d: EncounterDetail, known: string[]): Promise<RecordHit[]> {
  const s = d.summary;
  if (s.isTrain || s.durationMs < RECORD_MIN_MS) return [];
  if (await isHidden(db, room, s.mobCode)) return []; // Quest-Miniboss o. ä.: kein Rekord-Banner
  const knownLc = new Set(known.map((n) => n.toLowerCase()));
  const peaks = peaksOf(d);
  const out: RecordHit[] = [];
  for (const p of d.players) {
    const lc = p.name.toLowerCase();
    if (!knownLc.has(lc) || p.dmg <= 0) continue;
    const before = await db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(dps) AS dps, MAX(peak_dps) AS peak FROM player_stats
         WHERE room = ?1 AND player_lc = ?2 AND mob_code = ?3 AND dungeon_id = ?4 AND is_train = 0
           AND duration_ms >= ?5 AND encounter_id != ?6`,
      )
      .bind(room, lc, s.mobCode, s.dungeonId, RECORD_MIN_MS, encounterId)
      .first<{ n: number; dps: number | null; peak: number | null }>();
    if (!before?.n) continue;
    const candidates: [RecordHit["kind"], number | null, number | null][] = [
      ["dps", p.dps, before.dps],
      ["peak", peaks.get(lc) ?? null, before.peak],
    ];
    for (const [kind, value, prev] of candidates) {
      if (value === null || prev === null || !(value > prev)) continue;
      const res = await db
        .prepare(
          `INSERT INTO records (encounter_id, room, player, player_lc, kind, value, prev, mob_code, boss, dungeon_id, start_ms)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT DO NOTHING`,
        )
        .bind(encounterId, room, p.name, lc, kind, value, prev, s.mobCode, s.boss, s.dungeonId, s.startMs)
        .run();
      if (res.meta.changes) out.push({ name: p.name, kind, value, prev });
    }
  }
  return out;
}

/** Peak-DPS je Spieler (klein geschrieben) aus dem Zeitverlauf; ohne Verlauf oder bei kurzen Kämpfen fehlt er. */
function peaksOf(d: EncounterDetail): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of d.timeline?.series ?? []) {
    const peak = peakDps(s.dmg, s.bucketMs);
    if (peak !== null) out.set(s.name.toLowerCase(), peak);
  }
  return out;
}

const MISSING = "(peak_dps IS NULL OR front_rate IS NULL OR gear_score IS NULL)";

/**
 * Peak-DPS und Frontal-Quote für Kämpfe von vor ihrer Einführung nachtragen (aus dem gespeicherten
 * Detail, ohne neu zusammenzuführen). Höchstens `limit` Kämpfe pro Aufruf; liefert, wie viele noch fehlen.
 */
export async function backfillStats(db: D1Database, room: string, limit = 100): Promise<{ updated: number; remaining: number }> {
  const ids = (
    await db
      .prepare(`SELECT DISTINCT encounter_id AS id FROM player_stats WHERE room = ?1 AND ${MISSING} LIMIT ?2`)
      .bind(room, limit)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
  for (const id of ids) {
    const row = await db.prepare("SELECT detail FROM encounters WHERE id = ?1").bind(id).first<{ detail: string }>();
    const d = row ? await unpackJson<EncounterDetail>(row.detail) : null;
    const peaks = d ? peaksOf(d) : new Map<string, number>();
    const set =
      "UPDATE player_stats SET peak_dps = COALESCE(peak_dps, ?1), front_rate = COALESCE(front_rate, ?2), gear_score = COALESCE(gear_score, ?5) WHERE encounter_id = ?3 AND player_lc = ?4";
    const stmts = (d?.players ?? []).map((p) =>
      db.prepare(set).bind(peaks.get(p.name.toLowerCase()) ?? null, frontRateOf(p), id, p.name.toLowerCase(), p.gs ?? 0),
    );
    // Rest (kurze Kämpfe, kein Verlauf, Spieler nicht im Detail): Peak = Kampfschnitt, Frontal unbekannt = 0
    stmts.push(
      db
        .prepare("UPDATE player_stats SET peak_dps = COALESCE(peak_dps, dps), front_rate = COALESCE(front_rate, 0), gear_score = COALESCE(gear_score, 0) WHERE encounter_id = ?1")
        .bind(id),
    );
    await db.batch(stmts);
  }
  const left = await db
    .prepare(`SELECT COUNT(DISTINCT encounter_id) AS n FROM player_stats WHERE room = ?1 AND ${MISSING}`)
    .bind(room)
    .first<{ n: number }>();
  return { updated: ids.length, remaining: left?.n ?? 0 };
}

/**
 * Kaempfe zusammenlegen, die findEncounter frueher getrennt hat: derselbe Boss
 * mit Start hoechstens sameFightWindowMs auseinander, aber verschiedenen
 * Dungeon-IDs, oder dieselbe Entity mit sich ueberschneidenden Kampfzeiten
 * (ohne zwei verschiedene bekannte Dungeons). Nie bei gemeinsamem Uploader. Die Uploads ziehen in den frueheren Kampf um, der neu
 * zusammengefuehrt wird; der andere wird geloescht. Rohdaten haengen an der
 * Upload-ID und bleiben, wo sie sind.
 */
export async function mergeDuplicates(db: D1Database, room: string, known: string[], now = Date.now()): Promise<{ merged: number }> {
  const pairs = (
    await db
      .prepare(
        `SELECT a.id AS keepId, b.id AS dropId FROM encounters a JOIN encounters b
           ON b.room = a.room AND b.mob_code = a.mob_code AND (a.mob_code != 0 OR b.boss = a.boss)
          AND (b.start_ms > a.start_ms OR (b.start_ms = a.start_ms AND b.id > a.id))
          AND ((b.dungeon_id != a.dungeon_id AND b.start_ms - a.start_ms <= ?2)
            OR (a.target_id != 0 AND b.target_id = a.target_id AND b.start_ms <= a.start_ms + a.duration_ms
                AND (a.dungeon_id = b.dungeon_id OR a.dungeon_id = 0 OR b.dungeon_id = 0)))
         WHERE a.room = ?1 ORDER BY a.start_ms`,
      )
      .bind(room, LIMITS.sameFightWindowMs)
      .all<{ keepId: string; dropId: string }>()
  ).results;
  const gone = new Set<string>();
  let merged = 0;
  for (const { keepId: keep, dropId: drop } of pairs) {
    if (gone.has(keep) || gone.has(drop)) continue;
    // Derselbe Uploader in beiden: zwei Pulls, kein Duplikat
    const shared = await db
      .prepare(
        `SELECT 1 AS x FROM uploads a JOIN uploads b ON lower(a.uploader) = lower(b.uploader)
         WHERE a.encounter_id = ?1 AND b.encounter_id = ?2 LIMIT 1`,
      )
      .bind(keep, drop)
      .first();
    if (shared) continue;
    await db.batch([
      db.prepare("UPDATE uploads SET encounter_id = ?1 WHERE encounter_id = ?2").bind(keep, drop),
      db.prepare("DELETE FROM player_stats WHERE encounter_id = ?1").bind(drop),
      db.prepare("DELETE FROM records WHERE encounter_id = ?1").bind(drop),
      db.prepare("DELETE FROM encounters WHERE id = ?1").bind(drop),
    ]);
    await remerge(db, room, keep, known, now);
    gone.add(drop);
    merged++;
  }
  return { merged };
}

/** Kaempfe, in denen `name` hochgeladen hat. */
async function encountersOf(db: D1Database, room: string, name: string): Promise<string[]> {
  return (
    await db
      .prepare("SELECT DISTINCT encounter_id AS id FROM uploads WHERE room = ?1 AND lower(uploader) = ?2")
      .bind(room, name.toLowerCase())
      .all<{ id: string }>()
  ).results.map((r) => r.id);
}

/**
 * Uploads von `from` gehoeren `to`: ein Meter, das sich falsch benannt hatte
 * (eine Zeitlang las es Datenmuell als seinen Namen). Die Kaempfe werden neu
 * zusammengefuehrt, `from` ist danach kein Mitglied mehr.
 */
export async function reassignUploads(db: D1Database, room: string, from: string, to: string, known: string[], now = Date.now()) {
  const encounters = await encountersOf(db, room, from);
  await db.batch([
    db.prepare("UPDATE uploads SET uploader = ?1 WHERE room = ?2 AND lower(uploader) = ?3").bind(to, room, from.toLowerCase()),
    db.prepare("DELETE FROM members WHERE room = ?1 AND name_lc = ?2").bind(room, from.toLowerCase()),
  ]);
  await registerMember(db, room, to, now, false);
  for (const id of encounters) await remerge(db, room, id, known, now);
  return { fights: encounters.length };
}

/**
 * Entfernt einen Namen ganz: Mitglied, Statistik, Rekorde und seine Uploads.
 * Kaempfe mit weiteren Perspektiven werden ohne ihn neu zusammengefuehrt,
 * Kaempfe nur aus seinen Uploads geloescht. Liefert die Upload-IDs (fuer die
 * Rohdaten im DO).
 */
export async function removeMember(db: D1Database, room: string, name: string, known: string[], now = Date.now()) {
  const lc = name.toLowerCase();
  const encounters = await encountersOf(db, room, name);
  const uploads = (
    await db.prepare("SELECT id FROM uploads WHERE room = ?1 AND lower(uploader) = ?2").bind(room, lc).all<{ id: string }>()
  ).results.map((r) => r.id);
  await db.batch([
    db.prepare("DELETE FROM uploads WHERE room = ?1 AND lower(uploader) = ?2").bind(room, lc),
    db.prepare("DELETE FROM player_stats WHERE room = ?1 AND player_lc = ?2").bind(room, lc),
    db.prepare("DELETE FROM records WHERE room = ?1 AND player_lc = ?2").bind(room, lc),
    db.prepare("DELETE FROM members WHERE room = ?1 AND name_lc = ?2").bind(room, lc),
  ]);
  let deleted = 0;
  for (const id of encounters) {
    const left = await db.prepare("SELECT 1 AS x FROM uploads WHERE encounter_id = ?1 LIMIT 1").bind(id).first();
    if (left) await remerge(db, room, id, known, now);
    else {
      await deleteEncounter(db, id);
      deleted++;
    }
  }
  return { uploads, fights: encounters.length, deletedFights: deleted };
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
    db.prepare("DELETE FROM records WHERE encounter_id = ?1").bind(encounterId),
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

