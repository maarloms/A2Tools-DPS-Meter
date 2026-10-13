import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNotes, parseVersion, compareVersions, escapeHtml } from "../public/fork/markdown.js";

// ---------------------------------------------------------------- escaping

test("script tags are escaped, never rendered", () => {
  const html = renderNotes("<script>alert(1)</script>\n- <b>x</b>");
  assert.ok(!html.includes("<script"), html);
  assert.ok(!html.includes("<b>"), html);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), html);
});

test("an img with onerror stays text", () => {
  const html = renderNotes('<img src=x onerror="alert(1)">');
  assert.ok(!/<img/i.test(html), html);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), html);
});

test("formatting cannot smuggle markup through bold or code", () => {
  const html = renderNotes("**<i>x</i>** `<svg onload=1>`");
  assert.equal(html, "<p><strong>&lt;i&gt;x&lt;/i&gt;</strong> <code>&lt;svg onload=1&gt;</code></p>");
});

test("escapeHtml covers quotes", () => {
  assert.equal(escapeHtml(`a"b'c&<>`), "a&quot;b&#39;c&amp;&lt;&gt;");
  assert.equal(escapeHtml(null), "");
});

// ------------------------------------------------------------------- links

test("https links become anchors", () => {
  const html = renderNotes("Siehe [Release](https://github.com/x/y/releases?a=1&b=2).");
  assert.equal(html, '<p>Siehe <a href="https://github.com/x/y/releases?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Release</a>.</p>');
});

test("javascript:, data: and http: links stay plain text", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "JaVaScRiPt:alert(1)"]) {
    const html = renderNotes(`[klick](${url})`);
    assert.ok(!html.includes("<a"), `${url}: ${html}`);
    assert.ok(html.includes("klick"), html);
  }
});

test("a link URL cannot break out of the href attribute", () => {
  const html = renderNotes('[x](https://a.com/"onmouseover="alert(1))');
  assert.ok(!/<a[^>]*\sonmouseover=/i.test(html), html);
  const bare = renderNotes('https://a.com/"onmouseover="alert(1)');
  assert.ok(!/<a[^>]*\sonmouseover=/i.test(bare), bare);
  assert.ok(bare.includes('href="https://a.com/"'), bare);
});

test("bare https URLs are linked, trailing punctuation is not part of them", () => {
  const html = renderNotes("Mehr unter https://example.com/a.b, danke.");
  assert.equal(html, '<p>Mehr unter <a href="https://example.com/a.b" target="_blank" rel="noopener noreferrer">https://example.com/a.b</a>, danke.</p>');
});

// -------------------------------------------------------------- formatting

test("bold, italic, strike and code", () => {
  assert.equal(
    renderNotes("**fett** *kursiv* ~~weg~~ `code **nicht fett**`"),
    "<p><strong>fett</strong> <em>kursiv</em> <del>weg</del> <code>code **nicht fett**</code></p>",
  );
});

test("a whole bold line is a heading, inline bold is not", () => {
  assert.equal(renderNotes("**Neu**\n- a"), "<h4>Neu</h4><ul><li>a</li></ul>");
  assert.equal(renderNotes("**Behoben:**"), "<h4>Behoben:</h4>");
  assert.equal(renderNotes("**Fett** und **mehr**"), "<p><strong>Fett</strong> und <strong>mehr</strong></p>");
  assert.equal(renderNotes("## Was ist neu"), "<h4>Was ist neu</h4>");
});

