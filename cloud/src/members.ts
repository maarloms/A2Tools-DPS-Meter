// Wer zählt zur Gruppe?
//
// Standard: jeder Name, der sich per App anmeldet (hello) oder einen Kampf hochlädt,
// wird Mitglied. Testnamen/Tippfehler lassen sich im Dashboard ausblenden
// (members.hidden = 1, Daten bleiben erhalten).
//
// Optional streng: Worker-Variable ROOM_MEMBERS = "raum:Name1|Name2|Name3,raum2:…".
// Ist für einen Raum eine Liste gesetzt, zählen NUR diese Namen (Groß-/Kleinschreibung egal),
// und die Verwaltung im Dashboard ist schreibgeschützt.

import { Env } from "./auth";

let cachedRaw: string | undefined;
let cachedFixed = new Map<string, string[]>();

export function fixedMembers(env: Env, room: string): string[] | null {
  const raw = env.ROOM_MEMBERS ?? "";
  if (raw !== cachedRaw) {
    const map = new Map<string, string[]>();
    for (const entry of raw.split(/[,;\n]/)) {
      const i = entry.indexOf(":");
      if (i < 1) continue;
      const names = entry
        .slice(i + 1)
        .split("|")
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length) map.set(entry.slice(0, i).trim().toLowerCase(), names);
    }
    cachedRaw = raw;
    cachedFixed = map;
  }
  return cachedFixed.get(room) ?? null;
}

/** Namen der Mitglieder, die in Statistiken/Ansichten zählen. */
export async function activeMembers(db: D1Database, env: Env, room: string): Promise<string[]> {
  const fixed = fixedMembers(env, room);
  if (fixed) {
    // Schreibweise aus der App übernehmen, falls bekannt
    const rows = (await db.prepare("SELECT name_lc, name FROM members WHERE room = ?1").bind(room).all<{ name_lc: string; name: string }>()).results;
    const seen = new Map(rows.map((r) => [r.name_lc, r.name]));
    return fixed.map((n) => seen.get(n.toLowerCase()) ?? n);
  }
  const r = await db
    .prepare("SELECT name FROM members WHERE room = ?1 AND hidden = 0 ORDER BY name_lc LIMIT 50")
    .bind(room)
    .all<{ name: string }>();
  return r.results.map((x) => x.name);
}

export function isAllowed(env: Env, room: string, name: string): boolean {
  const fixed = fixedMembers(env, room);
  return !fixed || fixed.some((n) => n.toLowerCase() === name.toLowerCase());
}

/** Für die Verwaltung im Dashboard: alle bekannten Namen + Status */
export async function listMembers(db: D1Database, env: Env, room: string) {
  const fixed = fixedMembers(env, room);
  const rows = (
    await db
      .prepare(
        `SELECT m.name, m.name_lc AS nameLc, m.last_seen AS lastSeen, m.hidden,
           (SELECT COUNT(*) FROM player_stats ps WHERE ps.room = m.room AND ps.player_lc = m.name_lc AND ps.is_train = 0) AS fights
         FROM members m WHERE m.room = ?1 ORDER BY m.name_lc`,
      )
      .bind(room)
      .all<{ name: string; nameLc: string; lastSeen: number; hidden: number; fights: number }>()
  ).results;
  const fixedLc = fixed ? new Set(fixed.map((n) => n.toLowerCase())) : null;
  const list = rows.map((r) => ({
    name: r.name,
    lastSeen: r.lastSeen,
    fights: r.fights,
    active: fixedLc ? fixedLc.has(r.nameLc) : !r.hidden,
  }));
  if (fixed) for (const n of fixed) if (!rows.some((r) => r.nameLc === n.toLowerCase())) list.push({ name: n, lastSeen: 0, fights: 0, active: true });
  return { fixed: !!fixed, members: list };
}

export async function setHidden(db: D1Database, room: string, name: string, hidden: boolean): Promise<boolean> {
  const r = await db
    .prepare("UPDATE members SET hidden = ?1 WHERE room = ?2 AND name_lc = ?3")
    .bind(hidden ? 1 : 0, room, name.toLowerCase())
    .run();
  return (r.meta.changes ?? 0) > 0;
}
