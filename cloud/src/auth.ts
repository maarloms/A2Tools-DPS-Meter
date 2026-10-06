// Raum-Authentifizierung und Origin-Pruefung.
//
// Raeume stehen im Secret `ROOMS` ("code:secret,code2:secret2"). Der Server
// speichert keine Secrets selbst und loggt sie nie. Verglichen werden die
// SHA-256-Digests mit timingSafeEqual.

import { ROOM_CODE_RE } from "./protocol";

export interface Env {
  ROOM: DurableObjectNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
  ROOMS?: string;
  ROOM_MEMBERS?: string;
  SESSION_KEY?: string;
  ALLOWED_ORIGINS?: string;
  /** Zweites Passwort für Löschen, Ausblenden und Wartung. Ohne: wie das Raum-Secret. */
  ADMIN_SECRET?: string;
}

const MIN_SECRET_LEN = 16;
const enc = new TextEncoder();

let cachedRaw: string | undefined;
let cachedRooms = new Map<string, Uint8Array>();

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** Liest `ROOMS` einmal pro Isolate und haelt nur die Digests im Speicher. */
async function rooms(env: Env): Promise<Map<string, Uint8Array>> {
  const raw = env.ROOMS ?? "";
  if (raw === cachedRaw) return cachedRooms;
  const map = new Map<string, Uint8Array>();
  for (const entry of raw.split(/[,;\n]/)) {
    const i = entry.indexOf(":");
    if (i < 1) continue;
    const code = entry.slice(0, i).trim().toLowerCase();
    const secret = entry.slice(i + 1).trim();
    if (!ROOM_CODE_RE.test(code) || secret.length < MIN_SECRET_LEN) {
      // Nur den Code nennen, nie das Secret.
      console.warn(`ROOMS: Eintrag fuer "${code}" ignoriert (Code ungueltig oder Secret < ${MIN_SECRET_LEN} Zeichen)`);
      continue;
    }
    map.set(code, await sha256(secret));
  }
  cachedRaw = raw;
  cachedRooms = map;
  return map;
}

const DUMMY = new Uint8Array(32);

/** true, wenn Raum existiert und das Secret passt. Gleiche Laufzeit fuer unbekannte Raeume. */
export async function checkRoomSecret(env: Env, code: string, secret: unknown): Promise<boolean> {
  if (typeof secret !== "string" || secret.length === 0 || secret.length > 256) return false;
  const map = await rooms(env);
  const want = map.get(code);
  const got = await sha256(secret);
  const ok = crypto.subtle.timingSafeEqual(got, want ?? DUMMY);
  return ok && want !== undefined;
}

/**
 * Darf diese Anfrage löschen, ausblenden, umbenennen? Mit ADMIN_SECRET nur,
 * wenn der Header `x-a2-admin` es trägt: das Raum-Secret steckt in jedem
 * Einladungslink, und jedes Mitglied konnte damit ganze Namen samt Kämpfen
 * entfernen.
 */
export async function checkAdmin(env: Env, given: string | null): Promise<boolean> {
  const want = env.ADMIN_SECRET ?? "";
  if (!want) return true;
  if (!given || given.length > 256) return false;
  return crypto.subtle.timingSafeEqual(await sha256(given), await sha256(want));
}

/** Löschen, Ausblenden, Wartung: Routen, die `checkAdmin` brauchen. */
export function isAdminRoute(method: string, rest: string): boolean {
  return (
    (method === "DELETE" && /^\/fights\//.test(rest)) ||
    (method === "PATCH" && (rest === "/members" || rest === "/boss-settings")) ||
    (method === "POST" && rest.startsWith("/maintenance/"))
  );
}

/** SHA-256 des Raum-Secrets (für Session-Signaturen), null = Raum unbekannt */
export async function roomDigest(env: Env, code: string): Promise<Uint8Array | null> {
  return (await rooms(env)).get(code) ?? null;
}

/** Secret aus `Authorization: Bearer <secret>`. */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// ---------- Origins / CORS ----------

export function allowedOrigin(env: Env, req: Request): { ok: boolean; origin: string | null } {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true, origin: null }; // Nicht-Browser-Client (z. B. Rust-App)
  const self = new URL(req.url).origin;
  if (origin === self) return { ok: true, origin };
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { ok: extra.includes(origin), origin };
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, content-encoding, x-a2-admin",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