test("dash, star and numbered lists", () => {
  assert.equal(renderNotes("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderNotes("* a\n* b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderNotes("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
  assert.equal(renderNotes("- a\n1. b"), "<ul><li>a</li></ul><ol><li>b</li></ol>");
});

test("nested list and continuation line", () => {
  assert.equal(
    renderNotes("- a\n  - a1\n  - a2\n- b\n  weiter"),
    "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b weiter</li></ul>",
  );
});

test("paragraphs, line breaks and CRLF", () => {
  assert.equal(renderNotes("eins\r\nzwei\r\n\r\ndrei"), "<p>eins<br>zwei</p><p>drei</p>");
  assert.equal(renderNotes("**Neu**\r\n- a\r\n- b\r\n"), "<h4>Neu</h4><ul><li>a</li><li>b</li></ul>");
});

test("code fences keep their text escaped", () => {
  assert.equal(renderNotes("```\n<a> **x**\n```"), "<pre><code>&lt;a&gt; **x**</code></pre>");
});

test("empty input", () => {
  assert.equal(renderNotes(""), "");
  assert.equal(renderNotes(null), "");
  assert.equal(renderNotes(undefined), "");
});

// ----------------------------------------------------------- dropSections

const RELEASE = [
  "**Neu**",
  "- Feature",
  "",
  "**Installation (neu)**",
  "1. `AION2-DPS-Meter_3.0.19_x64.msi` herunterladen",
  "2. Npcap",
  "",
  "**Sonstiges**",
  "- Rest",
].join("\r\n");

test("dropSections removes a section up to the next heading", () => {
  const html = renderNotes(RELEASE, { dropSections: ["Installation"] });
  assert.equal(html, "<h4>Neu</h4><ul><li>Feature</li></ul><h4>Sonstiges</h4><ul><li>Rest</li></ul>");
});

test("dropSections is case-insensitive and works for # headings and at the end", () => {
  const html = renderNotes("## Neu\n- x\n## installation\n- weg\n- weg", { dropSections: ["INSTALLATION"] });
  assert.equal(html, "<h4>Neu</h4><ul><li>x</li></ul>");
});

test("without dropSections everything stays", () => {
  const html = renderNotes(RELEASE);
  assert.ok(html.includes("<h4>Installation (neu)</h4>"), html);
  assert.ok(html.includes("<code>AION2-DPS-Meter_3.0.19_x64.msi</code>"), html);
});

// ----------------------------------------------------------------- versions

test("parseVersion accepts v-prefix, short forms and prereleases", () => {
  assert.deepEqual(parseVersion("v3.0.19"), { major: 3, minor: 0, patch: 19, pre: [] });
  assert.deepEqual(parseVersion("3.0.19"), { major: 3, minor: 0, patch: 19, pre: [] });
  assert.deepEqual(parseVersion(" V3.1 "), { major: 3, minor: 1, patch: 0, pre: [] });
  assert.deepEqual(parseVersion("3.1.0-beta.2+build5"), { major: 3, minor: 1, patch: 0, pre: ["beta", "2"] });
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion("latest"), null);
  assert.equal(parseVersion("3.0.x"), null);
  assert.equal(parseVersion(null), null);
});

test("compareVersions orders numerically, not as text", () => {
  assert.ok(compareVersions("3.0.19", "3.0.9") > 0);
  assert.ok(compareVersions("v3.0.9", "3.0.19") < 0);
  assert.ok(compareVersions("3.1.0", "3.0.99") > 0);
  assert.ok(compareVersions("4.0.0", "3.99.99") > 0);
  assert.equal(compareVersions("v3.0.19", "3.0.19"), 0);
});

test("compareVersions: prerelease is older than its release", () => {
  assert.ok(compareVersions("3.1.0-beta", "3.1.0") < 0);
  assert.ok(compareVersions("3.1.0", "3.1.0-rc.1") > 0);
  assert.ok(compareVersions("3.1.0-beta", "3.0.19") > 0);
  assert.ok(compareVersions("3.1.0-beta.2", "3.1.0-beta.10") < 0);
  assert.ok(compareVersions("3.1.0-alpha", "3.1.0-beta") < 0);
  assert.ok(compareVersions("3.1.0-beta", "3.1.0-beta.1") < 0);
  assert.ok(compareVersions("3.1.0-1", "3.1.0-alpha") < 0);
  assert.equal(compareVersions("3.1.0-rc.1", "v3.1.0-rc.1"), 0);
});

test("compareVersions: unparsable versions sort first, parsed objects work", () => {
  assert.ok(compareVersions("kaputt", "0.0.1") < 0);
  assert.ok(compareVersions("0.0.1", "kaputt") > 0);
  assert.equal(compareVersions("a", "b"), 0);
  assert.ok(compareVersions(parseVersion("3.0.20"), "3.0.19") > 0);
});

test("sorting a release list", () => {
  const tags = ["v3.0.9", "v3.0.19", "v3.1.0-beta", "v3.0.10", "v3.1.0"];
  assert.deepEqual([...tags].sort(compareVersions), ["v3.0.9", "v3.0.10", "v3.0.19", "v3.1.0-beta", "v3.1.0"]);
});
