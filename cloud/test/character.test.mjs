// Charakter-Abfrage: Validierung, Kürzen, Drosselung, Proxy mit gemocktem fetch (KEIN echter NCSOFT-Aufruf).
import test from "node:test";
import assert from "node:assert/strict";
import { handleCharacter } from "../src/character.ts";
import { Throttle, parseCharacterId, parseName, parseRegion, reduceSearch, reduceItem, safeImage, searchUrl, itemUrl } from "../src/character-core.ts";

const ON = { CHARACTER_LOOKUP: "on" };
const ID = "g4BzpNzRAZxgHDK7HQhhirqksx2_AA17SarKbwfyaOE=";
const mkCache = () => {
  const m = new Map();
  return { match: async (r) => m.get(r.url)?.clone(), put: async (r, v) => void m.set(r.url, v), size: () => m.size };
};
function mock(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    for (const [needle, body] of routes) if (String(url).includes(needle)) return body instanceof Response ? body : Response.json(body);
    return new Response("nope", { status: 500 });
  };
  return { f, calls };
}
const call = (path, { env = ON, room = "r1", deps = {}, method = "GET", origin } = {}) => {
  const url = new URL(`https://dash.example${path}`);
  return handleCharacter(new Request(url, { method, headers: origin ? { origin } : {} }), env, url, room, { throttle: new Throttle(), cache: null, ...deps });
};

test("Schalter aus → 404, ohne Session → 401, falsche Methode → 405", async () => {
  assert.equal((await call("/api/character/servers", { env: {} })).status, 404);
  assert.equal((await call("/api/character/servers", { env: { CHARACTER_LOOKUP: "off" } })).status, 404);
  assert.equal((await call("/api/character/servers", { room: null })).status, 401);
  assert.equal((await call("/api/character/servers", { method: "POST" })).status, 405);
  assert.equal((await call("/api/character/servers", { origin: "https://evil.example" })).status, 403);
});

test("Eingaben werden validiert, bevor etwas nach außen geht", async () => {
  const { f, calls } = mock([]);
  const deps = { fetch: f };
  for (const p of [
    "/api/character/search?q=a&region=eu",
    "/api/character/search?q=Na%20me;x&region=eu",
    "/api/character/search?q=Name&region=xx",
    "/api/character/search?q=Name&region=eu&lang=zz",
    "/api/character/search?q=Name&region=eu&server=abc",
    "/api/character/search?q=Name&region=eu&page=0",
    "/api/character/1317/%3Chttp%3A%2F%2Fevil%3E?region=eu",
    "/api/character/1317/abc?region=eu",
    `/api/character/1317/${ID}/item?region=eu&item=x&slot=1`,
  ]) {
    const r = await call(p, { deps });
    assert.equal(r.status, 400, p);
  }
  assert.equal((await call("/api/character/nichts/anderes", { deps })).status, 404);
  assert.equal((await call("/api/character/9/abc", { deps })).status, 404);
  assert.equal(calls.length, 0);
});

test("Suche: feste Hosts, gekürzte Felder, <strong> entfernt, Bild nur von NCSOFT", async () => {
  const { f, calls } = mock([
    [
      "api-search.plaync.com",
      {
        list: [
          { characterId: "abcdefghijklmnop%3D", name: "<strong>Mar</strong>l", race: 1, pcId: 6, level: 45, serverId: 1317, serverName: "Tsenka", region: "eu", profileImageUrl: "/game_profile_images/aion2global/images?x=1", geheim: "x" },
          { characterId: "d", name: "X", profileImageUrl: "https://evil.example/a.png" },
        ],
        pagination: { page: 1, size: 20, total: 2, endPage: 1 },
      },
    ],
  ]);
  const r = await call("/api/character/search?q=Marl&region=eu&lang=de&server=1317", { deps: { fetch: f } });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(new URL(calls[0]).hostname, "api-search.plaync.com");
  assert.equal(new URL(calls[0]).searchParams.get("localeInfo"), "de-DE");
  assert.equal(new URL(calls[0]).searchParams.get("serverId"), "1317");
  assert.equal(j.list[0].name, "Marl");
  assert.equal(j.list[0].id, "abcdefghijklmnop=");
  assert.equal(j.list[0].image, "https://profileimg.plaync.com/game_profile_images/aion2global/images?x=1");
  assert.equal(j.list[1].image, null);
  assert.ok(!("geheim" in j.list[0]));
  assert.equal(j.total, 2);
});

