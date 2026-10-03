// Dashboard-Session: signiertes Cookie statt Secret im Browser-Speicher.
//
// Cookie "a2s" = "<raum>.<ablauf>.<hmac>", HttpOnly, SameSite=Strict, Secure (bei https).
// HMAC-SHA256 über "v1|raum|ablauf|sha256(raum-secret)" mit SESSION_KEY.
// Wird das Raum-Secret geändert, werden alle Sessions des Raums ungültig.
// Fehlt SESSION_KEY (z. B. lokal), wird der Schlüssel aus ROOMS abgeleitet.

import { Env, roomDigest } from "./auth";
import { ROOM_CODE_RE } from "./protocol";

export const COOKIE = "a2s";
export const SESSION_DAYS = 30;
const enc = new TextEncoder();

let keyRaw: string | undefined;
let keyPromise: Promise<CryptoKey> | null = null;
let warned = false;

function key(env: Env): Promise<CryptoKey> {
  const raw = env.SESSION_KEY && env.SESSION_KEY.length >= 16 ? env.SESSION_KEY : `derived|${env.ROOMS ?? ""}`;
  if (raw !== keyRaw || !keyPromise) {
    if (!env.SESSION_KEY && !warned) {
      warned = true;
      console.warn("SESSION_KEY fehlt – Session-Schlüssel wird aus ROOMS abgeleitet (für Produktion SESSION_KEY setzen)");
    }
    keyRaw = raw;
    keyPromise = crypto.subtle
      .digest("SHA-256", enc.encode(raw))
      .then((d) => crypto.subtle.importKey("raw", d, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
  }
  return keyPromise;
}

const b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function unb64u(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function message(env: Env, room: string, exp: number): Promise<Uint8Array | null> {
  const digest = await roomDigest(env, room);
  if (!digest) return null;
  return enc.encode(`v1|${room}|${exp}|${hex(digest)}`);
}

export async function createSession(env: Env, room: string, days = SESSION_DAYS): Promise<{ value: string; exp: number }> {
  const exp = Date.now() + days * 86_400_000;
  const msg = await message(env, room, exp);
  if (!msg) throw new Error("unknown room");
  const sig = await crypto.subtle.sign("HMAC", await key(env), msg);
  return { value: `${room}.${exp}.${b64u(sig)}`, exp };
}

/** Raum aus gültigem Session-Cookie, sonst null */
export async function sessionRoom(env: Env, req: Request): Promise<string | null> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const [room, expStr, sig] = m[1].split(".");
  const exp = Number(expStr);
  if (!room || !ROOM_CODE_RE.test(room) || !Number.isFinite(exp) || exp < Date.now() || !sig) return null;
  const sigBytes = unb64u(sig);
  const msg = await message(env, room, exp);
  if (!sigBytes || !msg) return null;
  return (await crypto.subtle.verify("HMAC", await key(env), sigBytes, msg)) ? room : null;
}

export function sessionCookie(req: Request, value: string, maxAgeS: number | null): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  const age = maxAgeS === null ? "" : `; Max-Age=${maxAgeS}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}${age}`;
}
