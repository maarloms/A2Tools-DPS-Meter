// Welche Bosse zählen in Kampfliste, Übersicht, Vergleich, Bestenliste und Rekorden?
//
// Automatisch: Bosse ab MIN_HP (Dungeon-Bosse, Feld-, Welt- und Event-Bosse). Darunter liegen
// Quest-Minibosse (meist 0,9M HP, solo) und Lowlevel-Dungeons. Maßgeblich ist die höchste je
// gesehene Max-HP des Bosses, nicht die eines einzelnen Kampfs. Im Dashboard lässt sich jeder Boss
// fest ein- oder ausblenden (bosses.mode). Gelöscht wird nichts.
//
// Feldbosse (ab FIELD_ACTORS Akteuren) bleiben in der Kampfliste, zählen aber nicht in der
// Statistik (Vergleich, Bestenliste, Rekorde, Peak): Jedes Meter sieht dort nur einen Bruchteil
// des Schadens. "show" im Dashboard nimmt einen Feldboss trotzdem in die Statistik.

/** Ab dieser Max-HP zählt ein Boss automatisch (Puffer unter den kleinsten Dungeon-Bossen mit ~5,2M). */
export const MIN_HP = 4_000_000;

/** Ab so vielen Akteuren in einem Kampf gilt ein Boss als Feldboss (Instanzen: höchstens ~70). */
export const FIELD_ACTORS = 100;

export type BossMode = "show" | "hide" | null;

/** SQL: Boss ist ausgeblendet (b = Zeile aus bosses) */
const HIDDEN = `(b.mode = 'hide' OR (b.mode IS NULL AND b.max_hp < ${MIN_HP}))`;
/** SQL: Feldboss ohne Vorgabe (b = Zeile aus bosses) */
const FIELD = `(b.mode IS NULL AND b.max_actors >= ${FIELD_ACTORS})`;

/**
 * SQL-Bedingung "Boss zählt" für eine Tabelle mit room und mob_code (player_stats, encounters, records).
 * Unbekannte Bosse (noch keine Zeile in bosses) zählen.
 */
export const relevant = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM bosses b WHERE b.room = ${alias}.room AND b.mob_code = ${alias}.mob_code AND (${HIDDEN} OR ${FIELD}))`;

/** Wie relevant, aber Feldbosse zählen mit: für Kampflisten. */
export const listed = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM bosses b WHERE b.room = ${alias}.room AND b.mob_code = ${alias}.mob_code AND ${HIDDEN})`;

/** SQL-Ausdruck: 1, wenn der Kampf zu einem Feldboss gehört (nicht in der Statistik). */
export const isField = (alias: string) =>
  `EXISTS (SELECT 1 FROM bosses b WHERE b.room = ${alias}.room AND b.mob_code = ${alias}.mob_code AND ${FIELD})`;

/** Höchste Max-HP merken; den Namen vom neuesten Kampf übernehmen (Sprache der App kann wechseln). */
export function upsertBoss(db: D1Database, room: string, mobCode: number, boss: string, maxHp: number, actors: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO bosses (room, mob_code, boss, max_hp, max_actors) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(room, mob_code) DO UPDATE SET boss = excluded.boss, max_hp = MAX(bosses.max_hp, excluded.max_hp),
         max_actors = MAX(bosses.max_actors, excluded.max_actors)`,
    )
    .bind(room, mobCode, boss, maxHp, actors);
}

export async function isHidden(db: D1Database, room: string, mobCode: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM bosses b WHERE b.room = ?1 AND b.mob_code = ?2 AND (${HIDDEN} OR ${FIELD})`)
    .bind(room, mobCode)
    .first();
  return !!row;
}

/** Alle Bosse des Raums (ohne reine Trainingsziele) für die Verwaltung im Dashboard */
export async function listBosses(db: D1Database, room: string) {
  const rows = (
    await db
      .prepare(
        `SELECT b.mob_code AS mobCode, b.boss, b.max_hp AS maxHp, b.mode, (${HIDDEN}) AS hidden, (${FIELD}) AS field,
           COUNT(e.id) AS fights, MAX(e.start_ms) AS lastMs, MAX(e.actor_count) AS maxActors
         FROM bosses b JOIN encounters e ON e.room = b.room AND e.mob_code = b.mob_code AND e.is_train = 0
         WHERE b.room = ?1
         GROUP BY b.mob_code ORDER BY b.max_hp DESC`,
      )
      .bind(room)
      .all<{ mobCode: number; boss: string; maxHp: number; mode: BossMode; hidden: number; field: number; fights: number; lastMs: number; maxActors: number }>()
  ).results;
  return { minHp: MIN_HP, fieldActors: FIELD_ACTORS, bosses: rows.map((r) => ({ ...r, hidden: !!r.hidden, field: !!r.field })) };
}

export async function setBossMode(db: D1Database, room: string, mobCode: number, mode: BossMode): Promise<boolean> {
  const res = await db.prepare("UPDATE bosses SET mode = ?3 WHERE room = ?1 AND mob_code = ?2").bind(room, mobCode, mode).run();
  return res.meta.changes > 0;
}
