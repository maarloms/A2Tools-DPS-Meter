// Reset-Checkliste: was jeder Spieler (und seine Twinks) seit dem letzten Reset erledigt hat.
//
// Der Server kennt die Aufgaben nicht – die stehen im Dashboard (public/js/checklist.js).
// Gespeichert wird je Spieler/Charakter/Aufgabe ein Zähler samt Zeitraum-Kennung; das Dashboard
// wertet einen Stand aus einem früheren Zeitraum als 0. Abhaken darf jeder im Raum (wie Ausblenden
// von Bossen ohne Admin – es geht nur um die eigene Gruppe).

export const MAX_CHARS = 6;
const CHAR_ID_RE = /^[a-z0-9]{1,12}$/;
const TASK_RE = /^[a-z0-9-]{1,24}$/;
const PERIOD_RE = /^[a-z]\d{4}-\d{2}-\d{2}$/;

type Char = { id: string; name: string };

const DEFAULT_CHARS: Char[] = [{ id: "main", name: "Main" }];

function parseChars(raw: string | null | undefined): Char[] {
  try {
    const list = JSON.parse(raw ?? "");
    if (Array.isArray(list) && list.length) return list;
  } catch {
    /* kaputt → Standard */
  }
  return DEFAULT_CHARS;
}

export async function listChecklist(db: D1Database, room: string, members: string[]) {
  const [chars, items] = await Promise.all([
    db.prepare("SELECT player_lc, chars FROM checklist_chars WHERE room = ?1").bind(room).all<{ player_lc: string; chars: string }>(),
    db
      .prepare("SELECT player_lc, char_id, task, count, period, updated_ms FROM checklist_items WHERE room = ?1")
      .bind(room)
      .all<{ player_lc: string; char_id: string; task: string; count: number; period: string; updated_ms: number }>(),
  ]);
  const charsBy = new Map(chars.results.map((r) => [r.player_lc, parseChars(r.chars)]));
  return {
    maxChars: MAX_CHARS,
    players: members.map((player) => {
      const lc = player.toLowerCase();
      return {
        player,
        chars: charsBy.get(lc) ?? DEFAULT_CHARS,
        items: items.results
          .filter((r) => r.player_lc === lc)
          .map((r) => ({ char: r.char_id, task: r.task, count: r.count, period: r.period, updated: r.updated_ms })),
      };
    }),
  };
}

/** PATCH: entweder Charakterliste ({ player, chars }) oder ein Zähler ({ player, char, task, count, period }). */
export async function patchChecklist(db: D1Database, room: string, members: string[], body: unknown) {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.player !== "string") return { error: "bad_request" };
  const player = members.find((n) => n.toLowerCase() === (b.player as string).toLowerCase());
  if (!player) return { error: "unknown_player" };
  const lc = player.toLowerCase();
  const now = Date.now();

  if ("chars" in b) {
    const list = b.chars;
    if (!Array.isArray(list) || !list.length || list.length > MAX_CHARS) return { error: "bad_request" };
    const chars: Char[] = [];
    for (const c of list as Record<string, unknown>[]) {
      const name = typeof c?.name === "string" ? c.name.trim().slice(0, 24) : "";
      if (typeof c?.id !== "string" || !CHAR_ID_RE.test(c.id) || !name || chars.some((x) => x.id === c.id)) return { error: "bad_request" };
      chars.push({ id: c.id, name });
    }
    if (chars[0].id !== "main") return { error: "bad_request" };
    const ids = JSON.stringify(chars.map((c) => c.id));
    await db.batch([
      db
        .prepare(
          `INSERT INTO checklist_chars (room, player_lc, chars, updated_ms) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(room, player_lc) DO UPDATE SET chars = excluded.chars, updated_ms = excluded.updated_ms`,
        )
        .bind(room, lc, JSON.stringify(chars), now),
      // Stände entfernter Twinks gleich mit löschen
      db
        .prepare("DELETE FROM checklist_items WHERE room = ?1 AND player_lc = ?2 AND char_id NOT IN (SELECT value FROM json_each(?3))")
        .bind(room, lc, ids),
    ]);
    return { ok: true, chars };
  }

  const { char, task, count, period } = b;
  if (
    typeof char !== "string" || !CHAR_ID_RE.test(char) ||
    typeof task !== "string" || !TASK_RE.test(task) ||
    !Number.isInteger(count) || (count as number) < 0 || (count as number) > 99 ||
    typeof period !== "string" || !PERIOD_RE.test(period)
  ) {
    return { error: "bad_request" };
  }
  const row = await db.prepare("SELECT chars FROM checklist_chars WHERE room = ?1 AND player_lc = ?2").bind(room, lc).first<{ chars: string }>();
  if (!parseChars(row?.chars).some((c) => c.id === char)) return { error: "unknown_char" };
  await db
    .prepare(
      `INSERT INTO checklist_items (room, player_lc, char_id, task, count, period, updated_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(room, player_lc, char_id, task) DO UPDATE SET count = excluded.count, period = excluded.period, updated_ms = excluded.updated_ms`,
    )
    .bind(room, lc, char, task, count, period, now)
    .run();
  return { ok: true };
}
