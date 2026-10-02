import { eventState, countdown } from "./schedule.js";
const $ = id => document.getElementById(id);
const native = window.__TAURI__;
let data, preferences, locked = false, writeQueue = Promise.resolve(), signature = "";
const time = new Intl.DateTimeFormat("de-DE", { timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit" });
const clock = new Intl.DateTimeFormat("de-DE", { timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit", second:"2-digit" });
const defaultPreferences = { enabled:[], offset:0, opacity:88 };
function message(text) { $("error").textContent = text; $("error").hidden = false; }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
async function save() {
  const value = JSON.stringify(preferences);
  writeQueue = writeQueue.catch(() => {}).then(() => native
    ? native.core.invoke("update_settings", { key:"fork.timer.preferences", value })
    : localStorage.setItem("fork.timer.preferences", value));
  try { await writeQueue; } catch { message("Einstellungen konnten nicht gespeichert werden."); }
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
      note.textContent = "Zeiten für EU noch unbestätigt.";
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
  $("filters").setAttribute("aria-expanded", String(show));
}
function render() {
  const now = Date.now();
  $("clock").textContent = clock.format(now);
  const selected = data.events.filter(e => preferences.enabled.includes(e.id))
    .map(event => ({ event, state:eventState(event, now, preferences.offset) }));
  // Recreate rows only when order/state changes, not every second: the user
  // keeps their scroll position and screen readers aren't flooded.
  const groups = [...new Set(data.events.map(e => e.category))];
  const rows = groups.flatMap(category => selected.filter(x => x.event.category === category)
    .sort((a,b) => a.state.remaining - b.state.remaining));
  const nextSignature = JSON.stringify(rows.map(x => [x.event.id,x.state.active,x.state.remaining <= 300000]));
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
  for (const {event,state} of rows) {
    const row = $("events").querySelector('[data-id="' + event.id + '"]');
    row.querySelector(".countdown").textContent = countdown(state.remaining);
    row.querySelector(".meta").textContent = (state.active ? "Portal offen bis " + time.format(state.end)
      : "Start " + time.format(state.start)) + (event.confirmed ? "" : " · unbestätigt");
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
    preferences.enabled = [...new Set(preferences.enabled.filter(id => data.events.some(e => e.id === id)))];
    preferences.offset = Math.max(-180, Math.min(180, Number(preferences.offset) || 0));
    preferences.opacity = Math.max(35, Math.min(100, Number(preferences.opacity) || 88));
    applyAppearance(settings); buildFilters();
    $("offset").value = preferences.offset; $("opacity").value = preferences.opacity;
    $("opacity-value").value = preferences.opacity + " %";
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
        locked = !locked; filterPanel(false);
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
    render(); setInterval(render, 1000);
  } catch(e) { message("Timer konnte nicht geladen werden: " + e.message); }
}
boot();