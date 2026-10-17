// Wochenrückblick (src/weekly-core.ts): Wochengrenzen, URL-Prüfung, Discord-Karte, Fehlerklassen.
// node --test test/weekly.test.mjs  (Node ≥ 22.18 lädt .ts per Type-Stripping)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bossDpsChange, buildPayload, buildPingPayload, classifyStatus, currentWeek, escapeMd, fmtPct, lastWeek, parseWebhookUrl,
  pctChange, retryAfterMs, webhookHint, weekLabel, weekStart, EMBED_COLOR, WEEK_MS,
} from "../src/weekly-core.ts";

const utc = (s) => Date.parse(s);
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz01";
const HOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;

// ---------- Wochengrenzen ----------

test("Woche beginnt mittwochs 07:00 UTC (wie die Checkliste)", () => {
  assert.equal(weekStart(utc("2026-10-17T12:00:00Z")), utc("2026-10-14T07:00:00Z")); // Samstag
  assert.equal(weekStart(utc("2026-10-14T07:00:00Z")), utc("2026-10-14T07:00:00Z")); // genau Reset
  assert.equal(weekStart(utc("2026-10-14T06:59:59Z")), utc("2026-10-07T07:00:00Z")); // kurz davor
  assert.equal(weekStart(utc("2026-10-13T23:00:00Z")), utc("2026-10-07T07:00:00Z")); // Dienstag
});

test("Zeitumstellung 25.10.2026: Woche bleibt genau 7 × 24 h, Reset 09:00 → 08:00 deutscher Zeit", () => {
  const w = lastWeek(utc("2026-10-28T07:15:00Z")); // Cron am Mittwoch nach der Umstellung
  assert.equal(w.from, utc("2026-10-21T07:00:00Z"));
  assert.equal(w.to, utc("2026-10-28T07:00:00Z"));
  assert.equal(w.to - w.from, WEEK_MS);
  assert.equal(w.key, "w2026-10-21");
  // Reset in deutscher Zeit: vorher 09:00 (MESZ), danach 08:00 (MEZ)
  const hm = (ms) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(ms);
  assert.equal(hm(w.from), "09:00");
  assert.equal(hm(w.to), "08:00");
  // Kampf am 28.10. um 07:59 deutscher Zeit (06:59 UTC) gehört noch zur alten Woche, 08:30 zur neuen
  const inWeek = (t) => t >= w.from && t < w.to;
  assert.ok(inWeek(utc("2026-10-28T06:59:00Z")));
  assert.ok(!inWeek(utc("2026-10-28T07:30:00Z")));
  // Sonntag der Umstellung liegt mittendrin
  assert.ok(inWeek(utc("2026-10-25T01:30:00Z")));
  assert.equal(weekLabel(w), "21.10.–28.10.2026");
});

test("Cron vor dem Reset am Mittwoch postet nicht die laufende Woche", () => {
  const w = lastWeek(utc("2026-10-21T06:30:00Z"));
  assert.equal(w.from, utc("2026-10-07T07:00:00Z"));
  assert.equal(w.to, utc("2026-10-14T07:00:00Z"));
});

test("laufende Woche für den Test-Post", () => {
  const w = currentWeek(utc("2026-10-17T12:00:00Z"));
  assert.equal(w.from, utc("2026-10-14T07:00:00Z"));
  assert.equal(w.to, utc("2026-10-21T07:00:00Z"));
});

test("Jahreswechsel im Label", () => {
  assert.equal(weekLabel(lastWeek(utc("2027-01-06T08:00:00Z"))), "30.12.–06.01.2027");
});

// ---------- Webhook-URL ----------

test("nur Discord-Webhooks werden angenommen", () => {
  assert.equal(parseWebhookUrl(HOOK), HOOK);
  assert.equal(parseWebhookUrl(`  ${HOOK}  `), HOOK);
  assert.equal(parseWebhookUrl(HOOK.replace("discord.com", "discordapp.com")), HOOK); // normalisiert
  assert.equal(parseWebhookUrl(HOOK.replace("/api/", "/api/v10/")), HOOK);
  for (const bad of [
    HOOK.replace("https://", "http://"),
    HOOK.replace("discord.com", "evil.com"),
    HOOK.replace("discord.com", "discord.com.evil.com"),
    HOOK.replace("discord.com", "discord.com:8443"),
    HOOK.replace("discord.com", "user@discord.com"),
    HOOK.replace("discord.com", "ptb.discord.com"),
    HOOK + "?wait=true",
    HOOK + "#x",
    HOOK + "/slack",
    HOOK.replace("/webhooks/", "/channels/"),
    "https://discord.com/api/webhooks/abc/" + TOKEN,
    "https://discord.com/api/webhooks/123456789012345678/kurz",
    "javascript:alert(1)",
    "",
    null,
    42,
  ]) {
    assert.equal(parseWebhookUrl(bad), null, String(bad));
  }
});

test("Hinweis zeigt nur die letzten 4 Zeichen", () => {
  const h = webhookHint(HOOK);
  assert.equal(h, "…Yz01");
  assert.ok(!h.includes(TOKEN.slice(0, 10)));
});

// ---------- Discord-Antworten ----------

test("Fehlerklassen", () => {
  assert.equal(classifyStatus(200), "ok");
  assert.equal(classifyStatus(204), "ok");
  assert.equal(classifyStatus(404), "invalid");
  assert.equal(classifyStatus(401), "invalid");
  assert.equal(classifyStatus(403), "invalid");
  assert.equal(classifyStatus(429), "rate_limited");
  assert.equal(classifyStatus(500), "retry");
  assert.equal(classifyStatus(0), "retry");
  assert.equal(classifyStatus(400), "rejected");
  assert.equal(retryAfterMs({ retry_after: 1.234 }, null), 1234);
  assert.equal(retryAfterMs(null, "3"), 3000);
  assert.equal(retryAfterMs(null, null), 60_000);
});

