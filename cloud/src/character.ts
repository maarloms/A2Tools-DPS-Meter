// Charakter-Abfrage über die öffentlichen NCSOFT-Dienste (Proxy für das Dashboard).
//   GET /api/character/servers?region=eu&lang=de
//   GET /api/character/search?q=Name&region=eu&lang=de[&server=1317][&page=1]
//   GET /api/character/:serverId/:characterId?region=eu&lang=de              → Profil + Ausrüstung (gekürzt)
//   GET /api/character/:serverId/:characterId/item?region&lang&item=<id>&enchant=<n>&slot=<n>  → Einzel-Item (Würfe, Steine, Seelenbindung)
// Nur mit Session (Dashboard), nur Hosts aus character-core.ts (URLs entstehen aus Konstanten, nie aus Eingaben),
// Schalter CHARACTER_LOOKUP="on". Felder/Quelle: docs/ncsoft-character-api.md

import type { Env } from "./auth";
import {
  TTL,
  Throttle,
  equipmentUrl,
  firstError,
  infoUrl,
  itemUrl,
  parseCharacterId,
  parseLocale,
  parseName,
  parseRegion,
  parseServerId,
  reduceEquipment,
  reduceInfo,
  reduceItem,
  reduceSearch,
  reduceServers,
  searchUrl,
  serversUrl,
} from "./character-core.ts";

const UPSTREAM_TIMEOUT_MS = 8000;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

/** Für Tests austauschbar: Netzwerk, Cache, Session */
export interface Deps {
  fetch: typeof fetch;
  cache: Pick<Cache, "match" | "put"> | null;
  throttle: Throttle;
}
const defaultThrottle = new Throttle();

const out = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extra } });

export const isCharacterPath = (path: string) => path.startsWith("/api/character/");

export function characterEnabled(env: { CHARACTER_LOOKUP?: string }): boolean {
  return (env.CHARACTER_LOOKUP ?? "").trim().toLowerCase() === "on";
}

type Fetched = { ok: true; json: unknown } | { ok: false; status: number };

