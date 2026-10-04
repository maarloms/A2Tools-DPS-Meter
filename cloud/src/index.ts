// Worker-Einstieg. ALLES läuft durch den Worker (run_worker_first: true):
//  - ohne gültige Session gibt es nur die schlichte Login-Seite (+ ihre 2 Dateien),
//  - mit Session das Dashboard (statische Assets),
//  - /api/session: Login/Logout per Cookie,
//  - /api/rooms/:code/*: Auth per "Authorization: Bearer <secret>" (App) ODER Session-Cookie (Dashboard).
// Der Worker macht nur billige Arbeit (Routing, Auth, Header) – 10-ms-CPU-Limit im Free Plan.

import { Env, allowedOrigin, bearer, checkRoomSecret, corsHeaders } from "./auth";
import { LIMITS, PROTOCOL_VERSION, ROOM_CODE_RE } from "./protocol";
import { SESSION_DAYS, createSession, sessionCookie, sessionRoom } from "./session";
import { handleStats } from "./stats";

export { Room } from "./room";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};
const NO_STORE = { "cache-control": "no-store" };
const PAGE_HEADERS: Record<string, string> = {
  ...SECURITY_HEADERS,
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; " +
    "connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** Ohne Login erreichbar: nur die Login-Seite und was sie braucht */
const PUBLIC_ASSETS = new Set(["/login.js", "/login.css", "/robots.txt"]);

function json(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...NO_STORE, ...extra },
  });
}

function withHeaders(resp: Response, extra: Record<string, string>): Response {
  if (resp.webSocket) return resp; // 101 nicht anfassen
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

/** Wohin geht eine Anfrage unterhalb von /api/rooms/:code? */
function routeOf(method: string, rest: string): "do" | "d1" | null {
  if (rest === "/live") return method === "GET" ? "do" : null;
  if (rest === "/bosses") return method === "GET" ? "do" : null;
  if (rest === "/fights") return method === "POST" ? "do" : method === "GET" ? "d1" : null;
  if (/^\/fights\/[0-9a-f]{16}$/.test(rest)) return method === "GET" || method === "DELETE" ? "do" : null;
  if (/^\/uploads\/[0-9a-f]{16}\/raw$/.test(rest)) return method === "GET" ? "do" : null;
  if (rest === "/members") return method === "GET" || method === "PATCH" ? "d1" : null;
  if (rest === "/boss-settings") return method === "GET" || method === "PATCH" ? "d1" : null;
  if (rest === "/maintenance/backfill") return method === "POST" ? "d1" : null;
  if (/^\/stats\/(overview|bosses|leaderboard|player|compare|trends)$/.test(rest)) return method === "GET" ? "d1" : null;
  return null;
}

// ---------- Seiten / Assets ----------

async function serveAsset(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === "/favicon.ico") return new Response(null, { status: 204 }); // Icon steckt inline im HTML
  const room = await sessionRoom(env, req);
  if (room || PUBLIC_ASSETS.has(path)) {
    if (!room && (path === "/" || path === "/index.html")) return loginPage(req, env, url);
    const resp = await env.ASSETS.fetch(req);
    const extra: Record<string, string> = { ...PAGE_HEADERS };
    // Dashboard-Dateien nicht in fremden/gemeinsamen Caches ablegen
    if (!PUBLIC_ASSETS.has(path)) extra["cache-control"] = "private, no-cache";
    return withHeaders(resp, extra);
  }
  // Ohne Session: Seitenaufrufe bekommen die Login-Seite, alles andere 401
  const wantsHtml = req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) return loginPage(req, env, url);
  return new Response("Anmeldung erforderlich", { status: 401, headers: { ...SECURITY_HEADERS, ...NO_STORE } });
}

async function loginPage(req: Request, env: Env, url: URL): Promise<Response> {
  const resp = await env.ASSETS.fetch(new Request(new URL("/login", url), { headers: req.headers }));
  return withHeaders(new Response(resp.body, { status: 200, headers: resp.headers }), { ...PAGE_HEADERS, ...NO_STORE });
}

// ---------- Session ----------