// ---------- Auswertung ----------

test("Veränderung je Boss nur über Bosse aus beiden Wochen", () => {
  assert.equal(bossDpsChange([]), null);
  assert.equal(bossDpsChange([{ boss: "a", cur: 1, avgDps: 100 }]), null);
  const v = bossDpsChange([
    { boss: "a", cur: 1, avgDps: 110 },
    { boss: "a", cur: 0, avgDps: 100 },
    { boss: "b", cur: 1, avgDps: 90 },
    { boss: "b", cur: 0, avgDps: 100 },
    { boss: "c", cur: 1, avgDps: 5000 }, // neu, zählt nicht
    { boss: "d", cur: 0, avgDps: 1 }, // nur Vorwoche
  ]);
  assert.ok(Math.abs(v) < 1e-9);
  assert.equal(pctChange(12, 8), 50);
  assert.equal(pctChange(3, 0), null);
  assert.equal(fmtPct(12.345), "+12,3 %");
  assert.equal(fmtPct(-4), "−4,0 %");
  assert.equal(fmtPct(0.01), "±0 %");
  assert.equal(fmtPct(null), "–");
});

// ---------- Discord-Karte ----------

const RECAP = {
  room: "atreia-trio",
  week: lastWeek(utc("2026-10-28T07:15:00Z")),
  fights: 14,
  kills: 12,
  prevFights: 10,
  prevKills: 8,
  best: { fightId: "0123456789abcdef", boss: "Kelpina [Elite]", groupDps: 61_234, durationMs: 192_400, killed: true },
  top: [
    { name: "Marlon", dps: 25_500, boss: "Kelpina" },
    { name: "Freund_1", dps: 21_000, boss: "Kelpina" },
    { name: "@everyone", dps: 9_000, boss: "Ragnar" },
  ],
  dpsChange: 4.25,
};

test("Embed: Titel, Farbe, Felder, deutsch formatiert", () => {
  const p = buildPayload(RECAP, { origin: "https://a2dps.example.workers.dev", now: utc("2026-10-28T07:15:00Z") });
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.equal(p.embeds.length, 1);
  const e = p.embeds[0];
  assert.equal(e.title, "Wochenrückblick atreia-trio · 21.10.–28.10.2026");
  assert.equal(e.color, EMBED_COLOR);
  assert.equal(e.url, "https://a2dps.example.workers.dev/#/overview");
  assert.match(e.description, /\*\*14\*\* Bosskämpfe · \*\*12\*\* Boss-Kills/);
  const f = Object.fromEntries(e.fields.map((x) => [x.name, x.value]));
  assert.match(f["Bester Kampf"], /^\[Kelpina \\\[Elite\\\]\]\(https:\/\/a2dps\.example\.workers\.dev\/#\/fight\/0123456789abcdef\) · besiegt/);
  assert.match(f["Bester Kampf"], /61,2 k Gruppen-DPS · 3:12/);
  const top = f["Top-3-DPS der Woche"].split("\n");
  assert.equal(top.length, 3);
  assert.equal(top[0], "**1.** Marlon · 25,5 k · Kelpina");
  assert.equal(top[1], "**2.** Freund\\_1 · 21,0 k · Kelpina");
  assert.equal(f["Kills gegen Vorwoche"], "+50,0 % (8 → 12)");
  assert.equal(f["Ø DPS je Boss gegen Vorwoche"], "+4,3 %");
  assert.equal(e.timestamp, "2026-10-28T07:00:00.000Z");
  // Discord-Grenzen
  assert.ok(e.title.length <= 256 && e.description.length <= 4096);
  for (const x of e.fields) assert.ok(x.name.length <= 256 && x.value.length <= 1024);
  assert.ok(!JSON.stringify(p).includes("webhooks"));
});

test("Embed ohne Vorwoche und ohne Vergleich", () => {
  const p = buildPayload({ ...RECAP, prevKills: 0, prevFights: 0, dpsChange: null, top: RECAP.top.slice(0, 1), best: null }, { origin: "https://x.dev" });
  const f = Object.fromEntries(p.embeds[0].fields.map((x) => [x.name, x.value]));
  assert.equal(f["Kills gegen Vorwoche"], "neu (Vorwoche ohne Kill)");
  assert.equal(f["Ø DPS je Boss gegen Vorwoche"], "–");
  assert.ok(!("Bester Kampf" in f));
  assert.ok("Top-1-DPS der Woche" in f);
});

test("Test-Post ist gekennzeichnet", () => {
  const p = buildPayload(RECAP, { origin: "https://x.dev", test: true, now: utc("2026-10-24T10:00:00Z") });
  assert.match(p.embeds[0].title, /^Test · Wochenrückblick/);
  assert.match(p.embeds[0].description, /Test-Post/);
  assert.equal(p.embeds[0].timestamp, "2026-10-24T10:00:00.000Z");
  const ping = buildPingPayload("atreia-trio", "https://x.dev");
  assert.match(ping.embeds[0].title, /^Test · /);
  assert.deepEqual(ping.allowed_mentions, { parse: [] });
});

test("Markdown in Namen wird entschärft", () => {
  assert.equal(escapeMd("a*b_c~d`e|f[g]h\\"), "a\\*b\\_c\\~d\\`e\\|f\\[g\\]h\\\\");
  assert.equal(escapeMd("x".repeat(100)).length, 64);
});
