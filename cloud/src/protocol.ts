// Protokoll-Konstanten, Typen und Normalisierung der Client-Nachrichten.
// Die Doku dazu steht in PROTOCOL.md – bei Aenderungen beides anpassen.

export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** Groesste akzeptierte WebSocket-Nachricht (Bytes, UTF-16-Laenge als Naeherung). */
  maxMessageBytes: 16 * 1024,
  /** Mindestabstand zwischen zwei Snapshots desselben Clients (Server verwirft schnellere). */
  minSnapIntervalMs: 900,
  /** Empfohlenes Sendeintervall fuer die App. */
  snapIntervalMs: 1000,
  /** Gruppenansicht wird hoechstens so oft verschickt. */
  broadcastMinMs: 500,
  /** Spieler pro Snapshot (Rest wird verworfen, sortiert nach Schaden). */
  maxPlayersPerSnap: 24,
  /** App-Clients / Dashboard-Viewer pro Raum. */
  maxApps: 8,
  maxViewers: 20,
  /** Unangemeldete Sockets werden nach dieser Zeit geschlossen. */
  helloTimeoutMs: 10_000,
  /** Live-Snapshots verfallen nach dieser Zeit (keine dauerhafte Speicherung). */
  liveTtlMs: 2 * 60 * 60 * 1000,
  /** Snapshots aelter als das zaehlen nicht mehr als laufender Kampf. */
  activeMs: 15_000,
  /** Kaempfe, die in der Gruppenansicht noch gezeigt werden. */
  encounterTtlMs: 10 * 60 * 1000,
  maxEncounters: 4,
  /** Live-Zustand wird hoechstens so oft in SQLite gesichert (ueberlebt Hibernation). */
  persistEveryMs: 5_000,
  /** Kampf-Upload. */
  maxUploadBytes: 8 * 1024 * 1024, // komprimiert bzw. roh, wie uebertragen
  maxRecordBytes: 32 * 1024 * 1024, // nach dem Entpacken
  /** Kaempfe (zusammengefuehrt) pro Raum in D1 */
  maxEncountersPerRoom: 5000,
  /** Original-FightRecords (gzip) pro Raum im Durable Object */
  maxRawPerRoom: 400,
  /** Automatischer Upload: 3 Spieler x viele Bosse – grosszuegig, aber begrenzt */
  maxUploadsPerHour: 300,
  /** Gleicher Kampf, wenn Start so nah beieinander liegt (verschiedene Uploader) */
  sameFightWindowMs: 45_000,
  /** ... oder gleiche Ziel-Entity innerhalb dieses Fensters */
  sameTargetWindowMs: 10 * 60_000,
  /** Zeilen pro Kampf in player_stats: Mitglieder + Top N */
  statsTopPlayers: 20,
} as const;

export type Role = "app" | "viewer";

export interface SnapPlayer {
  id: number;
  name: string;
  job: string;
  dps: number;
  dmg: number;
  share: number;
  cp: number;
  self: boolean;
}

export interface SnapTarget {
  id: number;
  name: string;
  mode: string;
  maxHp: number;
  hp: number; // -1 = unbekannt
  dealt: number;
}

/** Normalisierter Snapshot, wie der Relay ihn haelt. */
export interface Snap {
  clientId: string;
  name: string;
  seq: number;
  ts: number; // Empfangszeit (Server)
  battleTime: number;
  dungeonId: number;
  target: SnapTarget;
  players: SnapPlayer[];
}

// ---------- Validierung ----------

export const ROOM_CODE_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Anzeigename: Steuerzeichen raus, trimmen, kuerzen. */
export function cleanName(v: unknown, max = 24): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
}

export function num(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

function int(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.round(num(v, min, max));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Wandelt eine eingehende `snap`-Nachricht in einen sauberen Snapshot.
 * Unbekannte Felder werden ignoriert, Zahlen geklemmt, Spieler gekuerzt.
 */
export function normalizeSnap(msg: any, clientId: string, name: string, now: number): Snap {
  const t = msg && typeof msg.target === "object" && msg.target ? msg.target : {};
  const rawPlayers: any[] = Array.isArray(msg?.players) ? msg.players.slice(0, 200) : [];
  const players: SnapPlayer[] = rawPlayers
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: int(p.id, -2147483648, 2147483647),
      name: cleanName(p.name) || "?",
      job: cleanName(p.job, 32),
      dps: round1(num(p.dps, 0, 1e12)),
      dmg: int(p.dmg, 0, 1e15),
      share: round1(num(p.share, 0, 100)),
      cp: int(p.cp, 0, 1e12),
      self: p.self === true,
    }))
    .sort((a, b) => b.dmg - a.dmg)
    .slice(0, LIMITS.maxPlayersPerSnap);

  return {
    clientId,
    name,
    seq: int(msg?.seq),
    ts: now,
    battleTime: int(msg?.battleTime, 0, 1e9),
    dungeonId: int(msg?.dungeonId, 0, 2147483647),
    target: {
      id: int(t.id, -2147483648, 2147483647),
      name: cleanName(t.name, 64),
      mode: cleanName(t.mode, 24),
      maxHp: int(t.maxHp, 0, 1e15),
      hp: t.hp === undefined || t.hp === null ? -1 : int(t.hp, -1, 1e15),
      dealt: int(t.dealt, 0, 1e15),
    },
    players,
  };
}
