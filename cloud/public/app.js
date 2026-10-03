// AION 2 DPS Meter – Dashboard (Vanilla JS, ES-Module, kein Build-Schritt).
// Dieses Skript wird nur mit gültiger Session ausgeliefert (Cookie, siehe src/session.ts).
// Einstieg: Session, Navigation, WebSocket (Live), Routing.

import { $, currentRoute, esc, getMe, loadMembers, state, view } from "./js/core.js";
import { renderStart } from "./js/start.js";
import { loadOverview, refreshOverviewLive } from "./js/overview.js";
import { loadMe } from "./js/me.js";
import { loadCompare } from "./js/compare.js";
import { drawCharts, loadFight, loadFights } from "./js/fights.js";
import { renderLive } from "./js/live.js";
import { loadTimer } from "./js/timer.js";
import { loadMembersPage } from "./js/members.js";

// ---------- Navigation ----------

const ICONS = {
  start: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  overview: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  compare: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  fights: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  live: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  members: '<circle cx="9" cy="9" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 5.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.5 2.3 3.5 5.2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4"/>',
};
const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

const NAV = [
  ["start", "Start", "#/start"],
  ["overview", "Übersicht", "#/overview"],
  ["me", "Mein Bereich", "#/me"],
  ["compare", "Vergleich", "#/compare"],
  ["fights", "Kämpfe", "#/fights"],
  ["live", "Live", "#/live"],
  ["timer", "Event-Timer", "#/timer"],
  ["members", "Mitglieder", "#/members"],
];
const BOTTOM = ["overview", "me", "compare", "fights", "live"];

function renderNav() {
  $("#nav").innerHTML = NAV.map(([k, label, href]) => `<a href="${href}" data-nav="${k}">${icon(k)}<span>${label}</span></a>`).join("");
  $("#bottomnav").innerHTML =
    NAV.filter(([k]) => BOTTOM.includes(k))
      .map(([k, label, href]) => `<a href="${href}" data-nav="${k}">${icon(k)}<span>${label === "Mein Bereich" ? "Ich" : label}</span></a>`)
      .join("") + `<button type="button" id="moreBtn" aria-expanded="false" aria-controls="sheet">${icon("more")}<span>Mehr</span></button>`;
  $("#sheet").innerHTML =
    NAV.filter(([k]) => !BOTTOM.includes(k))
      .map(([k, label, href]) => `<a href="${href}" data-nav="${k}">${icon(k)}<span>${label}</span></a>`)
      .join("") + `<button type="button" class="sheet-logout">${icon("logout")}<span>Abmelden</span></button>`;
  $("#moreBtn").addEventListener("click", () => toggleSheet());
  $(".sheet-logout").addEventListener("click", logout);
}
function toggleSheet(open) {
  const sheet = $("#sheet");
  const show = open ?? sheet.hidden;
  sheet.hidden = !show;
  $("#moreBtn")?.setAttribute("aria-expanded", String(show));
}
function markNav(name) {
  const key = name === "fight" ? "fights" : name;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === key;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const inSheet = !BOTTOM.includes(key);
  $("#moreBtn")?.classList.toggle("active", inSheet && key !== "start");
}
function renderWho() {
  const me = getMe();
  $("#whoami").innerHTML = me ? `Du bist <a href="#/me">${esc(me)}</a>` : `<a href="#/me">Wer bist du?</a>`;
}

// ---------- WebSocket (Live) ----------

function setStatus(kind, text) {
  const html = `<span class="dot ${kind}"></span><span>${esc(text)}</span>`;
  $("#status").innerHTML = html;
  $("#statusM").innerHTML = `<span class="dot ${kind}" title="${esc(text)}"></span>`;
}

function connect() {
  clearTimeout(state.retryTimer);
  try {
    state.ws?.close();
  } catch {
    /* egal */
  }
  state.welcomed = false;
  setStatus("wait", "Verbinde …");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // Anmeldung über das Session-Cookie (der Worker gibt den Socket frei) – kein Secret im Browser
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${encodeURIComponent(state.room)}/ws`);
  state.ws = ws;
  ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, role: "viewer", name: "Dashboard" })));
  ws.addEventListener("message", (e) => {
    if (e.data === "pong") return;
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    const route = currentRoute().name;
    if (m.t === "welcome") {
      state.welcomed = true;
      state.retry = 0;
      setStatus("on", "Live verbunden");
      clearInterval(state.pingTimer);
      state.pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
    } else if (m.t === "group") {
      state.group = m;
      if (route === "live") renderLive();
      if (route === "overview") refreshOverviewLive();
    } else if (m.t === "fight" || m.t === "fightDeleted") {
      state.bosses = null;
      state.fights = null;
      if (route === "fights") loadFights();
    } else if (m.t === "error" && (m.code === "hello_timeout" || m.code === "replaced")) {
      ws.close();
    }
  });
  ws.addEventListener("close", (e) => {
    if (state.ws !== ws) return;
    clearInterval(state.pingTimer);
    if (e.code === 4001 && !state.welcomed && e.reason === "unauthorized") {
      location.replace("/"); // Session abgelaufen
      return;
    }
    const wait = Math.min(30000, 1000 * 2 ** state.retry++);
    setStatus("off", `Getrennt – neuer Versuch in ${Math.round(wait / 1000)} s`);
    state.retryTimer = setTimeout(connect, wait);
  });
}

// ---------- Routing ----------

async function route() {
  // Einladungslink im angemeldeten Zustand: Raum wechseln
  const join = /^#\/join\/([a-z0-9][a-z0-9-]{2,31})\/(.{16,256})$/i.exec(location.hash);
  if (join) {
    history.replaceState(null, "", "/");
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: join[1].toLowerCase(), secret: decodeURIComponent(join[2]), remember: true }),
    });
    location.replace(r.ok ? "/#/start" : "/");
    location.reload();
    return;
  }
  toggleSheet(false);
  const r = currentRoute();
  markNav(r.name);
  if (r.name === "start") renderStart();
  else if (r.name === "overview") loadOverview();
  else if (r.name === "me") loadMe(r.who);
  else if (r.name === "compare") loadCompare();
  else if (r.name === "fights") loadFights();
  else if (r.name === "fight") loadFight(r.id);
  else if (r.name === "live") renderLive();
  else if (r.name === "timer") loadTimer();
  else if (r.name === "members") loadMembersPage();
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

async function logout() {
  await fetch("/api/session", { method: "DELETE" }).catch(() => null);
  location.replace("/");
}

async function start() {
  const r = await fetch("/api/session").catch(() => null);
  if (!r || !r.ok) return location.replace("/");
  state.room = (await r.json()).room;
  $("#roomChip").textContent = `Raum ${state.room}`;
  renderNav();
  loadMembers()
    .then(renderWho)
    .catch(() => null);
  connect();
  route();
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const n = currentRoute().name;
    if (n === "fight" && state.detail) drawCharts();
    if (n === "me" || n === "compare") route();
  }, 200);
});
window.addEventListener("hashchange", route);
document.addEventListener("me-changed", renderWho);
document.addEventListener("keydown", (e) => e.key === "Escape" && toggleSheet(false));
$("#logout").addEventListener("click", logout);
// „vor 2 min“ aktuell halten
setInterval(() => currentRoute().name === "live" && state.group && renderLive(), 5000);

start();
