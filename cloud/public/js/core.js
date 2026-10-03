// Gemeinsame Helfer: Zustand, Formatierung, Klassen, REST, kleine UI-Bausteine.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const view = document.getElementById("view");

export const state = {
  room: "",
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
  // Kämpfe-Filter
  killedOnly: false,
  withMe: false,
  dungeonFilter: "",
  bosses: null,
  detail: null,
  openEnc: new Set(),
  hiddenSeries: new Set(),
  members: null, // [{ name, lastSeen, fights, active }]
  fixedMembers: false,
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
  // Symbol wie im Spiel (shared/jobs/<id>.png, aus dem Meter); Faustkämpfer hat keins
  if (row) return { short: row[4], name: row[3], icon: row[0] <= 18 ? `shared/jobs/${row[0]}.png` : "" };
  if (!key || key === "Unknown" || key === "0") return { short: "–", name: "Klasse unbekannt", icon: "" };
  return { short: key.slice(0, 3).toUpperCase(), name: key, icon: "" };
}
export const jobTag = (j, id) => {
  const x = job(j, id);
  return x.icon
    ? `<span class="job icon" title="${esc(x.name)}"><img src="${x.icon}" alt="${esc(x.name)}"></span>`
    : `<span class="job" title="${esc(x.name)}">${esc(x.short)}</span>`;
};
export const MODES = { bossTargets: "Boss", allTargets: "Alle Ziele", groupTargets: "Gruppe", train: "Trainingspuppe" };
/** Dungeon-Namen (shared/dungeons.json, aus den Spieldaten des Meters); unbekannte als „Instanz <id>“ */
let dungeons = {};
export const loadDungeons = () =>
  fetch("shared/dungeons.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => (dungeons = d || {}))
    .catch(() => null);
export const dungeonName = (id) => dungeons[String(id)]?.name || `Instanz ${id}`;
export const bossLabel = (b) => `${b.boss}${b.dungeonId ? ` · ${dungeonName(b.dungeonId)}` : ""}`;

// Kategorische Palette für dunkle Flächen, geprüft gegen #0e1222 (CVD + Kontrast).
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

/** Farbe folgt dem Mitglied (alphabetisch), nie dem Rang */
export function memberColor(name) {
  const list = activeMembers().map((n) => n.toLowerCase()).sort();
  const i = list.indexOf(String(name).toLowerCase());
  return SERIES_COLORS[(i < 0 ? list.length : i) % SERIES_COLORS.length];
}
export const activeMembers = () => (state.members || []).filter((m) => m.active).map((m) => m.name);

// ---------- „Wer bist du?“ (nur Anzeige-Vorliebe, lokal) ----------

const ME_KEY = "a2dps.me";
export function getMe() {
  try {
    const me = localStorage.getItem(`${ME_KEY}.${state.room}`) || "";
    return activeMembers().find((n) => n.toLowerCase() === me.toLowerCase()) || "";
  } catch {
    return "";
  }
}
export function setMe(name) {
  try {
    localStorage.setItem(`${ME_KEY}.${state.room}`, name);
  } catch {
    /* privates Fenster */
  }
}

// ---------- REST (Session-Cookie, kein Secret im Browser) ----------

export class AuthError extends Error {}

export async function api(path, opts = {}) {
  const r = await fetch(`/api/rooms/${encodeURIComponent(state.room)}${path}`, { credentials: "same-origin", ...opts });
  if (r.status === 401) {
    location.replace("/");
    throw new AuthError("unauthorized");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
export const apiJson = async (path) => (await api(path)).json();

export async function loadBosses(force = false) {
  if (!state.bosses || force) state.bosses = (await apiJson("/stats/bosses")).bosses;
  return state.bosses;
}
export async function loadMembers(force = false) {
  if (!state.members || force) {
    const r = await apiJson("/members");
    state.members = r.members;
    state.fixedMembers = r.fixed;
  }
  return state.members;
}

export function currentRoute() {
  const h = location.hash || "#/start";
  let m;
  if ((m = /^#\/fight\/([0-9a-f]{16})\/vs\/([0-9a-f]{16})$/.exec(h))) return { name: "versus", a: m[1], b: m[2] };
  if ((m = /^#\/fight\/([0-9a-f]{16})$/.exec(h))) return { name: "fight", id: m[1] };
  if ((m = /^#\/me(?:\/(.+))?$/.exec(h))) return { name: "me", who: m[1] ? decodeURIComponent(m[1]) : "" };
  for (const n of ["overview", "compare", "fights", "live", "timer", "members", "start"]) if (h.startsWith(`#/${n}`)) return { name: n };
  return { name: "start" };
}

// ---------- UI-Bausteine ----------

export const empty = (title, text = "") => `<div class="empty"><b>${esc(title)}</b><p>${text}</p></div>`;
export const loading = (what) => `<div class="page"><div class="empty muted"><p>Lade ${esc(what)} …</p></div></div>`;

export function failed(e, what) {
  if (e instanceof AuthError) return;
  view.innerHTML = `<div class="page">${empty("Das hat nicht geklappt", `${esc(what)} konnte nicht geladen werden. Bitte später noch einmal versuchen.`)}</div>`;
}

export const pageHead = (title, sub = "", right = "") =>
  `<header class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>${right ? `<div class="head-right">${right}</div>` : ""}</header>`;

export const kpi = (label, value, sub = "", cls = "") =>
  `<div class="kpi ${cls}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;

/** Trend gegenüber Vorperiode: Pfeil + Prozent (nicht nur Farbe) */
export function trend(now, prev, what = "Vorwoche") {
  if (!now || !prev) return `<span class="trend flat" title="Noch kein Vergleichswert">–</span>`;
  const d = ((now - prev) / prev) * 100;
  if (Math.abs(d) < 1) return `<span class="trend flat" title="wie ${what}">→ ±0 %</span>`;
  return d > 0
    ? `<span class="trend up" title="besser als ${what}">▲ +${nf0.format(d)} %</span>`
    : `<span class="trend down" title="schwächer als ${what}">▼ −${nf0.format(-d)} %</span>`;
}

export const avatar = (name, j, id) => {
  const x = job(j, id);
  return `<span class="avatar${x.icon ? " icon" : ""}" style="--c:${memberColor(name)}" title="${esc(x.name)}">${
    x.icon ? `<img src="${x.icon}" alt="${esc(x.name)}">` : esc(x.short)
  }</span>`;
};

export const PERIODS = [
  [7, "7 Tage"],
  [30, "30 Tage"],
  [90, "90 Tage"],
  [0, "Gesamt"],
];
export const periodSelect = (id, value, list = PERIODS) =>
  `<select class="select" id="${id}" aria-label="Zeitraum">${list.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;

export function bossSelect(id, value, allLabel = "Alle Bosse") {
  return `<select class="select" id="${id}" aria-label="Boss"><option value="">${esc(allLabel)}</option>${(state.bosses || [])
    .map((b) => `<option value="${esc(b.key)}" ${b.key === value ? "selected" : ""}>${esc(bossLabel(b))}</option>`)
    .join("")}</select>`;
}

/** Bucket-Label "2026-09-29" / "2026-W39" */
export function periodLabel(p, bucket) {
  if (bucket === "fight") {
    const d = new Date(Number(p));
    const two = (n) => String(n).padStart(2, "0");
    return `${two(d.getDate())}.${two(d.getMonth() + 1)}. ${two(d.getHours())}:${two(d.getMinutes())}`;
  }
  if (bucket === "week") return `KW ${Number(p.split("-W")[1])}`;
  const [, m, d] = p.split("-");
  return `${d}.${m}.`;
}
export const tz = () => String(-new Date().getTimezoneOffset());

/** Zeitreihen-Punkte (API series.points) → Linien je Mitglied für lineChart */
export function seriesLines(points, metric) {
  const periods = [...new Set(points.map((p) => p.period))].sort();
  const idx = new Map(periods.map((p, i) => [p, i]));
  const by = new Map();
  for (const p of points) {
    const k = p.player.toLowerCase();
    if (!by.has(k)) by.set(k, { id: p.player, name: p.player, color: memberColor(p.player), pts: [] });
    by.get(k).pts.push({ x: idx.get(p.period), y: p[metric] });
  }
  const lines = [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const l of lines) l.pts.sort((a, b) => a.x - b.x);
  return { periods, lines };
}
