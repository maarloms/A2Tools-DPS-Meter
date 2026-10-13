// Unit-Test Patchnotes-Tab: Release-Liste von GitHub → sortierter Verlauf, Fehlertexte.
// Braucht public/shared/markdown.js (scripts/sync-shared.mjs, läuft in `npm test` vorher).
//   node --test test/releases.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { errorText, fetchReleases, slimRelease, sortReleases } from "../public/js/releases.js";
import { renderNotes } from "../public/shared/markdown.js";

const rel = (tag, extra = {}) => ({
  tag_name: tag,
  name: `AION 2 DPS Meter ${tag.replace(/^v/, "")}`,
  published_at: "2026-10-01T10:00:00Z",
  html_url: `https://github.com/maarloms/A2Tools-DPS-Meter/releases/tag/${tag}`,
  body: "**Neu**\r\n- etwas",
  draft: false,
  prerelease: false,
  ...extra,
});

test("neueste Version oben, semver statt Text (3.0.10 > 3.0.9)", () => {
  const out = sortReleases([rel("v3.0.9"), rel("v3.0.10"), rel("v3.0.2"), rel("v3.1.0-beta.1", { prerelease: true }), rel("v3.1.0")]);
  assert.deepEqual(out.map((r) => r.version), ["3.1.0", "3.1.0-beta.1", "3.0.10", "3.0.9", "3.0.2"]);
  assert.equal(out[1].pre, true);
});

test("Entwürfe und Releases ohne Version fallen weg", () => {
  const out = sortReleases([rel("v3.0.1"), rel("v3.0.2", { draft: true }), { tag_name: "", name: "" }, null]);
  assert.deepEqual(out.map((r) => r.version), ["3.0.1"]);
});

test("Titel: Standardname ohne Zusatz, echter Zusatz bleibt", () => {
  assert.equal(slimRelease(rel("v3.0.19")).extra, "");
  assert.equal(slimRelease(rel("v3.0.20", { name: "AION 2 DPS Meter 3.0.20 – Hotfix" })).extra, "Hotfix");
});

test("Link nur zu github.com, sonst Release-Übersicht", () => {
  assert.match(slimRelease(rel("v1.0.0")).url, /^https:\/\/github\.com\/maarloms\/.+\/tag\/v1\.0\.0$/);
  assert.equal(slimRelease(rel("v1.0.0", { html_url: "javascript:alert(1)" })).url, "https://github.com/maarloms/A2Tools-DPS-Meter/releases");
});

test("Installation-Abschnitt fehlt, Rest bleibt, HTML wird entschärft", () => {
  const html = renderNotes("**Neu**\r\n- <img src=x onerror=alert(1)>\r\n\r\n**Installation**\r\n- MSI starten", { dropSections: ["Installation"] });
  assert.match(html, /<h4>Neu<\/h4>/);
  assert.doesNotMatch(html, /MSI starten|Installation/);
  assert.doesNotMatch(html, /<img/);
});

const resp = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

test("fetchReleases blättert, solange volle Seiten kommen", async () => {
  const urls = [];
  const page1 = Array.from({ length: 100 }, (_, i) => rel(`v1.0.${i}`));
  const out = await fetchReleases(async (url) => {
    urls.push(url);
    return resp(200, url.endsWith("&page=1") ? page1 : [rel("v2.0.0")]);
  });
  assert.equal(urls.length, 2);
  assert.equal(out.length, 101);
  assert.equal(out[0].version, "2.0.0");
});

test("Limit erreicht → freundlicher Text mit Uhrzeit", async () => {
  const reset = Math.floor(Date.UTC(2026, 9, 13, 15, 30) / 1000);
  const err = await fetchReleases(async () => resp(403, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) })).catch((e) => e);
  assert.equal(err.rateLimited, true);
  const text = errorText(err, reset * 1000 - 60_000);
  assert.match(text, /aufgebraucht/);
  assert.match(text, /ab ca\. \d\d:\d\d Uhr/);
});

test("andere Fehler und offline", async () => {
  const e500 = await fetchReleases(async () => resp(500, {})).catch((e) => e);
  assert.equal(e500.rateLimited, false);
  assert.match(errorText(e500), /Fehler 500/);
  const off = await fetchReleases(async () => {
    throw new TypeError("Failed to fetch");
  }).catch((e) => e);
  assert.match(errorText(off), /nicht erreichbar/);
});
