// Abgeschlossene Kaempfe.
//  1. buildUpload(): FightRecord (AppData/history/*.json) → kompaktes Detail EINER Perspektive
//  2. mergeEncounter(): mehrere Uploads desselben Bosskampfs → ein zusammengefuehrter Kampf
// Das Original wird zusaetzlich gzip-komprimiert im Durable Object abgelegt.

import { cleanName, num } from "./protocol";

// ---------- Namen ----------

/** Wie fight_record.rs::obscure_nickname – damit maskierte Namen bekannter Mitglieder aufloesbar sind. */
export function obscureNickname(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return name;
  if (chars.length === 2) return `${chars[0]}*`;
  if (chars.length === 3) return `${chars[0]}*${chars[2]}`;
  const mask = "*".repeat(Math.min(chars.length - 3, 4));
  return `${chars[0]}${chars[1]}${mask}${chars[chars.length - 1]}`;
}

/** Ersetzt maskierte Namen ("Ma***n") durch bekannte Mitgliedsnamen, wenn eindeutig. */
export function unmasker(known: string[]): (name: string) => string {
  const byMask = new Map<string, string | null>();
  for (const n of known) {
    const m = obscureNickname(n);
    if (m === n) continue;
    const prev = byMask.get(m);
    byMask.set(m, prev !== undefined && prev !== null && prev.toLowerCase() !== n.toLowerCase() ? null : n);
  }
  return (name: string) => (name.includes("*") ? byMask.get(name) ?? name : name);
}

// ---------- Typen ----------

export interface SkillRow {
  code: number;
  name: string;
  dmg: number;
  hits: number;
  crit: number;
  back: number;
  perfect: number;
  double: number;
  frontal: number;
  parry: number;
  smite: number;
  powershard: number;
  multiHits: number;
  multiDmg: number;
  min: number;
  max: number;
  dot: boolean;
}

export interface HealRow {
  name: string;
  amount: number;
  ticks: number;
  hot: boolean;
}

export interface PlayerDetail {
  actorId: number;
  name: string;
  job: string;
  jobId: number;
  dmg: number;
  dps: number;
  share: number;
  cp: number;
  gs: number;
  level: number;
  heal: number;
  taken: number;
  hits: number;
  critRate: number;
  backRate: number;
  /** Anteil Frontal-Treffer; fehlt in Uploads von vor 2026-10-03 (dann frontRateOf) */
  frontRate?: number;
  perfectRate: number;
  doubleRate: number;
  skills: SkillRow[];
  heals: HealRow[];
}

/** [bucketIndex, Treffer] – nur belegte Buckets */
export type SparseHits = [number, number][];

export interface UploadDetail {
  v: 2;
  uploader: string;
  recordId: string;
  startMs: number;
  durationMs: number;
  boss: string;
  mobCode: number;
  targetId: number;
  dungeonId: number;
  totalDamage: number;
  maxHp: number;
  isTrain: boolean;
  /** Boss besiegt (App ab 3.0.4; ältere Uploads: fehlt = unbekannt) */
  killed?: boolean;
  appVersion: string;
  actorCount: number;
  players: PlayerDetail[];
  bucketMs: number;
  /** Schaden aller Akteure je Bucket (fuer die Boss-HP-Kurve) */
  total: number[];
  series: { name: string; dmg: number[] }[];
  lanes: { name: string; skills: { name: string; dot: boolean; hits: SparseHits }[] }[];
  /** [ms seit Kampfbeginn, Ping] */
  ping: [number, number][];
}

export interface TopEntry {
  name: string;
  job: string;
  jobId: number;
  dps: number;
  share: number;
}

export interface EncounterSummary {
  id: string;
  boss: string;
  mobCode: number;
  targetId: number;
  dungeonId: number;
  startMs: number;
  durationMs: number;
  totalDamage: number;
  maxHp: number;
  isTrain: boolean;
  /** Boss besiegt (App ab 3.0.4; ältere Uploads: fehlt = unbekannt) */
  killed?: boolean;
  actorCount: number;
  uploaders: string[];
  top: TopEntry[];
}

export interface MergedPlayer extends PlayerDetail {
  source: string;
  selfReport: boolean;
}

