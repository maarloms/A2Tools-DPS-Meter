// AION2 Gruppen-Meter – Dashboard (Vanilla JS, ES-Module, kein Build-Schritt)
// Einstieg: Login, WebSocket (Live), Routing. Protokoll: siehe PROTOCOL.md

import { $, currentRoute, esc, loadMembers, state, view } from "./js/core.js";
import { renderLive } from "./js/live.js";
import { drawCharts, loadFight, loadFights, renderFights } from "./js/fights.js";
import { loadRanks, loadTrends } from "./js/stats.js";
import { loadTimer } from "./js/timer.js";

const CREDS_KEY = "a2dps.creds";

// ---------- Zugangsdaten ----------

function loadCreds() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const c = JSON.parse(store.getItem(CREDS_KEY) || "null");
      if (c?.room && c?.secret) return c;
    } catch {
      /* Speicher gesperrt */
    }
  }
  return null;
}
function saveCreds(room, secret, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(CREDS_KEY, JSON.stringify({ room, secret }));
  } catch {
    /* privates Fenster – gilt dann nur für diese Sitzung */
  }
}
function clearCreds() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(CREDS_KEY);
    } catch {
      /* egal */
    }
  }
}

// ---------- WebSocket ----------

function setStatus(kind, text) {
  $("#status").innerHTML = `<span class="dot ${kind}"></span><span>${esc(text)}</span>`;
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
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${encodeURIComponent(state.room)}/ws`);
  state.ws = ws;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ t: "hello", v: 1, role: "viewer", secret: state.secret, name: "Dashboard" }));
  });
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
      setStatus("on", "Live");
      clearInterval(state.pingTimer);
      state.pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
    } else if (m.t === "group") {
      state.group = m;
      if (route === "live") renderLive();
    } else if (m.t === "fight") {
      state.bosses = null; // Bestwerte neu laden
      if (state.fights) {
        state.fights = [listEntry(m.fight), ...state.fights.filter((f) => f.id !== m.fight.id)];
        if (route === "fights") renderFights();
      }
    } else if (m.t === "fightDeleted") {
      if (state.fights) state.fights = state.fights.filter((f) => f.id !== m.id);
      if (route === "fights") renderFights();
    } else if (m.t === "error" && (m.code === "hello_timeout" || m.code === "replaced")) {
      ws.close();
    }
  });
  ws.addEventListener("close", (e) => {
    if (state.ws !== ws) return;
    clearInterval(state.pingTimer);
    if (e.code === 4001 && !state.welcomed && e.reason === "unauthorized") {
      logout("Raum-Code oder Secret stimmt nicht.");
      return;
    }
    const wait = Math.min(30000, 1000 * 2 ** state.retry++);
    setStatus("off", `Getrennt – neuer Versuch in ${Math.round(wait / 1000)} s`);
    state.retryTimer = setTimeout(connect, wait);
  });
}

/** fight-Event (Zusammenfassung) → Format der Kampfliste */
const listEntry = (s) => ({ ...s, top: s.top || [], uploaders: s.uploaders || [] });

// ---------- Routing ----------

function route() {
  // Einladungslink: #/join/<raum>/<secret> – das Fragment geht nie an den Server.
  const join = /^#\/join\/([a-z0-9][a-z0-9-]{2,31})\/(.{16,256})$/.exec(location.hash);
  if (join) {
    saveCreds(join[1], decodeURIComponent(join[2]), true);
    history.replaceState(null, "", "#/live");
    start();
    return;
  }
  if (!state.room) return renderLogin();
  const r = currentRoute();
  const navName = r.name === "fight" ? "fights" : r.name;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === navName;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (r.name === "live") renderLive();
  else if (r.name === "fights") loadFights();
  else if (r.name === "fight") loadMembers().catch(() => null).then(() => loadFight(r.id));
  else if (r.name === "ranks") loadRanks(r.tab);
  else if (r.name === "trends") loadTrends();
  else if (r.name === "timer") loadTimer();
  window.scrollTo(0, 0);
}

// ---------- Login ----------

function renderLogin(message = "") {
  $("#topbar").hidden = true;
  view.replaceChildren($("#tplLogin").content.cloneNode(true));
  $("#loginErr").textContent = message;
  const form = $("#loginForm");
  form.room.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const room = form.room.value.trim().toLowerCase();
    const secret = form.secret.value;
    $("#loginErr").textContent = "";
    const r = await fetch(`/api/rooms/${encodeURIComponent(room)}/fights?limit=1`, {
      headers: { authorization: `Bearer ${secret}` },
    }).catch(() => null);
    if (!r) return void ($("#loginErr").textContent = "Server nicht erreichbar.");
    if (r.status === 401 || r.status === 404) return void ($("#loginErr").textContent = "Raum-Code oder Secret stimmt nicht.");
    saveCreds(room, secret, form.remember.checked);
    start();
  });
}

function logout(message = "") {
  clearCreds();
  clearTimeout(state.retryTimer);
  clearInterval(state.pingTimer);
  const ws = state.ws;
  state.ws = null;
  try {
    ws?.close();
  } catch {
    /* egal */
  }
  Object.assign(state, { room: "", secret: "", group: null, fights: null, next: null, detail: null, bosses: null, members: null });
  if (location.hash !== "#/live") history.replaceState(null, "", "#/live");
  renderLogin(message);
}
state.onLogout = logout;

function start() {
  const c = loadCreds();
  if (!c) return renderLogin();
  state.room = c.room;
  state.secret = c.secret;
  $("#topbar").hidden = false;
  $("#roomChip").textContent = `Raum ${c.room}`;
  connect();
  route();
}

// ---------- Start ----------

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const r = currentRoute().name;
    if (r === "fight" && state.detail) drawCharts();
    if (r === "trends") state.redrawTrends?.();
  }, 150);
});
window.addEventListener("hashchange", route);
$("#logout").addEventListener("click", () => logout());
// Relative Zeiten ("vor 2 min") aktuell halten
setInterval(() => state.room && currentRoute().name === "live" && state.group && renderLive(), 5000);

if (/^#\/join\//.test(location.hash)) route();
else start();
