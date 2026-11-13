// Event timer language: German (default) or English. Pure text helpers, no
// DOM, so tests/timer-i18n.test.mjs can run them. Static labels in timer.html
// carry data-i18n* attributes; timer.js applies them with `applyStatic`.
// Event names/notes come from the `en` block of each events.json entry.
import { countdown, intervalText } from "./schedule.js";

export const LANGS = ["de", "en"];
export const DEFAULT_LANG = "de";
export const normalizeLang = value => LANGS.includes(value) ? value : DEFAULT_LANG;

const LOCALE = { de: "de-DE", en: "en-GB" };
export const locale = lang => LOCALE[normalizeLang(lang)];

// {n}/{t}/... placeholders are filled by `t`.
export const STRINGS = {
  de: {
    title: "Event-Timer", windowAria: "Timer-Fenster",
    filtersTitle: "Events und Darstellung", filtersAria: "Filter öffnen",
    lockTitle: "Durchklicken sperren; Strg+Alt+T blendet aus und wieder entsperrt ein", lockAria: "Timer sperren",
    closeTitle: "Ausblenden (Strg+Alt+T)", closeAria: "Timer ausblenden",
    zone: "Deutschland",
    settingsAria: "Timer-Einstellungen", settingsTitle: "Einstellungen",
    doneAria: "Einstellungen schließen", doneTitle: "Zurück zum Timer",
    tabsAria: "Einstellungsbereich", tabEvents: "Events", tabAppearance: "Darstellung",
    showInOverlay: "Im Overlay anzeigen", selectionCount: "{n} aktiv",
    eventsNote: "Minispiele und Invasionsgegner wechseln. Der Timer zeigt den Start ihrer gemeinsamen Aktivität.",
    landscape: "Querformat", landscapeHint: "Events nebeneinander als flache Leiste, z. B. am oberen Bildschirmrand.",
    opacity: "Deckkraft", transparent: "Transparent", solid: "Deutlich",
    offset: "Zeitkorrektur", minutes: "Minuten",
    offsetMinusAria: "Zeitkorrektur um eine Minute verringern", offsetPlusAria: "Zeitkorrektur um eine Minute erhöhen",
    offsetInputAria: "Zeitkorrektur in Minuten",
    offsetNote: "Verschiebt alle Events gemeinsam. Normalerweise bleibt dieser Wert bei 0.",
    alarm: "Ton vor Start", alarmUnit: "nur ausgewählte Events", alarmOff: "Aus",
    alarmBefore: "{n} Minuten vorher", alarmBefore1: "1 Minute vorher", alarmTest: "Test",
    alarmNote: "Klingt nur, solange das Timer-Fenster eingeblendet ist.",
    language: "Sprache", languageNote: "Gilt nur für den Event-Timer.",
    themeNote: "Das Design folgt deinem DPS-Meter.",
    eventsAreaAria: "Nächste Events",
    bossPanelAria: "Feldboss eintragen", close: "Schließen",
    bossKilled: "Getötet", bossKilledTitle: "Jetzt getötet",
    bossSpawnAria: "Countdown von der Karte, z. B. 10:45",
    bossSpawnsIn: "Spawnt in", bossSpawnsInTitle: "Countdown von der Ingame-Karte übernehmen",
    bossClearTitle: "Kill und gelernten Takt löschen", bossClearAria: "Zurücksetzen",
    footer: "Strg+Alt+T · Ein / Aus", footerLocked: "Gesperrt · Strg+Alt+T zweimal zum Entsperren",
    allEventsAria: "Alle Events: {c}",
    unconfirmedNote: "Zeiten aus den Global-Clientdaten, ingame noch nicht geprüft.",
    unconfirmed: "unbestätigt", empty: "Keine Events ausgewählt. Öffne die Filter über das Zahnrad.",
    bossClickHint: "Klicken: getötet oder Countdown von der Karte eintragen.",
    start: "Start", activeUntil: "Läuft bis",
    bossAlive: "da", bossDue: "fällig", bossNone: "—",
    bossSeen: "Gesichtet {t}", bossRespawnSince: "Respawn seit {t}", bossRespawn: "Respawn {t}",
    bossEvery: "alle {i}", bossKilledAt: "Getötet {t} · Takt noch offen", bossNoKill: "{z} · noch kein Kill",
    bossRespawnEvery: "Respawn alle {i}", bossIntervalUnknown: "Takt unbekannt",
    errSave: "Einstellungen konnten nicht gespeichert werden.",
    errLoad: "Timer konnte nicht geladen werden: {e}", errData: "Eventdaten fehlen",
    errBossDesktop: "Feldboss-Timer gehen nur in der Desktop-App.",
    errBossSave: "Feldboss konnte nicht gespeichert werden: {e}",
    errDrag: "Fenster konnte nicht verschoben werden.", errHide: "Timer konnte nicht ausgeblendet werden.",
    errLockDesktop: "Die Fenstersperre funktioniert in der Desktop-App.", errLock: "Timer konnte nicht gesperrt werden.",
    dayUnit: "T",
  },
  en: {
    title: "Event Timer", windowAria: "Timer window",
    filtersTitle: "Events and appearance", filtersAria: "Open settings",
    lockTitle: "Lock window (clicks pass through); Ctrl+Alt+T hides it and unlocks it when shown again", lockAria: "Lock timer",
    closeTitle: "Hide (Ctrl+Alt+T)", closeAria: "Hide timer",
    zone: "Germany",
    settingsAria: "Timer settings", settingsTitle: "Settings",
    doneAria: "Close settings", doneTitle: "Back to timer",
    tabsAria: "Settings section", tabEvents: "Events", tabAppearance: "Appearance",
    showInOverlay: "Show in overlay", selectionCount: "{n} active",
    eventsNote: "Minigames and invasion enemies rotate. The timer shows the start of their shared activity.",
    landscape: "Landscape", landscapeHint: "Events side by side in a flat strip, e.g. along the top edge of the screen.",
    opacity: "Opacity", transparent: "Transparent", solid: "Solid",
    offset: "Time offset", minutes: "minutes",
    offsetMinusAria: "Decrease time offset by one minute", offsetPlusAria: "Increase time offset by one minute",
    offsetInputAria: "Time offset in minutes",
    offsetNote: "Shifts all events together. Normally this stays at 0.",
    alarm: "Sound before start", alarmUnit: "selected events only", alarmOff: "Off",
    alarmBefore: "{n} minutes before", alarmBefore1: "1 minute before", alarmTest: "Test",
    alarmNote: "Only sounds while the timer window is shown.",
    language: "Language", languageNote: "Applies to the event timer only.",
    themeNote: "The design follows your DPS meter.",
    eventsAreaAria: "Upcoming events",
    bossPanelAria: "Enter field boss", close: "Close",
    bossKilled: "Killed", bossKilledTitle: "Killed just now",
    bossSpawnAria: "Countdown from the map, e.g. 10:45",
    bossSpawnsIn: "Spawns in", bossSpawnsInTitle: "Take over the countdown from the in-game map",
    bossClearTitle: "Clear kill and learned interval", bossClearAria: "Reset",
    footer: "Ctrl+Alt+T · On / Off", footerLocked: "Locked · press Ctrl+Alt+T twice to unlock",
    allEventsAria: "All events: {c}",
    unconfirmedNote: "Times from the Global client data, not yet verified in game.",
    unconfirmed: "unconfirmed", empty: "No events selected. Open the settings with the gear icon.",
    bossClickHint: "Click: enter a kill or the countdown from the map.",
    start: "Start", activeUntil: "Active until",
    bossAlive: "up", bossDue: "due", bossNone: "—",
    bossSeen: "Seen {t}", bossRespawnSince: "Respawned since {t}", bossRespawn: "Respawn {t}",
    bossEvery: "every {i}", bossKilledAt: "Killed {t} · interval not known yet", bossNoKill: "{z} · no kill yet",
    bossRespawnEvery: "Respawn every {i}", bossIntervalUnknown: "Interval unknown",
    errSave: "Settings could not be saved.",
    errLoad: "Timer could not be loaded: {e}", errData: "Event data missing",
    errBossDesktop: "Field boss timers only work in the desktop app.",
    errBossSave: "Field boss could not be saved: {e}",
    errDrag: "Window could not be moved.", errHide: "Timer could not be hidden.",
    errLockDesktop: "Window lock only works in the desktop app.", errLock: "Timer could not be locked.",
    dayUnit: "d",
  },
};