export interface TimedSeries {
  name: string;
  source: string;
  offsetMs: number;
  bucketMs: number;
  dmg: number[];
}

export interface EncounterDetail {
  v: number;
  summary: EncounterSummary;
  uploads: { id: string; uploader: string; startMs: number; durationMs: number; rawBytes: number }[];
  players: MergedPlayer[];
  timeline: {
    series: TimedSeries[];
    total: { source: string; offsetMs: number; bucketMs: number; dmg: number[] } | null;
    lanes: { name: string; source: string; offsetMs: number; bucketMs: number; skills: { name: string; dot: boolean; hits: SparseHits }[] }[];
  };
  ping: { uploader: string; offsetMs: number; points: [number, number][] }[];
}

const MAX_DETAIL_PLAYERS = 40;
const MAX_SKILLS_PER_PLAYER = 40;
const MAX_TIMELINE_PLAYERS = 10;
const MAX_LANE_SKILLS = 16;
const MAX_BUCKETS = 300;
const MAX_PING_POINTS = 150;

const r1 = (n: number) => Math.round(n * 10) / 10;
const i32 = (v: unknown) => num(v, -2147483648, 2147483647);

export class RecordError extends Error {}

/** Frontal-Quote; ältere Uploads ohne frontRate rechnen sie aus den (gekürzten) Skills nach. */
export function frontRateOf(p: { frontRate?: number; hits: number; skills: { hits: number; frontal?: number }[] }): number {
  if (typeof p.frontRate === "number") return p.frontRate;
  const hits = p.skills.reduce((a, k) => a + k.hits, 0);
  return hits > 0 ? r1((p.skills.reduce((a, k) => a + (k.frontal ?? 0), 0) / hits) * 100) : 0;
}

/** Fenster für den Peak-DPS (Burst) */
export const PEAK_WINDOW_MS = 10_000;

/**
 * Höchster Schnitt über PEAK_WINDOW_MS aus dem Schadensverlauf (Buckets à bucketMs).
 * null, wenn der Kampf kürzer als das Fenster ist – dann ist der Peak der Kampfschnitt.
 */
export function peakDps(dmg: number[], bucketMs: number): number | null {
  const k = Math.max(1, Math.round(PEAK_WINDOW_MS / Math.max(1, bucketMs)));
  if (dmg.length <= k) return null;
  let sum = 0;
  for (let i = 0; i < k; i++) sum += dmg[i];
  let best = sum;
  for (let i = k; i < dmg.length; i++) {
    sum += dmg[i] - dmg[i - k];
    if (sum > best) best = sum;
  }
  return r1(best / ((k * bucketMs) / 1000));
}

/** Prueft die Mindeststruktur eines FightRecord. */
export function assertRecord(r: any): void {
  if (!r || typeof r !== "object") throw new RecordError("Kein JSON-Objekt");
  if (typeof r.id !== "string" || !r.id || r.id.length > 128) throw new RecordError("Feld id fehlt");
  if (typeof r.startTimeMs !== "number" || typeof r.durationMs !== "number")
    throw new RecordError("startTimeMs/durationMs fehlen");
  if (!r.details || !Array.isArray(r.details.skills)) throw new RecordError("details.skills fehlt");
  if (!Array.isArray(r.actors)) throw new RecordError("actors fehlt");
}

// ---------- 1. Eine Perspektive ----------