async function handleSession(req: Request, env: Env, url: URL): Promise<Response> {
  // Nur vom eigenen Dashboard (oder ohne Origin, z. B. Tests)
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "origin_not_allowed" }, 403);

  if (req.method === "GET") {
    const room = await sessionRoom(env, req);
    return room ? json({ room }, 200) : json({ error: "unauthorized" }, 401);
  }
  if (req.method === "DELETE") {
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, "", 0) });
  }
  if (req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { room?: unknown; secret?: unknown; remember?: unknown } | null;
    const room = typeof body?.room === "string" ? body.room.trim().toLowerCase() : "";
    if (!ROOM_CODE_RE.test(room) || !(await checkRoomSecret(env, room, body?.secret))) {
      return json({ error: "unauthorized" }, 401);
    }
    const remember = body?.remember !== false;
    const s = await createSession(env, room, remember ? SESSION_DAYS : 1);
    const cookie = sessionCookie(req, s.value, remember ? SESSION_DAYS * 86400 : null);
    return json({ ok: true, room }, 200, { "set-cookie": cookie });
  }
  return json({ error: "method_not_allowed" }, 405);
}

// ---------- Einstieg ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return serveAsset(req, env, url);
    if (url.pathname === "/api/session") return handleSession(req, env, url);

    const origin = allowedOrigin(env, req);
    if (!origin.ok) return json({ error: "origin_not_allowed" }, 403);
    // Gleiche Origin braucht keine CORS-Header; fremde nur, wenn in ALLOWED_ORIGINS.
    const cors = origin.origin && origin.origin !== url.origin ? corsHeaders(origin.origin) : {};

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/api/health") {
      return json({ ok: true, protocol: PROTOCOL_VERSION }, 200, cors);
    }

    const m = /^\/api\/rooms\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!m) return json({ error: "not_found" }, 404, cors);
    const code = decodeURIComponent(m[1]).toLowerCase();
    const rest = m[2];
    if (!ROOM_CODE_RE.test(code)) return json({ error: "not_found" }, 404, cors);

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const doUrl = new URL(`/api/rooms/${code}${rest}`, url.origin);
    doUrl.search = url.search;

    // Session-Cookie gilt nur für den eigenen Raum und nur von der eigenen Origin
    const viaSession = (!origin.origin || origin.origin === url.origin) && (await sessionRoom(env, req)) === code;

    // WebSocket: App meldet sich mit dem Secret in der ersten Nachricht ("hello") an –
    // Browser können keine Header setzen, und das Secret soll nicht in die URL.
    // Das Dashboard ist über das Cookie bereits angemeldet → Vorab-Freigabe für das DO.
    if (rest === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "expected_websocket" }, 426, cors);
      }
      const headers = new Headers(req.headers);
      headers.delete("x-a2-session"); // nie vom Client übernehmen
      headers.delete("cookie");
      headers.delete("authorization");
      if (viaSession) headers.set("x-a2-session", "1");
      return stub.fetch(new Request(doUrl, { method: "GET", headers }));
    }

    const target = routeOf(req.method, rest);
    if (!target) return json({ error: "not_found" }, 404, cors);

    if (!viaSession && !(await checkRoomSecret(env, code, bearer(req)))) {
      return json({ error: "unauthorized" }, 401, { ...cors, "www-authenticate": 'Bearer realm="a2dps"' });
    }

    // Lesende Statistik + Mitgliederverwaltung direkt aus D1 – kein Durable-Object-Aufruf
    if (target === "d1") {
      const data = await handleStats(env.DB, env, code, rest, url, req);
      if (req.method === "PATCH" && rest === "/members" && data && typeof data === "object" && "ok" in data) {
        // Live-Ansicht im DO über die geänderte Mitgliederliste informieren
        await stub.fetch(new Request(new URL(`/api/rooms/${code}/members-changed`, url.origin), { method: "POST" }));
      }
      if (data === null) return json({ error: "not_found" }, 404, cors);
      if (typeof data === "object" && data && "error" in data) return json(data, 400, cors);
      return json(data, 200, cors);
    }

    if (req.method === "POST") {
      const len = Number(req.headers.get("content-length") || "0");
      if (len > LIMITS.maxUploadBytes) {
        await req.body?.cancel();
        return json({ error: "too_large" }, 413, cors);
      }
    }

    // Authorization/Cookie nicht an das Durable Object weiterreichen.
    const headers = new Headers();
    const ct = req.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    const resp = await stub.fetch(
      new Request(doUrl, {
        method: req.method,
        headers,
        body: req.method === "POST" ? req.body : undefined,
      }),
    );
    return withHeaders(resp, { ...SECURITY_HEADERS, ...NO_STORE, ...cors });
  },
} satisfies ExportedHandler<Env>;
