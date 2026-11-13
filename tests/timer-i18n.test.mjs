import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {countdown, respawnState} from "../public/fork/schedule.js";
import {STRINGS, CATEGORIES, LANGS, DEFAULT_LANG, normalizeLang, t, category, labels, alarmLabel, when, timeText, clockText, dayCountdown, bossText, applyStatic}
  from "../public/fork/timer-i18n.js";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const data = JSON.parse(read("../public/fork/events.json"));
const html = read("../timer.html");
const npcsEn = JSON.parse(read("../src/data/i18n/npcs/en.json"));
const at = s => Date.parse(s);

test("German stays the default and unknown values fall back to it", () => {
  assert.equal(DEFAULT_LANG, "de");
  assert.deepEqual(LANGS, ["de", "en"]);
  for (const bad of [undefined, null, "", "fr", "EN", 5]) assert.equal(normalizeLang(bad), "de");
  assert.equal(normalizeLang("en"), "en");
  assert.equal(normalizeLang("de"), "de");
});
test("both languages have the same text keys and placeholders", () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.de).sort());
  for (const key of Object.keys(STRINGS.de)) {
    const holes = lang => (STRINGS[lang][key].match(/\{\w+\}/g) || []).sort().join();
    assert.equal(holes("en"), holes("de"), key);
  }
});
test("t fills placeholders and falls back to the key", () => {
  assert.equal(t("en", "selectionCount", {n: 3}), "3 active");
  assert.equal(t("de", "selectionCount", {n: 3}), "3 aktiv");
  assert.equal(t("en", "doesNotExist"), "doesNotExist");
  assert.equal(t("xx", "footer"), STRINGS.de.footer);
});
test("static labels in timer.html use known keys and match the German text", () => {
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="(\w+)"/g)) {
    keys.add(m[1]); assert.ok(m[1] in STRINGS.de && m[1] in STRINGS.en, m[1]);
  }
  assert.ok(keys.size > 30);
  // The markup is the German original (shown before the script runs).
  for (const m of html.matchAll(/data-i18n="(\w+)"[^>]*>([^<]+)</g)) assert.equal(m[2].trim(), STRINGS.de[m[1]], m[1]);
  for (const m of html.matchAll(/(title|aria-label)="([^"]+)"[^>]*?data-i18n-(?:title|aria)="(\w+)"/g)) assert.equal(m[2], STRINGS.de[m[3]], m[3]);
  assert.match(html, /<select id="language">[\s\S]*value="de"[\s\S]*value="en"/);
});
test("applyStatic writes text and attributes", () => {
  const make = attrs => ({attrs, textContent: "", getAttribute(n) { return this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = v; }});
  const a = make({"data-i18n": "close"}), b = make({"data-i18n-title": "doneTitle", "data-i18n-aria": "doneAria"});
  const root = {querySelectorAll: sel => [a, b].filter(el => sel.slice(1, -1) in el.attrs)};
  applyStatic(root, "en");
  assert.equal(a.textContent, "Close");
  assert.equal(b.attrs.title, "Back to timer"); assert.equal(b.attrs["aria-label"], "Close settings");
  applyStatic(root, "de");
  assert.equal(a.textContent, "Schließen"); assert.equal(b.attrs.title, "Zurück zum Timer");
});
test("every event has English texts and no German leftovers in them", () => {
  for (const event of data.events) {
    const en = event.en;
    assert.ok(en?.name && en?.note, event.id);
    if (event.kind === "respawn") assert.ok(en.zone, event.id);
    for (const [field, value] of Object.entries(en)) assert.doesNotMatch(value, /[äöüßÄÖÜ]|Ingame|Uhr\b/, event.id + "." + field);
    if (event.activeText) assert.ok(en.activeText, event.id);
    assert.ok(category("en", event.category) !== undefined);
    assert.ok(CATEGORIES.en[event.category], "Kategorie " + event.category);
  }
});
test("English field boss names are the game's names", () => {
  const bosses = data.events.filter(e => e.kind === "respawn");
  assert.ok(bosses.length >= 20);
  for (const event of bosses) assert.equal(event.en.name, npcsEn[event.mobCodes[0]].name, event.id);
});
test("labels: German is unchanged, English falls back to German", () => {
  const rift = data.events.find(e => e.id === "rift");
  assert.deepEqual(labels(rift, "de"), {name: "Raumzeit-Riss", note: rift.note, zone: undefined, activeText: "Portal offen bis"});
  assert.equal(labels(rift, "en").name, "Spacetime Rift");
  assert.equal(labels(rift, "en").activeText, "Portal open until");
  const plain = data.events.find(e => e.id === "shugofesta");
  assert.equal(labels(plain, "de").activeText, "Läuft bis");
  assert.equal(labels(plain, "en").activeText, "Active until");
  const bare = {name: "Nur Deutsch", note: "Notiz"};
  assert.equal(labels(bare, "en").name, "Nur Deutsch");
  assert.equal(category("de", "Weltbosse"), "Weltbosse"); assert.equal(category("en", "Weltbosse"), "World Bosses");
  assert.equal(category("en", "Unbekannt"), "Unbekannt");
});
test("times: today plain, other days with weekday, 24-hour clock in both languages", () => {
  const now = at("2026-11-13T12:00:00Z"), sat = at("2026-11-14T20:30:00Z");
  assert.equal(when("de", sat, now), "Sa 21:30");
  assert.equal(when("en", sat, now), "Sat 21:30");
  assert.equal(when("en", at("2026-11-13T20:30:00Z"), now), "21:30");
  assert.equal(timeText("en", at("2026-11-13T23:05:00Z")), "00:05");
  assert.equal(timeText("de", at("2026-11-13T23:05:00Z")), "00:05");
  assert.equal(clockText("en", at("2026-11-13T12:00:09Z")), "13:00:09");
  assert.equal(clockText("de", at("2026-11-13T12:00:09Z")), "13:00:09");
});
test("day countdown uses T in German and d in English; plain countdown unchanged", () => {
  const ms = (2 * 86400 + 3 * 3600 + 5 * 60) * 1000;
  assert.equal(dayCountdown("de", ms), "2T 03:05");
  assert.equal(dayCountdown("en", ms), "2d 03:05");
  assert.equal(countdown(ms), "2T 03:05");
  assert.equal(dayCountdown("en", 65000), "01:05");
  assert.equal(dayCountdown("en", Infinity), "—");
});
test("alarm labels", () => {
  assert.deepEqual([0, 1, 3, 10].map(n => alarmLabel("de", n)), ["Aus", "1 Minute vorher", "3 Minuten vorher", "10 Minuten vorher"]);
  assert.deepEqual([0, 1, 3, 10].map(n => alarmLabel("en", n)), ["Off", "1 minute before", "3 minutes before", "10 minutes before"]);
});
test("field boss rows in both languages", () => {
  const event = data.events.find(e => e.id === "fb-lagta-altgard");
  const now = at("2026-11-13T12:00:00Z");
  const cases = (timer) => ["de", "en"].map(lang => bossText(lang, event, respawnState(event, timer, now), now));
  assert.deepEqual(cases(undefined), [["—", "Altgard · noch kein Kill"], ["—", "Altgard · no kill yet"]]);
  const waiting = cases({killedAt: now - 60000, respawnAt: now + 3600000, intervalMin: 120, by: "Mia"});
  assert.deepEqual(waiting[0], ["1:00:00", "Respawn 14:00 · alle 2 h · Mia"]);
  assert.deepEqual(waiting[1], ["1:00:00", "Respawn 14:00 · every 2 h · Mia"]);
  const killed = cases({killedAt: now - 90000});
  assert.deepEqual(killed[0], ["+01:30", "Getötet 12:58 · Takt noch offen"]);
  assert.deepEqual(killed[1], ["+01:30", "Killed 12:58 · interval not known yet"]);
  const due = cases({killedAt: now - 7200000, respawnAt: now - 60000});
  assert.deepEqual([due[0][0], due[1][0]], ["fällig", "due"]);
  assert.match(due[0][1], /^Respawn seit 12:59/); assert.match(due[1][1], /^Respawned since 12:59/);
  const alive = cases({killedAt: now - 7200000, seenAt: now - 120000});
  assert.deepEqual([alive[0][0], alive[1][0]], ["da", "up"]);
  assert.match(alive[0][1], /^Gesichtet 12:58/); assert.match(alive[1][1], /^Seen 12:58/);
});