export function buildUpload(r: any, uploader: string, known: string[]): UploadDetail {
  const durationMs = Math.max(1, num(r.durationMs, 0, 1e10));
  const seconds = Math.max(durationMs / 1000, 0.001);
  const totalDamage = num(r.details?.totalTargetDamage, 0, 1e15) || num(r.totalDamage, 0, 1e15);
  const unmask = unmasker([...known, uploader]);
  const knownLc = new Set([...known, uploader].map((n) => n.toLowerCase()));

  type Agg = { dmg: number; hits: number; crit: number; back: number; frontal: number; perfect: number; double: number; skills: SkillRow[]; heal: number; heals: HealRow[] };
  const agg = new Map<number, Agg>();
  const get = (id: number) => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = { dmg: 0, hits: 0, crit: 0, back: 0, frontal: 0, perfect: 0, double: 0, skills: [], heal: 0, heals: [] }));
    return a;
  };
  for (const s of r.details.skills as any[]) {
    if (!s || typeof s !== "object") continue;
    const a = get(i32(s.actorId));
    const row: SkillRow = {
      code: num(s.code, 0, 1e12),
      name: cleanName(s.name, 64),
      dmg: num(s.dmg, 0, 1e15),
      hits: num(s.time, 0, 1e9),
      crit: num(s.crit, 0, 1e9),
      back: num(s.back, 0, 1e9),
      perfect: num(s.perfect, 0, 1e9),
      double: num(s.double, 0, 1e9),
      frontal: num(s.frontal, 0, 1e9),
      parry: num(s.parry, 0, 1e9),
      smite: num(s.smite, 0, 1e9),
      powershard: num(s.powershard, 0, 1e9),
      multiHits: num(s.multiHitCount, 0, 1e9),
      multiDmg: num(s.multiHitDamage, 0, 1e15),
      min: num(s.minDmg, 0, 1e15),
      max: num(s.maxDmg, 0, 1e15),
      dot: s.isDot === true,
    };
    a.dmg += row.dmg;
    a.hits += row.hits;
    a.crit += row.crit;
    a.back += row.back;
    a.frontal += row.frontal;
    a.perfect += row.perfect;
    a.double += row.double;
    a.skills.push(row);
  }
  for (const s of (r.details.healSkills ?? []) as any[]) {
    if (!s || typeof s !== "object") continue;
    const a = get(i32(s.actorId));
    const amount = num(s.dmg, 0, 1e15);
    a.heal += amount;
    a.heals.push({ name: cleanName(s.name, 64), amount, ticks: num(s.time, 0, 1e9), hot: s.isDot === true });
  }

  const actorsById = new Map<number, any>();
  for (const a of r.actors as any[]) if (a && typeof a === "object") actorsById.set(i32(a.actorId), a);

  const all: PlayerDetail[] = [...agg.entries()]
    .filter(([, a]) => a.dmg > 0 || a.heal > 0)
    .map(([actorId, a]) => {
      const info = actorsById.get(actorId) ?? {};
      const pct = (n: number) => (a.hits > 0 ? r1((n / a.hits) * 100) : 0);
      return {
        actorId,
        name: unmask(cleanName(info.nickname) || String(actorId)),
        job: cleanName(info.job, 32),
        jobId: num(info.jobId, 0, 1000),
        dmg: a.dmg,
        dps: r1(a.dmg / seconds),
        share: totalDamage > 0 ? r1((a.dmg / totalDamage) * 100) : 0,
        cp: num(info.combatPower, 0, 1e12),
        gs: num(info.gearScore, 0, 1e9),
        level: num(info.level, 0, 1000),
        heal: a.heal,
        taken: num(info.damageReceived, 0, 1e15),
        hits: a.hits,
        critRate: pct(a.crit),
        backRate: pct(a.back),
        frontRate: pct(a.frontal),
        perfectRate: pct(a.perfect),
        doubleRate: pct(a.double),
        skills: a.skills.sort((x, y) => y.dmg - x.dmg).slice(0, MAX_SKILLS_PER_PLAYER),
        heals: a.heals.sort((x, y) => y.amount - x.amount).slice(0, 12),
      };
    })
    .sort((a, b) => b.dmg - a.dmg);

  // Top-Spieler + alle bekannten Mitglieder behalten
  const isKnown = (p: PlayerDetail) => knownLc.has(p.name.toLowerCase());
  const players = all.filter((p, i) => i < MAX_DETAIL_PLAYERS || isKnown(p));

  // Zeitverlauf: hitTimestamps sind ms seit Kampfbeginn; Schaden pro Treffer = dmg / Treffer.
  const bucketMs = Math.max(1000, Math.ceil(durationMs / MAX_BUCKETS / 1000) * 1000);
  const buckets = Math.max(1, Math.ceil(durationMs / bucketMs));
  const bucketOf = (t: unknown) => Math.min(buckets - 1, Math.max(0, Math.floor(num(t, 0, 1e10) / bucketMs)));
  const timelineIds = new Set(
    all.filter((p, i) => p.dmg > 0 && (i < MAX_TIMELINE_PLAYERS || isKnown(p))).map((p) => p.actorId),
  );
  const total = new Array(buckets).fill(0);
  const series = new Map<number, number[]>();
  const laneMap = new Map<number, Map<string, { name: string; dot: boolean; dmg: number; hits: number[] }>>();
  for (const id of timelineIds) series.set(id, new Array(buckets).fill(0));
  for (const s of r.details.skills as any[]) {
    const ts: unknown[] = Array.isArray(s?.hitTimestamps) ? s.hitTimestamps : [];
    if (ts.length === 0) continue;
    const actorId = i32(s.actorId);
    const per = num(s.dmg, 0, 1e15) / ts.length;
    const arr = series.get(actorId);
    let lane: { name: string; dot: boolean; dmg: number; hits: number[] } | undefined;
    if (arr) {
      let skills = laneMap.get(actorId);
      if (!skills) laneMap.set(actorId, (skills = new Map()));
      const name = cleanName(s.name, 64);
      const key = `${name}|${s.isDot === true}`;
      lane = skills.get(key);
      if (!lane) skills.set(key, (lane = { name, dot: s.isDot === true, dmg: 0, hits: new Array(buckets).fill(0) }));
      lane.dmg += num(s.dmg, 0, 1e15);
    }
    for (const t of ts) {
      const b = bucketOf(t);
      total[b] += per;
      if (arr) arr[b] += per;
      if (lane) lane.hits[b]++;
    }
  }
  const nameOf = (id: number) => all.find((p) => p.actorId === id)?.name ?? String(id);
  const lanes = [...laneMap.entries()].map(([id, skills]) => ({
    name: nameOf(id),
    skills: [...skills.values()]
      .sort((a, b) => b.dmg - a.dmg)
      .slice(0, MAX_LANE_SKILLS)
      .map((l) => ({
        name: l.name,
        dot: l.dot,
        hits: l.hits.flatMap((c, i) => (c ? [[i, c] as [number, number]] : [])),
      })),
  }));

  // Ping (falls vorhanden), ausgeduennt
  const start = num(r.startTimeMs, 0, 1e15);
  const rawPing: any[] = Array.isArray(r.details.pingHistory) ? r.details.pingHistory : [];
  const step = Math.max(1, Math.ceil(rawPing.length / MAX_PING_POINTS));
  const ping: [number, number][] = [];
  for (let i = 0; i < rawPing.length; i += step) {
    const p = rawPing[i];
    if (!p) continue;
    const t = num(p.tsMs, 0, 1e15) - start;
    if (t >= -60000 && t <= durationMs + 60000) ping.push([Math.round(t), num(p.pingMs, 0, 1e5)]);
  }

  return {
    v: 2,
    uploader,
    recordId: String(r.id).slice(0, 128),
    startMs: start,
    durationMs,
    boss: cleanName(r.bossName, 64) || "Unbekannt",
    mobCode: num(r.mobCode, 0, 1e12),
    targetId: i32(r.targetId),
    dungeonId: num(r.dungeonId, 0, 1e12),
    totalDamage,
    maxHp: num(r.details?.maxHp, 0, 1e15),
    isTrain: r.isTrain === true,
    killed: r.killed === true,
    appVersion: cleanName(r.appVersion, 32),
    actorCount: all.length,
    players,
    bucketMs,
    total: total.map(Math.round),
    series: [...series.entries()].map(([id, dmg]) => ({ name: nameOf(id), dmg: dmg.map(Math.round) })),
    lanes,
    ping,
  };
}