test("Profil: Info + Ausrüstung zusammengeführt, ID dekodiert, Cache verhindert zweiten Abruf", async () => {
  const { f, calls } = mock([
    ["/api/character/info", { profile: { characterName: "Marl", className: "Gladiator", characterLevel: 45, combatPower: 5881, serverId: 1317, serverName: "Tsenka", profileImage: "https://profileimg.plaync.com/x" }, stat: { statList: [{ type: "STR", name: "Might", value: 0 }, { type: "ItemLevel", name: "Item level", value: 41 }, { type: "Crit", name: "Critical", value: 120 }] } }],
    ["/api/character/equipment", { equipment: { equipmentList: [{ slotPos: 1, slotPosName: "MainHand", id: 11, name: "Schwert", grade: "Unique", enchantLevel: 10, exceedLevel: 0, icon: "https://assets.playnccdn.com/a.png" }] }, petwing: { wing: { id: 5, name: "Flügel", grade: "Legend", enchantLevel: 3 } } }],
  ]);
  const cache = mkCache();
  const path = `/api/character/1317/${encodeURIComponent(ID)}?region=eu&lang=en`;
  const r1 = await call(path, { deps: { fetch: f, cache } });
  const j = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).searchParams.get("characterId"), ID);
  assert.deepEqual(j.stats.map((s) => s.type), ["ItemLevel", "Crit"]);
  assert.equal(j.items[0].enchant, 10);
  assert.equal(j.wing.name, "Flügel");
  const r2 = await call(path, { deps: { fetch: f, cache } });
  assert.equal(r2.headers.get("x-a2-cache"), "hit");
  assert.equal(calls.length, 2);
});

test("Item: Würfe, Steine, Seelenbindung", async () => {
  const { f, calls } = mock([
    ["/equipment/item", { id: 5, name: "Handschuhe", grade: "Unique", soulBindRate: "59.7", magicStoneSlotCount: 4, subStats: [{ id: "A", name: "Attack", value: "12", added: false }], magicStoneStat: [{ id: "A", name: "Attack", value: "+3", grade: "Rare", slotPos: 0, icon: "https://assets.playnccdn.com/s.png" }], mainStats: [{ id: "D", name: "Defense", value: "265", extra: "170" }] }],
  ]);
  const r = await call(`/api/character/1307/${ID}/item?region=eu&item=210530038&enchant=11&slot=7`, { deps: { fetch: f } });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(new URL(calls[0]).searchParams.get("slotPos"), "7");
  assert.equal(j.soulBind, "59.7");
  assert.equal(j.stones[0].value, "+3");
  assert.equal(j.subStats[0].value, "12");
});

test("Fehler von NCSOFT: 404 → not_found, sonst 502, nichts gecacht", async () => {
  const cache = mkCache();
  let r = await call(`/api/character/1307/${ID}?region=eu`, { deps: { fetch: mock([["/api/", new Response("x", { status: 404 })]]).f, cache } });
  assert.equal(r.status, 404);
  r = await call(`/api/character/1307/${ID}?region=eu`, { deps: { fetch: mock([["/api/", new Response("x", { status: 503 })]]).f, cache } });
  assert.equal(r.status, 502);
  r = await call("/api/character/servers", { deps: { fetch: async () => { throw new Error("netz"); }, cache } });
  assert.equal(r.status, 502);
  assert.equal(cache.size(), 0);
});

test("Drosselung: 60 pro Minute je Raum", async () => {
  const t = new Throttle(3, 1000);
  assert.ok(t.take("a", 0) && t.take("a", 1) && t.take("a", 2));
  assert.equal(t.take("a", 3), false);
  assert.ok(t.take("b", 3));
  assert.ok(t.take("a", 1500));
  const { f } = mock([["aion2.plaync.com", { serverList: [] }]]);
  const throttle = new Throttle(2, 60000);
  assert.equal((await call("/api/character/servers", { deps: { fetch: f, throttle } })).status, 200);
  assert.equal((await call("/api/character/servers", { deps: { fetch: f, throttle } })).status, 200);
  const r = await call("/api/character/servers", { deps: { fetch: f, throttle } });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("retry-after"));
});

test("Hilfsfunktionen", () => {
  assert.equal(parseRegion(undefined).value, "eu");
  assert.equal(parseRegion("NAE").value, "nae");
  assert.equal(parseName("  Müller1 ").value, "Müller1");
  assert.equal(parseName("a b").ok, false);
  assert.equal(parseCharacterId("abc").ok, false);
  assert.equal(parseCharacterId(encodeURIComponent(ID)).value, ID);
  assert.equal(safeImage("http://assets.playnccdn.com/a.png"), null);
  assert.equal(safeImage("https://assets.playnccdn.com.evil.example/a.png"), null);
  assert.equal(safeImage("https://assets.playnccdn.com/a.png"), "https://assets.playnccdn.com/a.png");
  assert.deepEqual(reduceSearch(null), { list: [], page: 0, total: 0, endPage: 0 });
  assert.equal(reduceItem(undefined).name, "");
  // Host kann nicht über Parameter beeinflusst werden
  const u = new URL(searchUrl({ keyword: "x@evil.example/", region: "eu", lang: "en-US", page: 1, size: 20 }));
  assert.equal(u.hostname, "api-search.plaync.com");
  assert.equal(new URL(itemUrl({ region: "eu", lang: "en-US", characterId: ID, serverId: 1307, id: 1, enchantLevel: 0, slotPos: 1 })).hostname, "aion2.plaync.com");
});
