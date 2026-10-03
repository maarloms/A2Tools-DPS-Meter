// Event-Timer – derselbe Plan wie im Overlay der App.
// events.json und schedule.js werden beim Build unverändert aus app/public/fork
// kopiert (scripts/sync-shared.mjs); hier wird nur importiert, nichts nachgebaut.

import { countdown, eventState } from "../shared/schedule.js";
import { $, $$, currentRoute, empty, esc, view } from "./core.js";

const KEY = "a2dps.timer";
const time = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short" });
const when = (ms, now) => {
  const t = time.format(ms);
  return dayKey.format(ms) === dayKey.format(now) ? t : weekday.format(ms).replace(".", "") + " " + t;
};

let data = null;
let prefs = null;
let tick = null;
let signature = "";
let showFilter = false;

function loadPrefs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    /* privates Fenster */
  }
  const defaults = data.events.filter((e) => e.enabled).map((e) => e.id);
  prefs = { enabled: Array.isArray(saved?.enabled) ? saved.enabled : defaults, offset: Number(saved?.offset) || 0 };
}
function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* nur für diese Sitzung */
  }
}

export async function loadTimer() {
  try {
    if (!data) {
      const r = await fetch("shared/events.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("events.json fehlt");
      data = await r.json();
    }
    if (!prefs) loadPrefs();
    signature = "";
    renderShell();
    clearInterval(tick);
    tick = setInterval(() => (currentRoute().name === "timer" ? renderRows() : clearInterval(tick)), 1000);
  } catch {
    view.innerHTML = empty("Timer nicht verfügbar", "Der Event-Plan (shared/events.json) fehlt – beim Build wird er aus app/public/fork kopiert.");
  }
}

function renderShell() {
  const cats = [...new Set(data.events.map((e) => e.category))];
  const filters = cats
    .map(
      (c) => `<fieldset class="tf"><legend>${esc(c)}</legend>${data.events
        .filter((e) => e.category === c)
        .map(
          (e) => `<label class="check"><input type="checkbox" data-id="${esc(e.id)}" ${prefs.enabled.includes(e.id) ? "checked" : ""}>
            ${esc(e.name)}${e.confirmed ? "" : ' <span class="meta">(unbestätigt)</span>'}</label>`,
        )
        .join("")}</fieldset>`,
    )
    .join("");
  view.innerHTML = `
    <article class="card timer">
      <div class="card-head"><h2>Event-Timer</h2><span class="clock num" id="tClock"></span></div>
      <p class="meta">Zeiten in deutscher Zeit (Europe/Berlin), gleicher Plan wie im Overlay der App.${prefs.offset ? ` Zeitkorrektur: ${prefs.offset > 0 ? "+" : ""}${prefs.offset} min.` : ""}</p>
      <div id="tEvents" class="tevents"></div>
      <p><button class="btn" id="tFilter" type="button" aria-expanded="${showFilter}">${showFilter ? "Filter schließen" : "Events auswählen"}</button></p>
      <div id="tSettings" ${showFilter ? "" : "hidden"}>
        <div class="tfilters">${filters}</div>
        <label class="field" style="max-width:220px"><span>Zeitkorrektur (Minuten)</span>
          <input type="number" id="tOffset" class="search" value="${prefs.offset}" min="-120" max="120" step="1"></label>
      </div>
    </article>`;
  $("#tFilter").addEventListener("click", () => {
    showFilter = !showFilter;
    renderShell();
  });
  $$("#tSettings input[type=checkbox]").forEach((c) =>
    c.addEventListener("change", () => {
      prefs.enabled = c.checked ? [...new Set([...prefs.enabled, c.dataset.id])] : prefs.enabled.filter((id) => id !== c.dataset.id);
      savePrefs();
      signature = "";
      renderRows();
    }),
  );
  $("#tOffset")?.addEventListener("change", (e) => {
    prefs.offset = Math.max(-120, Math.min(120, Math.round(Number(e.target.value) || 0)));
    savePrefs();
    signature = "";
    renderRows();
  });
  renderRows();
}

function renderRows() {
  const host = $("#tEvents");
  if (!host) return;
  const now = Date.now();
  $("#tClock").textContent = clock.format(now);
  const selected = data.events.filter((e) => prefs.enabled.includes(e.id)).map((event) => ({ event, st: eventState(event, now, prefs.offset) }));
  const cats = [...new Set(data.events.map((e) => e.category))];
  const rows = cats.flatMap((c) => selected.filter((x) => x.event.category === c).sort((a, b) => a.st.remaining - b.st.remaining));
  const sig = JSON.stringify(rows.map((x) => [x.event.id, x.st.active, x.st.remaining <= 300000]));
  if (sig !== signature) {
    signature = sig;
    let cat = null;
    host.innerHTML =
      rows
        .map(({ event, st }) => {
          const head = cat !== event.category ? `<h3 class="tgroup">${esc((cat = event.category))}</h3>` : "";
          const cls = st.active ? "live" : st.remaining <= 300000 ? "soon" : "";
          return `${head}<div class="tevent ${cls}" data-id="${esc(event.id)}" title="${esc(event.note || "")}">
            <span class="dot ${st.active ? "on" : cls === "soon" ? "wait" : ""}"></span>
            <div class="info"><div class="name">${esc(event.name)}</div><div class="meta tmeta"></div></div>
            <time class="countdown num"></time></div>`;
        })
        .join("") || '<p class="meta">Keine Events ausgewählt.</p>';
  }
  for (const { event, st } of rows) {
    const row = host.querySelector(`[data-id="${CSS.escape(event.id)}"]`);
    if (!row) continue;
    row.querySelector(".countdown").textContent = countdown(st.remaining);
    row.querySelector(".tmeta").textContent =
      (st.active ? (event.activeText || "Läuft bis") + " " + time.format(st.end) : "Start " + when(st.start, now)) + (event.confirmed ? "" : " · unbestätigt");
  }
}
