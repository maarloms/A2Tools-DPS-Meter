// Charakter-Abfrage: reine Logik (Validierung, URL-Bau, Kürzen der NCSOFT-Antworten, Drosselung).
// Bewusst OHNE Imports, damit `node --test` die Datei direkt laden kann. Quelle/Felder: docs/ncsoft-character-api.md

export const SEARCH_HOST = "api-search.plaync.com";
export const GAME_HOST = "aion2.plaync.com";
/** Bild-Hosts, deren https-URLs der Worker durchreicht */
export const IMAGE_HOSTS = ["assets.playnccdn.com", "profileimg.plaync.com"];

export const REGIONS = ["naw", "nae", "eu", "la", "as"] as const;
export const LOCALES: Record<string, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  ja: "ja-JP",
  pt: "pt-BR",
};

/** Cache-Dauer je Abfrageart (Sekunden) */
export const TTL = { servers: 86400, search: 300, character: 600, item: 1800 } as const;

export const THROTTLE_PER_MIN = 40;

export type Query = Record<string, string | undefined>;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const NAME_RE = /^[\p{L}\p{N}]{2,24}$/u;
const ID_RE = /^[A-Za-z0-9_\-=]{16,96}$/;
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function parseRegion(v: string | undefined): Parsed<string> {
  const r = (v ?? "eu").toLowerCase();
  return (REGIONS as readonly string[]).includes(r) ? { ok: true, value: r } : bad("bad_region");
}
export function parseLocale(v: string | undefined): Parsed<string> {
  const l = LOCALES[(v ?? "en").toLowerCase().slice(0, 2)];
  return l ? { ok: true, value: l } : bad("bad_lang");
}
const parseIntIn = (v: string | undefined, min: number, max: number, err: string): Parsed<number> => {
  if (v === undefined || !/^\d{1,9}$/.test(v)) return bad(err);
  const n = Number(v);
  return n >= min && n <= max ? { ok: true, value: n } : bad(err);
};
export const parseServerId = (v: string | undefined) => parseIntIn(v, 1000, 99999, "bad_server");

/** characterId: kommt aus der Suche URL-kodiert ("…%3D"); wir akzeptieren beides und geben die dekodierte Form zurück. */
export function parseCharacterId(v: string | undefined): Parsed<string> {
  let s = v ?? "";
  try {
    s = decodeURIComponent(s);
  } catch {
    return bad("bad_id");
  }
  return ID_RE.test(s) ? { ok: true, value: s } : bad("bad_id");
}

export function parseName(v: string | undefined): Parsed<string> {
  const s = (v ?? "").trim().normalize("NFC");
  return NAME_RE.test(s) ? { ok: true, value: s } : bad("bad_name");
}

/** Zwischen den Teilen der Eingabe prüfen: erster Fehler gewinnt */
export function firstError(...parts: Parsed<unknown>[]): string | null {
  for (const p of parts) if (!p.ok) return p.error;
  return null;
}

// ---------- URL-Bau (Host nur aus Konstanten) ----------

function build(host: string, path: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

export const serversUrl = (region: string, lang: string) => build(GAME_HOST, "/de-de/api/gameinfo/servers", { lang, region });
export const searchUrl = (p: { keyword: string; region: string; lang: string; serverId?: number; page: number; size: number }) =>
  build(SEARCH_HOST, "/aion2global/search/v2/character", {
    keyword: p.keyword,
    region: p.region,
    localeInfo: p.lang,
    serverId: p.serverId,
    page: p.page,
    size: p.size,
    sort: "level",
  });
export const infoUrl = (p: { region: string; lang: string; characterId: string; serverId: number }) =>
  build(GAME_HOST, "/api/character/info", { lang: p.lang, region: p.region, characterId: p.characterId, serverId: p.serverId });
export const equipmentUrl = (p: { region: string; lang: string; characterId: string; serverId: number }) =>
  build(GAME_HOST, "/api/character/equipment", { lang: p.lang, region: p.region, characterId: p.characterId, serverId: p.serverId });
export const itemUrl = (p: { region: string; lang: string; characterId: string; serverId: number; id: number; enchantLevel: number; slotPos: number }) =>
  build(GAME_HOST, "/api/character/equipment/item", {
    lang: p.lang,
    region: p.region,
    id: p.id,
    enchantLevel: p.enchantLevel,
    characterId: p.characterId,
    serverId: p.serverId,
    slotPos: p.slotPos,
  });

// ---------- Antworten kürzen ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Zahlen kommen teils als Text ("59.7", "+3") */
const numText = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 16) : "");

