// Worker-Einstieg: Dashboard (statische Assets) + /api/* → Durable Object pro Raum.
// Der Worker selbst macht nur billige Arbeit (Routing, Auth, Header), damit er im
// 10-ms-CPU-Limit des Free Plans bleibt. Uploads werden als Stream durchgereicht.

import { Env, allowedOrigin, bearer, checkRoomSecret, corsHeaders } from "./auth";
import { LIMITS, PROTOCOL_VERSION, ROOM_CODE_RE } from "./protocol";
import { handleStats } from "./stats";

export { Room } from "./room";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function json(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

function withHeaders(resp: Response, extra: Record<string, string>): Response {
  if (resp.webSocket) return resp; // 101 nicht anfassen
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

/** Wohin geht eine Anfrage unterhalb von /api/rooms/:code? */
function routeOf(method: string, rest: string): "do" | "d1" | null {
  if (rest === "/live") return method === "GET" ? "do" : null;
  if (rest === "/fights") return method === "POST" ? "do" : method === "GET" ? "d1" : null;
  if (/^\/fights\/[0-9a-f]{16}$/.test(rest)) return method === "GET" || method === "DELETE" ? "do" : null;
  if (/^\/uploads\/[0-9a-f]{16}\/raw$/.test(rest)) return method === "GET" ? "do" : null;
  if (rest === "/members" || /^\/stats\/(bosses|leaderboard|player|compare|trends)$/.test(rest)) {
    return method === "GET" ? "d1" : null;
  }
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

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

    // WebSocket: Auth erfolgt in der ersten Nachricht ("hello"), weil Browser
    // beim Verbindungsaufbau keine eigenen Header setzen koennen und das Secret
    // nicht in der URL (→ Logs) landen soll.
    if (rest === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "expected_websocket" }, 426, cors);
      }
      return stub.fetch(new Request(doUrl, req));
    }

    const target = routeOf(req.method, rest);
    if (!target) return json({ error: "not_found" }, 404, cors);

    const secret = bearer(req);
    if (!(await checkRoomSecret(env, code, secret))) {
      return json({ error: "unauthorized" }, 401, { ...cors, "www-authenticate": 'Bearer realm="a2dps"' });
    }

    // Lesende Statistik direkt aus D1 – billig, kein Durable-Object-Aufruf
    if (target === "d1") {
      const data = await handleStats(env.DB, code, rest, url);
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

    // Authorization nicht an das Durable Object weiterreichen.
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
    return withHeaders(resp, cors);
  },
} satisfies ExportedHandler<Env>;