// ---------- 2. Zusammenfuehren ----------

/** Steigt, wenn sich die Zusammenfuehrung aendert; aeltere Kaempfe werden neu zusammengefuehrt. */
export const MERGE_VERSION = 3;

export interface StoredUpload {
  id: string;
  uploader: string;
  rawBytes: number;
  detail: UploadDetail;
}

/**
 * Fuehrt alle Perspektiven eines Kampfs zusammen.
 *
 * Basis ist die Perspektive mit dem meisten Bossschaden: ihre Spielerliste
 * zaehlt jeden genau einmal. Dieselbe Person heisst in den Uploads oft
 * verschieden (bei einem eine maskierte Entity-ID "53*9", beim anderen
 * "Su****1"), ein Abgleich ueber Namen allein zaehlte sie also doppelt. Aus
 * den anderen Perspektiven kommen deshalb nur benannte Mitglieder: ihre
 * eigene Messung ersetzt ihren Eintrag in der Basis, gefunden ueber den Namen
 * oder, wenn die Basis sie nicht benennt, ueber gleiche Klasse und aehnlichen
 * Schaden. Alle anderen Zeilen der weiteren Perspektiven fallen weg.
 */
export function mergeEncounter(id: string, uploads: StoredUpload[], known: string[]): EncounterDetail {
  const unmask = unmasker([...known, ...uploads.map((u) => u.uploader)]);
  const knownLc = new Set([...known, ...uploads.map((u) => u.uploader)].map((n) => n.toLowerCase()));
  const startMs = Math.min(...uploads.map((u) => u.detail.startMs));
  const durationMs = Math.max(...uploads.map((u) => u.detail.startMs + u.detail.durationMs)) - startMs;
  const best = uploads.reduce((a, b) => (b.detail.totalDamage > a.detail.totalDamage ? b : a));
  const totalDamage = best.detail.totalDamage;

  const isKnownName = (lc: string) => knownLc.has(lc);
  const chosen = new Map<string, MergedPlayer>();
  const baseLc = best.uploader.toLowerCase();
  for (const p0 of best.detail.players) {
    const name = unmask(p0.name);
    const key = name.toLowerCase();
    if (!chosen.has(key)) chosen.set(key, { ...p0, name, source: best.uploader, selfReport: key === baseLc });
  }
  for (const u of uploads) {
    if (u === best) continue;
    const upLc = u.uploader.toLowerCase();
    for (const p0 of u.detail.players) {
      const name = unmask(p0.name);
      const key = name.toLowerCase();
      if (!isKnownName(key)) continue;
      const self = key === upLc;
      const entry: MergedPlayer = { ...p0, name, source: u.uploader, selfReport: self };
      const prev = chosen.get(key);
      if (prev) {
        if ((self && !prev.selfReport) || (!prev.selfReport && p0.dmg > prev.dmg)) chosen.set(key, entry);
        continue;
      }
      // Die Basis kennt den Namen nicht: das Mitglied steht dort unter einem
      // Alias. Gleiche Klasse, Schaden hoechstens 25 % daneben, naechster Treffer.
      let alias: string | null = null;
      let bestDiff = Infinity;
      for (const [k, q] of chosen) {
        if (isKnownName(k) || q.job !== p0.job || !q.dmg || !p0.dmg) continue;
        const diff = Math.abs(q.dmg - p0.dmg) / Math.max(q.dmg, p0.dmg);
        if (diff <= 0.25 && diff < bestDiff) { bestDiff = diff; alias = k; }
      }
      if (alias) chosen.delete(alias);
      chosen.set(key, entry);
    }
  }
  for (const p of chosen.values()) p.share = totalDamage > 0 ? r1((p.dmg / totalDamage) * 100) : 0;
  // Entities, die das Meter nie benennen konnte (maskierte IDs wie "49**1"),
  // sind mit Kleinstanteil fast immer Beschwoerungen (Geister, Totems); ohne
  // Schaden und Klasse sind es Heil-Ticks ohne Spieler. Beides ist Rauschen.
  const anonymous = (n: string) => /^[0-9*]+$/.test(n);
  const players = [...chosen.values()]
    .filter((p) => knownLc.has(p.name.toLowerCase()) || ((p.dmg > 0 || !!p.job) && !(anonymous(p.name) && p.share < 1)))
    .sort((a, b) => b.dmg - a.dmg);
  const actorCount = Math.max(...uploads.map((u) => u.detail.actorCount));
  const kept = players.filter((p, i) => i < MAX_DETAIL_PLAYERS || knownLc.has(p.name.toLowerCase()));

  // Zeitreihen: je Spieler aus seiner Quelle, sonst aus irgendeiner Perspektive
  const byUploader = new Map(uploads.map((u) => [u.uploader, u]));
  const pick = <T extends { name: string }>(list: (u: StoredUpload) => T[], p: MergedPlayer) => {
    const own = byUploader.get(p.source);
    const k = p.name.toLowerCase();
    const inOwn = own && list(own).find((s) => unmask(s.name).toLowerCase() === k);
    if (inOwn) return { u: own!, item: inOwn };
    for (const u of uploads) {
      const it = list(u).find((s) => unmask(s.name).toLowerCase() === k);
      if (it) return { u, item: it };
    }
    return null;
  };
  const series: TimedSeries[] = [];
  const lanes: EncounterDetail["timeline"]["lanes"] = [];
  for (const p of kept) {
    const s = pick((u) => u.detail.series, p);
    if (s)
      series.push({ name: p.name, source: s.u.uploader, offsetMs: s.u.detail.startMs - startMs, bucketMs: s.u.detail.bucketMs, dmg: s.item.dmg });
    const l = pick((u) => u.detail.lanes, p);
    if (l)
      lanes.push({ name: p.name, source: l.u.uploader, offsetMs: l.u.detail.startMs - startMs, bucketMs: l.u.detail.bucketMs, skills: l.item.skills });
  }

  const summary: EncounterSummary = {
    id,
    boss: best.detail.boss,
    mobCode: best.detail.mobCode,
    targetId: best.detail.targetId,
    dungeonId: best.detail.dungeonId,
    startMs,
    durationMs,
    totalDamage,
    maxHp: Math.max(...uploads.map((u) => u.detail.maxHp)),
    isTrain: uploads.every((u) => u.detail.isTrain),
    killed: uploads.some((u) => u.detail.killed === true),
    actorCount,
    uploaders: [...new Set(uploads.map((u) => u.uploader))],
    top: players
      .filter((p) => p.dmg > 0)
      .slice(0, 5)
      .map((p) => ({ name: p.name, job: p.job, jobId: p.jobId, dps: p.dps, share: p.share })),
  };

  return {
    v: MERGE_VERSION,
    summary,
    uploads: uploads.map((u) => ({ id: u.id, uploader: u.uploader, startMs: u.detail.startMs, durationMs: u.detail.durationMs, rawBytes: u.rawBytes })),
    players: kept,
    timeline: {
      series: series.slice(0, 12),
      total: { source: best.uploader, offsetMs: best.detail.startMs - startMs, bucketMs: best.detail.bucketMs, dmg: best.detail.total },
      lanes,
    },
    ping: uploads
      .filter((u) => u.detail.ping.length)
      .map((u) => ({ uploader: u.uploader, offsetMs: u.detail.startMs - startMs, points: u.detail.ping })),
  };
}

