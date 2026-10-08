// Fuehrt die Live-Snapshots aller Mitglieder zu einer Gruppenansicht zusammen.
// Reine Funktion, damit sie leicht testbar bleibt.

import { LIMITS, Snap } from "./protocol";

export interface MemberView {
  /** Kurzer Schlüssel je Verbindung. Nicht die clientId: wer sie kennt,
   *  kann sich per hello als dieser Client ausgeben und ihn verdrängen. */
  key: string;
  name: string;
  online: boolean;
  /** "fighting" (Snapshot < 15 s), "idle" (verbunden, nichts Neues), "offline" */
  state: "fighting" | "idle" | "offline";
  updatedAt: number;
  target: string;
  encounter: string | null;
  battleTime: number;
  dps: number;
  dmg: number;
}

export interface MergedPlayer {
  name: string;
  job: string;
  dps: number;
  dmg: number;
  share: number;
  cp: number;
  member: boolean;
  /** Name des Mitglieds, dessen Meter diesen Wert geliefert hat */
  src: string;
}

export interface EncounterView {
  key: string;
  active: boolean;
  target: { id: number; name: string; mode: string; maxHp: number; hp: number };
  battleTime: number;
  dungeonId: number;
  dealt: number;
  updatedAt: number;
  reporters: string[];
  /** Mitglieder und Mitspieler im Kampf (`member: false`), nach Schaden */
  players: MergedPlayer[];
  /** Rest ohne eigene Zeile (über dem Limit oder keinem Spieler zugeordnet) */
  others: { count: number; dmg: number; share: number };
}

export interface GroupView {
  t: "group";
  ts: number;
  members: MemberView[];
  encounters: EncounterView[];
}

export interface OnlineApp {
  clientId: string;
  name: string;
}

/** Nicht umkehrbarer Kurzschlüssel einer clientId (FNV-1a, 32 Bit). */
export function clientTag(clientId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < clientId.length; i++) h = Math.imul(h ^ clientId.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function encounterKey(s: Snap): string {
  if (!s.target.name) return `c|${clientTag(s.clientId)}`; // "Alle Ziele"-Modus o. ae.: pro Melder
  return `${s.target.id}|${s.target.name}`;
}

function selfEntry(s: Snap) {
  return s.players.find((p) => p.self) ?? s.players.find((p) => p.name.toLowerCase() === s.name.toLowerCase());
}

/**
 * @param isMember  Gehört ein Name (klein geschrieben) zur Gruppe? Ohne Angabe: jeder
 *                  Melder (App-Name) gilt als Mitglied. Ein Kampf erscheint nur mit einem
 *                  Mitglied darin; Mitspieler stehen dort mit `member: false`.
 */
export function buildGroupView(
  snaps: Iterable<Snap>,
  online0: OnlineApp[],
  now: number,
  isMember?: (lcName: string) => boolean,
): GroupView {
  const all0 = [...snaps].filter((s) => now - s.ts <= LIMITS.liveTtlMs);
  const memberNames = new Set<string>();
  for (const s of all0) memberNames.add(s.name.toLowerCase());
  for (const o of online0) memberNames.add(o.name.toLowerCase());
  const member = isMember ?? ((n: string) => memberNames.has(n));
  const all = all0.filter((s) => member(s.name.toLowerCase()));
  const online = online0.filter((o) => member(o.name.toLowerCase()));

  // ---- Kaempfe gruppieren ----
  const groups = new Map<string, Snap[]>();
  for (const s of all) {
    if (now - s.ts > LIMITS.encounterTtlMs || s.players.length === 0) continue;
    const k = encounterKey(s);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }

  const encounters: EncounterView[] = [];
  for (const [key, list] of groups) {
    const newest = list.reduce((a, b) => (b.ts > a.ts ? b : a));
    const dealt = Math.max(...list.map((s) => s.target.dealt));
    const hps = list.map((s) => s.target.hp).filter((h) => h >= 0);
    const players = new Map<string, MergedPlayer>();
    for (const s of list) {
      for (const p of s.players) {
        const k = p.name.toLowerCase();
        const prev = players.get(k);
        // Schaden waechst monoton → hoechster gemeldeter Wert ist der aktuellste.
        // Gleichstand: Eigenmeldung gewinnt.
        if (!prev || p.dmg > prev.dmg || (p.dmg === prev.dmg && p.self)) {
          players.set(k, {
            name: p.name,
            job: p.job || prev?.job || "",
            dps: p.dps,
            dmg: p.dmg,
            share: 0,
            cp: p.cp || prev?.cp || 0,
            member: member(k),
            src: s.name,
          });
        } else if (!prev.cp && p.cp) {
          prev.cp = p.cp;
        }
      }
    }
    const merged = [...players.values()].sort((a, b) => b.dmg - a.dmg);
    const total = Math.max(dealt, merged.reduce((sum, p) => sum + p.dmg, 0));
    const pct = (d: number) => (total > 0 ? Math.round((d / total) * 1000) / 10 : 0);
    for (const p of merged) p.share = pct(p.dmg);
    const mine = merged.filter((p) => p.member);
    if (!mine.length) continue;
    const shown = merged.slice(0, LIMITS.maxPlayersPerSnap);
    const othersDmg = Math.max(0, total - shown.reduce((sum, p) => sum + p.dmg, 0));

    encounters.push({
      key,
      active: now - newest.ts <= LIMITS.activeMs,
      target: {
        id: newest.target.id,
        name: newest.target.name,
        mode: newest.target.mode,
        maxHp: Math.max(...list.map((s) => s.target.maxHp)),
        hp: hps.length ? Math.min(...hps) : -1,
      },
      battleTime: Math.max(...list.map((s) => s.battleTime)),
      dungeonId: newest.dungeonId,
      dealt: total,
      updatedAt: newest.ts,
      reporters: [...new Set(list.map((s) => s.name))],
      players: shown,
      others: { count: merged.length - shown.length, dmg: othersDmg, share: pct(othersDmg) },
    });
  }
  encounters.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.reporters.length - a.reporters.length ||
      b.updatedAt - a.updatedAt,
  );

  // ---- Mitglieder ----
  const members = new Map<string, MemberView>();
  const onlineIds = new Set(online.map((o) => o.clientId));
  for (const s of all) {
    const me = selfEntry(s);
    const fighting = now - s.ts <= LIMITS.activeMs && s.players.length > 0;
    members.set(s.clientId, {
      key: clientTag(s.clientId),
      name: s.name,
      online: onlineIds.has(s.clientId),
      state: !onlineIds.has(s.clientId) ? "offline" : fighting ? "fighting" : "idle",
      updatedAt: s.ts,
      target: s.target.name,
      encounter: s.players.length && now - s.ts <= LIMITS.encounterTtlMs ? encounterKey(s) : null,
      battleTime: s.battleTime,
      dps: me?.dps ?? 0,
      dmg: me?.dmg ?? 0,
    });
  }
  for (const o of online) {
    const m = members.get(o.clientId);
    if (m) m.name = o.name;
    else
      members.set(o.clientId, {
        key: clientTag(o.clientId),
        name: o.name,
        online: true,
        state: "idle",
        updatedAt: 0,
        target: "",
        encounter: null,
        battleTime: 0,
        dps: 0,
        dmg: 0,
      });
  }

  return {
    t: "group",
    ts: now,
    members: [...members.values()].sort(
      (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
    ),
    encounters: encounters.slice(0, LIMITS.maxEncounters),
  };
}