// Category headings; events.json keeps the German name as the key.
export const CATEGORIES = {
  en: {
    "Risse": "Rifts", "Aktivitäten": "Activities", "Abyss": "Abyss", "Weltbosse": "World Bosses",
    "PvP": "PvP", "Resets": "Resets",
    "Feldbosse Altgard": "Field Bosses Altgard", "Feldbosse Verteron": "Field Bosses Verteron",
  },
};

export function t(lang, key, params = {}) {
  const table = STRINGS[normalizeLang(lang)];
  const text = table[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => name in params ? String(params[name]) : m);
}
export const category = (lang, name) => normalizeLang(lang) === "en" ? CATEGORIES.en[name] ?? name : name;

// Name, note, zone and "active until" label of an event in the language;
// missing English fields fall back to German.
export function labels(event, lang) {
  const en = normalizeLang(lang) === "en" ? event.en || {} : {};
  return {
    name: en.name ?? event.name,
    note: en.note ?? event.note,
    zone: en.zone ?? event.zone,
    activeText: en.activeText ?? event.activeText ?? t(lang, "activeUntil"),
  };
}
export const alarmLabel = (lang, minutes) => !minutes ? t(lang, "alarmOff")
  : minutes === 1 ? t(lang, "alarmBefore1") : t(lang, "alarmBefore", { n: minutes });

