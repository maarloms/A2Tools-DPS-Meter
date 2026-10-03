// Gemeinsame Helfer: Zustand, Formatierung, Klassen, REST-Zugriff.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const view = document.getElementById("view");

export const state = {
  room: "",
  secret: "",
  ws: null,
  welcomed: false,
  retry: 0,
  retryTimer: null,
  pingTimer: null,
  group: null,
  fights: null,
  next: null,
  train: false,
  query: "",
  bossFilter: "",
  bosses: null,
  detail: null,
  openEnc: new Set(),
  hiddenSeries: new Set(),
  members: null,
  onLogout: null,
};

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtNum = (n) => nf0.format(Math.round(n || 0));
export function fmtShort(n) {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return nf1.format(n / 1e9) + " B";
  if (a >= 1e6) return nf1.format(n / 1e6) + " M";
  if (a >= 1e4) return nf1.format(n / 1e3) + " k";
  return nf0.format(Math.round(n));
}
export const fmtPct = (n) => nf1.format(n || 0) + " %";
export function fmtTime(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
export const fmtDate = (ms) => dateFmt.format(new Date(ms));
export const fmtDay = (ms) => dayFmt.format(new Date(ms));
export function ago(ts) {
  if (!ts) return "–";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return "gerade";
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 172800) return `vor ${Math.round(s / 3600)} h`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}
export const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Klassen: App liefert koreanische Namen (PersonalData.job) oder IDs 11–19 (FightRecord.jobId)
const JOBS = [
  [11, "검성", "GLADIATOR", "Gladiator", "GLA"],
  [12, "수호성", "TEMPLAR", "Templer", "TEM"],
  [13, "살성", "ASSASSIN", "Assassine", "ASN"],
  [14, "궁성", "RANGER", "Waldläufer", "WAL"],
  [15, "마도성", "SORCERER", "Magier", "MAG"],
  [16, "정령성", "ELEMENTALIST", "Beschwörer", "BES"],
  [17, "치유성", "CLERIC", "Kleriker", "KLE"],
  [18, "호법성", "CHANTER", "Kantor", "KAN"],
  [19, "권성", "FIGHTER", "Faustkämpfer", "FAU"],
];
export function job(j, id) {
  const key = String(j ?? "").trim();
  const up = key.toUpperCase();
  const row =
    (id ? JOBS.find((r) => r[0] === Number(id)) : null) ||
    JOBS.find((r) => r[1] === key || r[2] === up || r[3].toUpperCase() === up || String(r[0]) === key);
  if (row) return { short: row[4], name: row[3] };
  if (!key || key === "Unknown" || key === "0") return { short: "–", name: "Unbekannt" };
  return { short: key.slice(0, 3).toUpperCase(), name: key };
}
export const jobTag = (j, id) => {
  const x = job(j, id);
  return `<span class="job" title="${esc(x.name)}">${esc(x.short)}</span>`;
};
export const MODES = { bossTargets: "Boss", allTargets: "Alle Ziele", groupTargets: "Gruppe", train: "Trainingspuppe" };
export const bossLabel = (b) => `${b.boss}${b.dungeonId ? ` · Instanz ${b.dungeonId}` : ""}`;

// Kategorische Palette für dunkle Flächen, geprüft gegen #0e1222 (CVD + Kontrast).
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

// ---------- REST ----------

export class AuthError extends Error {}

export async function api(path, opts = {}) {
  const r = await fetch(`/api/rooms/${encodeURIComponent(state.room)}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${state.secret}`, ...(opts.headers || {}) },
  });
  if (r.status === 401) {
    state.onLogout?.("Raum-Code oder Secret stimmt nicht.");
    throw new AuthError("unauthorized");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
export const apiJson = async (path) => (await api(path)).json();

/** Bossliste (für Filter) einmal laden und merken */
export async function loadBosses(force = false) {
  if (!state.bosses || force) state.bosses = (await apiJson("/stats/bosses")).bosses;
  return state.bosses;
}
export async function loadMembers(force = false) {
  if (!state.members || force) state.members = (await apiJson("/members")).members;
  return state.members;
}

export function currentRoute() {
  const h = location.hash || "#/live";
  let m;
  if ((m = /^#\/fight\/([0-9a-f]{16})$/.exec(h))) return { name: "fight", id: m[1] };
  if (h.startsWith("#/fights")) return { name: "fights" };
  if (h.startsWith("#/ranks")) return { name: "ranks", tab: (/^#\/ranks\/(\w+)/.exec(h) || [])[1] || "boss" };
  if (h.startsWith("#/trends")) return { name: "trends" };
  if (h.startsWith("#/timer")) return { name: "timer" };
  return { name: "live" };
}

export const empty = (title, text = "") => `<div class="card empty"><b>${esc(title)}</b>${text}</div>`;
export const loading = (what) => empty(`Lade ${what} …`);

/** Fehler beim Laden anzeigen (401 → Login übernimmt) */
export function failed(e, what) {
  if (e instanceof AuthError) return;
  view.innerHTML = empty("Fehler", `${esc(what)} konnte nicht geladen werden.`);
}
