import { eventState, respawnState, countdown } from "./schedule.js";
const $ = id => document.getElementById(id);
const native = window.__TAURI__;
let data, preferences, locked = false, writeQueue = Promise.resolve(), signature = "";
// Field boss timers by mob code (src-tauri/src/fork/bosses.rs) and the boss
// whose entry panel is open.
const bosses = new Map();
let openBoss = null;
const time = new Intl.DateTimeFormat("de-DE", { timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit" });
const clock = new Intl.DateTimeFormat("de-DE", { timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit", second:"2-digit" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Berlin" });
const weekday = new Intl.DateTimeFormat("de-DE", { timeZone:"Europe/Berlin", weekday:"short" });
// "21:30" today, "Sa 21:30" on any other day.
function when(ms, now) {
  const t = time.format(ms);
  return dayKey.format(ms) === dayKey.format(now) ? t : weekday.format(ms).replace(".", "") + " " + t;
}
const defaultPreferences = { enabled:[], offset:0, opacity:88, alarm:0, layout:"portrait" };
const alarmed = new Set();
let alarmsPrimed = false;
function message(text) { $("error").textContent = text; $("error").hidden = false; }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
async function save() {
  const value = JSON.stringify(preferences);
  writeQueue = writeQueue.catch(() => {}).then(() => native
    ? native.core.invoke("update_settings", { key:"fork.timer.preferences", value })
    : localStorage.setItem("fork.timer.preferences", value));
  try { await writeQueue; } catch { message("Einstellungen konnten nicht gespeichert werden."); }
}
// A short two-note chime, synthesized so no sound file has to ship.
function chime() {
  try {
    const ctx = new AudioContext();
    for (const [freq, at] of [[880, 0], [1320, 0.18]]) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.65);
    }
    setTimeout(() => ctx.close(), 1200);
  } catch (e) { console.error("Timer chime:", e); }
}
// Once per start, when an event enters the alarm window. Events already
// inside it when the timer opens or the setting changes stay quiet.
function checkAlarms(rows) {
  const lead = preferences.alarm * 60000;
  if (!lead) return;
  let ring = false;
  for (const {event, state} of rows) {
    if (state.active || state.remaining > lead) continue;
    const key = event.id + ":" + state.start;
    if (!alarmed.has(key)) { alarmed.add(key); ring = alarmsPrimed; }
  }
  alarmsPrimed = true;
  if (ring) chime();
}
// Landscape: one flat strip of events. The window keeps a size per layout;
// the first switch sizes the strip to the selected events.
function applyLayout() {
  $("timer").classList.toggle("landscape", preferences.layout === "landscape");
}
async function setLayout(landscape) {
  preferences.layout = landscape ? "landscape" : "portrait";
  applyLayout(); signature = ""; render();
  const count = Math.max(1, preferences.enabled.length);
  const size = landscape ? { width: Math.min(1400, Math.max(320, 60 + 132 * count)), height: 78 } : { width: 320, height: 260 };
  if (native) await native.core.invoke("set_timer_layout", { landscape, ...size }).catch(e => console.error("Timer layout:", e));
  await save();
}
function applyAppearance(settings) {
  document.documentElement.dataset.theme = settings["dpsMeter.theme"] || "aion2";
  document.documentElement.style.setProperty("--timer-opacity", preferences.opacity / 100);
}
function updateFilters() {
  for (const input of $("options").querySelectorAll("input[data-event]")) {
    input.checked = preferences.enabled.includes(input.dataset.event);
  }
  for (const input of $("options").querySelectorAll("input[data-category]")) {
    const events = data.events.filter(e => e.category === input.dataset.category);
    const selected = events.filter(e => preferences.enabled.includes(e.id)).length;
    input.checked = selected === events.length;
    input.indeterminate = selected > 0 && selected < events.length;
    $("options").querySelectorAll("[data-count]").forEach(el => { if (el.dataset.count === input.dataset.category) el.textContent = selected + "/" + events.length; });
  }
  $("selection-count").textContent = preferences.enabled.length + " aktiv";
}
function buildFilters() {
  const categories = [...new Set(data.events.map(e => e.category))];
  for (const [index, category] of categories.entries()) {
    const events = data.events.filter(e => e.category === category);
    const section = document.createElement("section");
    section.className = "eventCategory";
    const header = document.createElement("div"); header.className = "categoryHead";
    const disclosure = document.createElement("button"); disclosure.className = "categoryDisclosure";
    const panelId = "category-" + index;
    disclosure.setAttribute("aria-controls", panelId);
    disclosure.setAttribute("aria-expanded", String(index === 0));
    disclosure.innerHTML = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
    const title = document.createElement("span"); title.textContent = category;
    const count = document.createElement("span"); count.className = "categoryCount"; count.dataset.count = category;
    disclosure.append(title, count);
    const toggle = document.createElement("label"); toggle.className = "toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.dataset.category = category;
    checkbox.setAttribute("aria-label", "Alle Events: " + category);
    const track = document.createElement("span"); track.className = "toggleTrack"; track.setAttribute("aria-hidden","true");
    toggle.append(checkbox,track); header.append(disclosure,toggle);
    const list = document.createElement("div"); list.className = "categoryEvents"; list.id = panelId; list.hidden = index !== 0;
    disclosure.addEventListener("click", () => {
      list.hidden = !list.hidden;
      disclosure.setAttribute("aria-expanded", String(!list.hidden));
    });
    checkbox.addEventListener("change", async () => {
      const ids = events.map(e => e.id);
      preferences.enabled = preferences.enabled.filter(id => !ids.includes(id));
      if (checkbox.checked) preferences.enabled.push(...ids);
      updateFilters(); render(); await save();
    });
    if (events.some(e => !e.confirmed)) {
      const note = document.createElement("p"); note.className = "categoryNote";
      note.textContent = "Zeiten aus den Global-Clientdaten, ingame noch nicht geprüft.";
      list.append(note);
    }
    for (const event of events) {
      const row = document.createElement("label"); row.className = "eventChoice"; row.title = event.note;
      const name = document.createElement("span"); name.className = "choiceName"; name.textContent = event.name;
      const control = document.createElement("span"); control.className = "toggle";
      const input = document.createElement("input"); input.type = "checkbox"; input.dataset.event = event.id;
      const track = document.createElement("span"); track.className = "toggleTrack"; track.setAttribute("aria-hidden","true");
      control.append(input, track); row.append(name, control); list.append(row);
      input.addEventListener("change", async () => {
        preferences.enabled = preferences.enabled.filter(id => id !== event.id);
        if (input.checked) preferences.enabled.push(event.id);
        updateFilters(); render(); await save();
      });
    }
    section.append(header,list); $("options").append(section);
  }
  updateFilters();
}
function settingsTab(id, focus = false) {
  for (const name of ["events", "appearance"]) {
    const selected = name === id;
    const tab = $(name + "-tab");
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(name + "-panel").hidden = !selected;
    if (selected && focus) tab.focus();
  }
}function filterPanel(show) {
  if (native) native.core.invoke("resize_timer_settings", {open:show}).catch(e => console.error("Timer settings size:", e));
  $("settings").hidden = !show; $("events").hidden = show;
  $("timer").classList.toggle("settingsOpen", show);
  $("filters").setAttribute("aria-expanded", String(show));
}
function bossTimer(event) {
  return event.mobCodes.map(code => bosses.get(code)).filter(Boolean)
    .sort((a, b) => b.updated - a.updated)[0];
}
function stateOf(event, now) {
  return event.kind === "respawn" ? respawnState(event, bossTimer(event), now)
    : eventState(event, now, preferences.offset);
}
function bossText(event, state, now) {
  const by = state.by ? " · " + state.by : "";
  switch (state.status) {
    case "alive": return ["da", "Gesichtet " + when(state.seen, now) + by];
    case "due": return ["fällig", "Respawn seit " + when(state.respawn, now) + by];
    case "waiting": return [countdown(state.remaining), "Respawn " + (state.estimated ? "~" : "") + when(state.respawn, now) + by];
    case "killed": return ["+" + countdown(now - state.killed), "Getötet " + when(state.killed, now) + " · Takt noch offen" + by];
    default: return ["—", event.zone + " · noch kein Kill"];
  }
}
// "10:45" (mm:ss), "1:10:45" (h:mm:ss) or "45" (minutes), as on the map.
function parseCountdown(text) {
  const parts = String(text).trim().split(":").map(p => p.trim());
  if (!parts.length || parts.length > 3 || parts.some(p => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  const seconds = n.length === 1 ? n[0] * 60 : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  return seconds <= 48 * 3600 ? seconds * 1000 : null;
}
function showBossPanel(id) {
  openBoss = id;
  const event = data.events.find(e => e.id === id);
  $("boss-panel").hidden = !event;
  if (!event) return;
  $("boss-name").textContent = event.name + " · " + event.zone;
  $("boss-spawn").value = "";
  const state = stateOf(event, Date.now());
  $("boss-interval").textContent = state.interval ? "Takt " + Math.floor(state.interval / 60) + ":" + String(state.interval % 60).padStart(2, "0") + " h" : "Takt unbekannt";
}
async function bossAction(action, ms) {
  const event = data.events.find(e => e.id === openBoss);
  if (!event || !native) { message("Feldboss-Timer gehen nur in der Desktop-App."); return; }
  try {
    await native.core.invoke("set_field_boss", { code: event.mobCodes[0], action, ms: ms ?? null });
    showBossPanel(null);
  } catch (e) { message("Feldboss konnte nicht gespeichert werden: " + e); }
}
function render() {
  const now = Date.now();
  $("clock").textContent = clock.format(now);
  const selected = data.events.filter(e => preferences.enabled.includes(e.id))
    .map(event => ({ event, state:stateOf(event, now) }));
  // Recreate rows only when order/state changes, not every second: the user
  // keeps their scroll position and screen readers aren't flooded.
  const groups = [...new Set(data.events.map(e => e.category))];
  const rows = groups.flatMap(category => selected.filter(x => x.event.category === category)
    .sort((a,b) => a.state.remaining - b.state.remaining));
  const nextSignature = JSON.stringify(rows.map(x => [x.event.id,x.state.active,x.state.remaining <= 300000,x.state.status]));
  if (nextSignature !== signature) {
    signature = nextSignature; $("events").replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p"); empty.className = "empty";
      empty.textContent = "Keine Events ausgewählt. Öffne die Filter über das Zahnrad.";
      $("events").append(empty);
    }
    let category;
    for (const {event,state} of rows) {
      if (category !== event.category) {
        category = event.category;
        const title = document.createElement("h2"); title.className = "group"; title.textContent = category;
        $("events").append(title);
      }
      const row = document.createElement("div"); row.className = "event"; row.dataset.id = event.id; row.title = event.note;
      if (event.kind === "respawn") {
        row.classList.add("boss", state.status); row.tabIndex = 0;
        row.title = event.note + "\nKlicken: getötet oder Countdown von der Karte eintragen.";
        row.addEventListener("click", () => showBossPanel(openBoss === event.id ? null : event.id));
        row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); } });
      }
      if (state.active) row.classList.add("live");
      else if (state.remaining <= 300000) row.classList.add("soon");
      const dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden","true");
      const info = document.createElement("div"); info.className = "info";
      const name = document.createElement("div"); name.className = "name"; name.textContent = event.name;
      const meta = document.createElement("div"); meta.className = "meta";
      info.append(name,meta);
      const count = document.createElement("time"); count.className = "countdown";
      row.append(dot,info,count); $("events").append(row);
    }
  }
  checkAlarms(rows);
  for (const {event,state} of rows) {
    const row = $("events").querySelector('[data-id="' + event.id + '"]');
    if (event.kind === "respawn") {
      const [count, meta] = bossText(event, state, now);
      row.querySelector(".countdown").textContent = count;
      row.querySelector(".meta").textContent = meta;
      continue;
    }
    row.querySelector(".countdown").textContent = countdown(state.remaining);
    row.querySelector(".meta").textContent = (state.active ? (event.activeText || "Läuft bis") + " " + time.format(state.end)
      : "Start " + when(state.start, now)) + (event.confirmed ? "" : " · unbestätigt");
  }
}
async function boot() {
  try {
    const response = await fetch("/fork/events.json");
    if (!response.ok) throw new Error("Eventdaten fehlen");
    data = await response.json();
    const settings = native ? await native.core.invoke("get_settings") : {
      "fork.timer.preferences":localStorage.getItem("fork.timer.preferences")
    };
    const saved = parse(settings["fork.timer.preferences"], null);
    preferences = {...defaultPreferences, enabled:data.events.filter(e => e.enabled).map(e => e.id), ...saved};
    if (!Array.isArray(preferences.enabled)) preferences.enabled = data.events.filter(e => e.enabled).map(e => e.id);
    // Preserve selections when old individual minigame timers become their
    // actual shared Global activity. These variants do not have fixed slots.
    const legacyMinigames = ["track","nyerk","lugi","up","shugo","goldrin"];
    if (preferences.enabled.some(id => legacyMinigames.includes(id))) preferences.enabled.push("shugofesta");
    if (preferences.enabled.includes("beritra")) preferences.enabled.push("invasion");
    // The grouped Reshanta boss entries became one entry per boss.
    if (preferences.enabled.includes("siege-bosses-lower")) preferences.enabled.push("executor-tamasa", "executor-agro", "executor-kaira");
    if (preferences.enabled.includes("siege-bosses-middle")) preferences.enabled.push("dhramos", "ducal", "maraka");
    // Events added in an update start with their default, even for users who
    // already saved a selection. Saves before `known` existed knew these three.
    const known = Array.isArray(preferences.known) ? preferences.known
      : saved ? ["rift", "shugofesta", "invasion"] : data.events.map(e => e.id);
    preferences.enabled.push(...data.events.filter(e => e.enabled && !known.includes(e.id)).map(e => e.id));
    preferences.known = data.events.map(e => e.id);
    preferences.enabled = [...new Set(preferences.enabled.filter(id => data.events.some(e => e.id === id)))];
    preferences.offset = Math.max(-180, Math.min(180, Number(preferences.offset) || 0));
    preferences.opacity = Math.max(35, Math.min(100, Number(preferences.opacity) || 88));
    preferences.alarm = [0, 1, 3, 5, 10].includes(Number(preferences.alarm)) ? Number(preferences.alarm) : 0;
    preferences.layout = preferences.layout === "landscape" ? "landscape" : "portrait";
    applyLayout();
    applyAppearance(settings); buildFilters();
    $("offset").value = preferences.offset; $("opacity").value = preferences.opacity;
    $("opacity-value").value = preferences.opacity + " %";
    $("alarm").value = String(preferences.alarm);
    $("landscape").checked = preferences.layout === "landscape";
    $("landscape").addEventListener("change", e => setLayout(e.target.checked));
    $("alarm").addEventListener("change", async e => {
      preferences.alarm = Number(e.target.value) || 0;
      alarmed.clear(); alarmsPrimed = false; render(); await save();
    });
    $("alarm-test").addEventListener("click", chime);
    for (const id of ["events","appearance"]) {
      $(id + "-tab").addEventListener("click", () => settingsTab(id));
      $(id + "-tab").addEventListener("keydown", e => {
        if (["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) {
          e.preventDefault();
          settingsTab(e.key === "Home" ? "events" : e.key === "End" ? "appearance" : id === "events" ? "appearance" : "events", true);
        }
      });
    }
    for (const [id, step] of [["offset-minus",-1],["offset-plus",1]]) {
      $(id).addEventListener("click", () => {
        $("offset").value = Math.max(-180, Math.min(180, (Number($("offset").value) || 0) + step));
        $("offset").dispatchEvent(new Event("change"));
      });
    }
    $("filters").addEventListener("click", () => filterPanel($("settings").hidden));
    $("done").addEventListener("click", () => filterPanel(false));
    $("offset").addEventListener("change", async e => {
      preferences.offset = Math.max(-180, Math.min(180, Number(e.target.value) || 0));
      e.target.value = preferences.offset; signature=""; render(); await save();
    });
    $("opacity").addEventListener("input", async e => {
      preferences.opacity = Number(e.target.value); $("opacity-value").value = preferences.opacity + " %"; applyAppearance(settings); await save();
    });
    $("drag").addEventListener("mousedown", e => {
      if (e.button === 0 && !e.target.closest("button") && native)
        native.window.getCurrentWindow().startDragging().catch(() => message("Fenster konnte nicht verschoben werden."));
    });
    $("close").addEventListener("click", () => {
      if (native) native.core.invoke("toggle_timer").catch(() => message("Timer konnte nicht ausgeblendet werden."));
    });
    $("lock").addEventListener("click", async () => {
      if (!native) { message("Die Fenstersperre funktioniert in der Desktop-App."); return; }
      try {
        await native.core.invoke("set_timer_locked", {locked:!locked});
        locked = !locked; filterPanel(false); showBossPanel(null);
        $("lock").setAttribute("aria-pressed", String(locked));
        $("footer").textContent = locked ? "Gesperrt · Strg+Alt+T zweimal zum Entsperren" : "Strg+Alt+T · Ein / Aus";
      } catch { message("Timer konnte nicht gesperrt werden."); }
    });
    window.addEventListener("timer-unlocked", () => {
      locked = false; $("lock").setAttribute("aria-pressed","false");
      $("footer").textContent = "Strg+Alt+T · Ein / Aus";
    });
    if (native) await native.event.listen("setting-changed", ({payload}) => {
      if (payload.key === "dpsMeter.theme") { settings[payload.key] = payload.value; applyAppearance(settings); }
    });
    if (native) {
      for (const t of await native.core.invoke("get_field_bosses").catch(() => [])) bosses.set(t.code, t);
      await native.event.listen("fork-boss-update", ({payload}) => {
        for (const t of payload?.timers || []) bosses.set(t.code, t);
        signature = ""; render();
      });
    }
    $("boss-kill").addEventListener("click", () => bossAction("kill"));
    $("boss-clear").addEventListener("click", () => bossAction("clear"));
    $("boss-close").addEventListener("click", () => showBossPanel(null));
    const submitSpawn = () => {
      const ms = parseCountdown($("boss-spawn").value);
      if (ms == null) { $("boss-spawn").focus(); $("boss-spawn").select(); return; }
      bossAction("spawnIn", ms);
    };
    $("boss-set").addEventListener("click", submitSpawn);
    $("boss-spawn").addEventListener("keydown", e => {
      if (e.key === "Enter") submitSpawn();
      else if (e.key === "Escape") showBossPanel(null);
    });
    render(); setInterval(render, 1000);
  } catch(e) { message("Timer konnte nicht geladen werden: " + e.message); }
}
boot();