// Intl formatters per language; the timer always shows German (region) time.
const formatters = new Map();
function fmt(lang, kind) {
  const key = lang + kind;
  if (!formatters.has(key)) {
    const options = {
      time: { hour: "2-digit", minute: "2-digit" },
      clock: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
      weekday: { weekday: "short" },
    }[kind];
    formatters.set(key, new Intl.DateTimeFormat(locale(lang), { timeZone: "Europe/Berlin", hourCycle: "h23", ...options }));
  }
  return formatters.get(key);
}
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
export const timeText = (lang, ms) => fmt(lang, "time").format(ms);
export const clockText = (lang, ms) => fmt(lang, "clock").format(ms);
// "21:30" today, "Sa 21:30" / "Sat 21:30" on any other day.
export function when(lang, ms, now) {
  const time = timeText(lang, ms);
  return dayKey.format(ms) === dayKey.format(now) ? time
    : fmt(lang, "weekday").format(ms).replace(".", "") + " " + time;
}
export const dayCountdown = (lang, ms) => countdown(ms, t(lang, "dayUnit"));

// [big text, small text] of a field boss row.
export function bossText(lang, event, state, now) {
  const by = state.by ? " · " + state.by : "";
  const at = ms => when(lang, ms, now);
  switch (state.status) {
    case "alive": return [t(lang, "bossAlive"), t(lang, "bossSeen", { t: at(state.seen) }) + by];
    case "due": return [t(lang, "bossDue"), t(lang, "bossRespawnSince", { t: at(state.respawn) }) + by];
    case "waiting": return [dayCountdown(lang, state.remaining),
      t(lang, "bossRespawn", { t: (state.estimated ? "~" : "") + at(state.respawn) })
      + (state.interval ? " · " + t(lang, "bossEvery", { i: intervalText(state.interval) }) : "") + by];
    case "killed": return ["+" + dayCountdown(lang, now - state.killed), t(lang, "bossKilledAt", { t: at(state.killed) }) + by];
    default: return [t(lang, "bossNone"), t(lang, "bossNoKill", { z: labels(event, lang).zone })];
  }
}

// Fills the static labels: data-i18n (text), data-i18n-title, -aria,
// -placeholder. Works on anything with querySelectorAll/setAttribute.
const ATTRIBUTES = { "data-i18n-title": "title", "data-i18n-aria": "aria-label", "data-i18n-placeholder": "placeholder" };
export function applyStatic(root, lang) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(lang, el.getAttribute("data-i18n"));
  for (const [source, target] of Object.entries(ATTRIBUTES))
    for (const el of root.querySelectorAll("[" + source + "]")) el.setAttribute(target, t(lang, el.getAttribute(source)));
}