/** Nur https-Bilder von den bekannten NCSOFT-Hosts; relative Pfade der Suche (/game_profile_images/…) werden auf profileimg.plaync.com gesetzt */
export function safeImage(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const u = v.startsWith("/") ? new URL(v, "https://profileimg.plaync.com") : new URL(v);
    if (u.protocol !== "https:" || !IMAGE_HOSTS.includes(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const stripMarks = (s: string) => s.replace(/<[^>]*>/g, "");

export function reduceServers(raw: unknown) {
  return arr(isObj(raw) ? raw.serverList : null).map((s) => ({
    id: num(s.serverId),
    name: str(s.serverName, 32),
    short: str(s.serverShortName, 8),
    race: num(s.raceId),
  }));
}

/** NCSOFT liefert die ID in der Suche URL-kodiert ("…%3D"); wir geben die Rohform weiter (Client kodiert beim Aufruf selbst) */
function decodeId(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function reduceSearch(raw: unknown) {
  const r = isObj(raw) ? raw : {};
  const p = isObj(r.pagination) ? r.pagination : {};
  return {
    list: arr(r.list).map((c) => ({
      id: decodeId(str(c.characterId, 120)),
      name: stripMarks(str(c.name, 120)).slice(0, 32),
      race: num(c.race),
      pcId: num(c.pcId),
      level: num(c.level),
      serverId: num(c.serverId),
      serverName: str(c.serverName, 32),
      region: str(c.region, 4),
      image: safeImage(c.profileImageUrl),
    })),
    page: num(p.page),
    total: num(p.total),
    endPage: num(p.endPage),
  };
}

export function reduceInfo(raw: unknown) {
  const r = isObj(raw) ? raw : {};
  const p = isObj(r.profile) ? r.profile : {};
  const stats = arr(isObj(r.stat) ? r.stat.statList : null)
    .filter((s) => num(s.value) !== 0 || str(s.type) === "ItemLevel")
    .map((s) => ({ type: str(s.type, 24), name: str(s.name, 48), value: num(s.value) }));
  return {
    name: str(p.characterName, 32),
    className: str(p.className, 32),
    level: num(p.characterLevel),
    combatPower: num(p.combatPower),
    race: str(p.raceName, 16),
    gender: str(p.genderName, 16),
    serverId: num(p.serverId),
    serverName: str(p.serverName, 32),
    title: str(p.titleName, 48),
    image: safeImage(p.profileImage),
    stats,
  };
}

export function reduceEquipment(raw: unknown) {
  const e = isObj(raw) && isObj(raw.equipment) ? raw.equipment : {};
  const wing = isObj(raw) && isObj(raw.petwing) && isObj(raw.petwing.wing) ? raw.petwing.wing : null;
  const item = (x: Obj) => ({
    slotPos: num(x.slotPos),
    slot: str(x.slotPosName, 24),
    id: num(x.id),
    name: str(x.name, 64),
    grade: str(x.grade, 16),
    enchant: num(x.enchantLevel),
    exceed: num(x.exceedLevel),
    icon: safeImage(x.icon),
  });
  return {
    items: arr(e.equipmentList).map(item),
    wing: wing && wing.id ? { name: str(wing.name, 64), grade: str(wing.grade, 16), enchant: num(wing.enchantLevel), icon: safeImage(wing.icon) } : null,
  };
}

export function reduceItem(raw: unknown) {
  const r = isObj(raw) ? raw : {};
  const stat = (x: Obj) => ({ id: str(x.id, 40), name: str(x.name, 48), value: numText(x.value), extra: numText(x.extra), added: x.added === true });
  return {
    id: num(r.id),
    name: str(r.name, 64),
    grade: str(r.grade, 16),
    category: str(r.categoryName, 32),
    level: num(r.level),
    equipLevel: num(r.equipLevel),
    enchant: num(r.enchantLevel),
    maxEnchant: num(r.maxEnchantLevel),
    maxExceed: num(r.maxExceedEnchantLevel),
    icon: safeImage(r.icon),
    soulBind: numText(r.soulBindRate),
    stoneSlots: num(r.magicStoneSlotCount),
    subStatCount: num(r.subStatCount),
    mainStats: arr(r.mainStats).map(stat),
    subStats: arr(r.subStats).map(stat),
    subSkills: arr(r.subSkills).map((s) => ({ id: num(s.id), name: str(s.name, 48), level: num(s.level), added: s.added === true, icon: safeImage(s.icon) })),
    stones: arr(r.magicStoneStat).map((s) => ({
      id: str(s.id, 40),
      name: str(s.name, 48),
      value: numText(s.value),
      grade: str(s.grade, 16),
      slotPos: num(s.slotPos),
      icon: safeImage(s.icon),
    })),
    sources: (Array.isArray(r.sources) ? r.sources : []).filter((s) => typeof s === "string").slice(0, 8).map((s) => str(s, 40)),
  };
}

// ---------- Drosselung ----------

/** Gleitendes Minutenfenster je Schlüssel (Raum). Grob: gilt je Worker-Instanz. */
export class Throttle {
  private hits = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;
  constructor(limit = THROTTLE_PER_MIN, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  /** true = erlaubt */
  take(key: string, now = Date.now()): boolean {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 500) for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
    return true;
  }
}