async function getJson(deps: Deps, url: string): Promise<Fetched> {
  try {
    const r = await deps.fetch(url, {
      headers: { accept: "application/json", "user-agent": "a2dps-cloud/1 (private group dashboard)" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: "manual", // Weiterleitungen nie folgen (3xx zählt als Fehler)
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, json: await r.json() };
  } catch (e) {
    console.warn(`character: Abruf fehlgeschlagen (${e instanceof Error ? e.message : "?"})`);
    return { ok: false, status: 0 };
  }
}

/** Antwort aus dem Cache oder frisch holen + kürzen + ablegen (Fehler werden nie gecacht) */
async function cached(deps: Deps, key: string, ttl: number, produce: () => Promise<{ data: unknown } | { status: number }>): Promise<Response> {
  const cacheKey = new Request(`https://cache.invalid/character?k=${encodeURIComponent(key)}`);
  const hit = await deps.cache?.match(cacheKey).catch(() => undefined);
  if (hit) return out(await hit.json(), 200, { "x-a2-cache": "hit" });
  const r = await produce();
  if ("status" in r) {
    // 400/404 von NCSOFT = „gibt es nicht“, alles andere = Dienst gerade nicht erreichbar
    return r.status === 400 || r.status === 404 ? out({ error: "not_found" }, 404) : out({ error: "upstream", status: r.status }, 502);
  }
  const body = JSON.stringify(r.data);
  await deps.cache
    ?.put(cacheKey, new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` } }))
    .catch(() => undefined);
  return new Response(body, { status: 200, headers: { ...HEADERS, "x-a2-cache": "miss" } });
}

/** `room`: Raum der gültigen Session (index.ts prüft das Cookie) oder null */
export async function handleCharacter(req: Request, env: Pick<Env, "CHARACTER_LOOKUP">, url: URL, room: string | null, deps?: Partial<Deps>): Promise<Response> {
  const d: Deps = {
    fetch: deps?.fetch ?? ((input, init) => fetch(input, init)),
    cache: deps && "cache" in deps ? (deps.cache ?? null) : typeof caches !== "undefined" ? caches.default : null,
    throttle: deps?.throttle ?? defaultThrottle,
  };
  if (!characterEnabled(env)) return out({ error: "not_found" }, 404);
  if (req.method !== "GET") return out({ error: "method_not_allowed" }, 405);
  // Nur das eigene Dashboard mit Session
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return out({ error: "origin_not_allowed" }, 403);
  if (!room) return out({ error: "unauthorized" }, 401);
  if (!d.throttle.take(room)) return out({ error: "rate_limited" }, 429, { "retry-after": "30" });

  const q = (k: string) => url.searchParams.get(k) ?? undefined;
  const region = parseRegion(q("region"));
  const lang = parseLocale(q("lang"));
  const rest = url.pathname.slice("/api/character/".length);

  if (rest === "servers") {
    const err = firstError(region, lang);
    if (err || !region.ok || !lang.ok) return out({ error: err }, 400);
    const u = serversUrl(region.value, lang.value);
    return cached(d, u, TTL.servers, async () => {
      const r = await getJson(d, u);
      return r.ok ? { data: { servers: reduceServers(r.json) } } : r;
    });
  }

  if (rest === "search") {
    const name = parseName(q("q"));
    const serverRaw = q("server");
    const server = serverRaw ? parseServerId(serverRaw) : ({ ok: true, value: undefined } as const);
    const pageRaw = q("page") ?? "1";
    const page = /^\d{1,3}$/.test(pageRaw) && Number(pageRaw) >= 1 ? ({ ok: true, value: Number(pageRaw) } as const) : ({ ok: false, error: "bad_page" } as const);
    const err = firstError(region, lang, name, server, page);
    if (err || !region.ok || !lang.ok || !name.ok || !server.ok || !page.ok) return out({ error: err }, 400);
    const u = searchUrl({ keyword: name.value, region: region.value, lang: lang.value, serverId: server.value, page: page.value, size: 20 });
    return cached(d, u, TTL.search, async () => {
      const r = await getJson(d, u);
      return r.ok ? { data: reduceSearch(r.json) } : r;
    });
  }

  const m = /^(\d{4,5})\/([^/]{1,200})(\/item)?$/.exec(rest);
  if (!m) return out({ error: "not_found" }, 404);
  const serverId = parseServerId(m[1]);
  const characterId = parseCharacterId(m[2]);
  const common = firstError(region, lang, serverId, characterId);
  if (common || !region.ok || !lang.ok || !serverId.ok || !characterId.ok) return out({ error: common }, 400);
  const base = { region: region.value, lang: lang.value, serverId: serverId.value, characterId: characterId.value };

  if (m[3]) {
    const itemId = /^\d{1,12}$/.test(q("item") ?? "") ? Number(q("item")) : null;
    const enchant = /^\d{1,3}$/.test(q("enchant") ?? "0") ? Number(q("enchant") ?? "0") : null;
    const slot = /^\d{1,3}$/.test(q("slot") ?? "") ? Number(q("slot")) : null;
    if (itemId === null || enchant === null || slot === null) return out({ error: "bad_item" }, 400);
    const u = itemUrl({ ...base, id: itemId, enchantLevel: enchant, slotPos: slot });
    return cached(d, u, TTL.item, async () => {
      const r = await getJson(d, u);
      return r.ok ? { data: reduceItem(r.json) } : r;
    });
  }

  // Profil + Ausrüstung: zwei Abfragen, zusammen gecacht
  const ui = infoUrl(base);
  const ue = equipmentUrl(base);
  return cached(d, `${ui}|${ue}`, TTL.character, async () => {
    const [i, e] = await Promise.all([getJson(d, ui), getJson(d, ue)]);
    if (!i.ok) return i;
    if (!e.ok) return e;
    return { data: { ...reduceInfo(i.json), ...reduceEquipment(e.json) } };
  });
}