/** Wendet die Namensaufloesung auf ein gespeichertes Detail nachtraeglich an. */
export function unmaskDetail(d: EncounterDetail, unmask: (n: string) => string): EncounterDetail {
  for (const p of d.summary.top) p.name = unmask(p.name);
  for (const p of d.players) p.name = unmask(p.name);
  for (const s of d.timeline.series) s.name = unmask(s.name);
  for (const l of d.timeline.lanes) l.name = unmask(l.name);
  return d;
}

// ---------- Bytes / gzip / base64 ----------

export class TooLargeError extends Error {}

/** Liest einen Stream vollstaendig, bricht bei mehr als `limit` Bytes ab. */
export async function readLimited(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new TooLargeError(`groesser als ${limit} Bytes`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

export async function gunzip(b: Uint8Array, limit: number): Promise<Uint8Array> {
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
  return readLimited(s, limit);
}

export async function gzip(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b]).stream().pipeThrough(new CompressionStream("gzip"));
  return readLimited(s, Number.MAX_SAFE_INTEGER);
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** JSON → base64(gzip) fuer D1-Textspalten */
export async function packJson(v: unknown): Promise<string> {
  return toBase64(await gzip(enc.encode(JSON.stringify(v))));
}
export async function unpackJson<T>(s: string): Promise<T> {
  return JSON.parse(dec.decode(await gunzip(fromBase64(s), 64 * 1024 * 1024))) as T;
}

export async function shortHash(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
