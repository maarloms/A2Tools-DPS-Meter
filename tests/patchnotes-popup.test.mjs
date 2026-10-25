// The patch-notes popup: release selection (public/fork/releases.js), the
// popup itself (public/fork/patchnotes.js, on a small fake DOM) and the fork
// hook in public/src/js/checkRelease.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  selectReleases, whatsNewRange, fallbackReleases, releasesHtml, parseReleaseList, releasePage,
} from "../public/fork/releases.js";

const rel = (tag, extra = {}) => ({
  tag_name: tag,
  body: `**Neu**\r\n- Neu in ${tag}\r\n\r\n**Installation (neu)**\r\n1. msi`,
  published_at: "2026-10-13T09:34:47Z",
  ...extra,
});
const LIST = [
  rel("v3.0.21"), rel("v3.0.20"), rel("v3.0.19"), rel("v3.0.18"),
  rel("v3.1.0-beta", { prerelease: true }), rel("v3.0.22", { draft: true }), { tag_name: "kaputt" },
];
const tags = (list) => list.map((r) => r.tag_name);

// ------------------------------------------------------------- releases.js

test("selectReleases: after the installed one up to the offered one, newest first", () => {
  assert.deepEqual(tags(selectReleases(LIST, { after: "3.0.18", upTo: "v3.0.20" })), ["v3.0.20", "v3.0.19"]);
  assert.deepEqual(tags(selectReleases([...LIST].reverse(), { after: "v3.0.18", upTo: "3.0.21" })), ["v3.0.21", "v3.0.20", "v3.0.19"]);
});

test("selectReleases: no after means only that release; drafts and other prereleases never", () => {
  assert.deepEqual(tags(selectReleases(LIST, { upTo: "3.0.19" })), ["v3.0.19"]);
  assert.deepEqual(selectReleases(LIST, { after: "3.0.21", upTo: "3.0.22" }), []);
  assert.deepEqual(selectReleases(LIST, { after: "3.0.21", upTo: "3.1.0" }), []);
  assert.deepEqual(tags(selectReleases(LIST, { after: "3.0.21", upTo: "v3.1.0-beta" })), ["v3.1.0-beta"]);
  assert.deepEqual(selectReleases(null, { upTo: "3.0.19" }), []);
  assert.deepEqual(selectReleases(LIST, { upTo: "" }), []);
});

test("whatsNewRange: once per new version, the very first time only the installed one", () => {
  assert.deepEqual(whatsNewRange("3.0.20", ""), { after: null, upTo: "3.0.20" });
  assert.deepEqual(whatsNewRange("3.0.20", "3.0.18"), { after: "3.0.18", upTo: "3.0.20" });
  assert.equal(whatsNewRange("3.0.20", "3.0.20"), null);
  assert.equal(whatsNewRange("3.0.19", "3.0.20"), null);
  assert.equal(whatsNewRange("", "3.0.20"), null);
});

test("fallbackReleases and releasesHtml", () => {
  assert.deepEqual(fallbackReleases("3.0.20", "  "), []);
  assert.deepEqual(fallbackReleases("3.0.20", "- x"), [{ tag_name: "v3.0.20", body: "- x" }]);
  const html = releasesHtml([rel("v3.0.20", { body: "**Neu**\n- <b>a</b>\n**Installation**\n- weg" })]);
  assert.equal(
    html,
    '<section class="forkPatchnotesRelease"><h3>v3.0.20 <small>13.10.2026</small></h3>' +
      "<h4>Neu</h4><ul><li>&lt;b&gt;a&lt;/b&gt;</li></ul></section>",
  );
  assert.ok(releasesHtml([{ tag_name: "3.0.1", body: "" }]).includes("<h3>v3.0.1</h3><p>–</p>"));
});

test("parseReleaseList only accepts a list", () => {
  assert.deepEqual(parseReleaseList("[]"), []);
  assert.equal(parseReleaseList('{"message":"API rate limit exceeded"}'), null);
  assert.equal(parseReleaseList("<html>"), null);
  assert.equal(releasePage("v3.0.20"), "https://github.com/maarloms/A2Tools-DPS-Meter/releases/tag/v3.0.20");
});

// ------------------------------------------------ patchnotes.js, fake DOM

const RELEASES_URL = new URL("../public/fork/releases.js", import.meta.url).href;
const POPUP_SOURCE = readFileSync(new URL("../public/fork/patchnotes.js", import.meta.url), "utf8")
  .replace(/import\(\/\* @vite-ignore \*\/ "\/fork\/releases\.js"\)/, `import(${JSON.stringify(RELEASES_URL)})`);

test("patchnotes.js loads /fork/releases.js and builds no inline handlers", () => {
  assert.ok(POPUP_SOURCE.includes(RELEASES_URL));
  assert.ok(!/\son[a-z]+="/.test(POPUP_SOURCE), "CSP: listeners only via addEventListener");
});

function matches(n, sel) {
  if (sel.startsWith(".")) return sel.slice(1).split(".").every((c) => n.classList.contains(c));
  if (sel === "a[href]") return n.tagName === "A" && n.getAttribute("href") !== null;
  return n.tagName === sel.toUpperCase();
}

function fakeElement(tag) {
  const classes = new Set();
  const handlers = new Map();
  return {
    tagName: tag.toUpperCase(), children: [], parent: null, attrs: {}, style: {}, hidden: false, disabled: false, id: "",
    _text: "", _html: "",
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } },
    appendChild(k) { this.append(k); return k; },
    insertBefore(k, ref) {
      if (k.parent) k.parent.children.splice(k.parent.children.indexOf(k), 1);
      k.parent = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(k); else this.children.splice(i, 0, k);
    },
    get nextSibling() { const s = this.parent?.children; return s ? s[s.indexOf(this) + 1] ?? null : null; },
    replaceChildren(...kids) { this.children = []; this._html = ""; this._text = ""; this.append(...kids); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    addEventListener(n, h) { handlers.set(n, [...(handlers.get(n) || []), h]); },
    dispatch(n, event) { (handlers.get(n) || []).forEach((h) => h(event)); },
    click() {
      if (!this.disabled) this.dispatch("click", { target: this, preventDefault() {}, stopPropagation() {} });
    },
    closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parent; } return null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
  };
}

const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function setupPopup({ releases = LIST, fetchFails = false, canInstall = true, install = () => new Promise(() => {}), locked = false, settings = {} } = {}) {
  const calls = [];
  const listeners = new Map();
  const opened = [];
  const docHandlers = [];
  const body = fakeElement("body");
  if (locked) body.classList.add("overlayLocked");
  globalThis.document = {
    body,
    documentElement: { lang: "de" },
    createElement: fakeElement,
    querySelector: () => null,
    addEventListener: (n, h) => docHandlers.push(h),
    removeEventListener: (n, h) => docHandlers.splice(docHandlers.indexOf(h), 1),
  };
  globalThis.requestAnimationFrame = (f) => f();
  const store = { ...settings };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          calls.push([cmd, args]);
          if (cmd === "fetch_url") {
            if (fetchFails) throw new Error("offline");
            return JSON.stringify(releases);
          }
          if (cmd === "fork_update_can_install") return canInstall;
          if (cmd === "fork_install_update") return install();
          return undefined;
        },
      },
      event: {
        listen: async (name, cb) => {
          listeners.set(name, cb);
          return () => listeners.delete(name);
        },
      },
    },
    javaBridge: {
      getSetting: (k) => store[k] ?? null,
      setSetting: (k, v) => { store[k] = v; },
      openBrowser: (u) => opened.push(u),
      updateOverlaySize: () => calls.push(["resize"]),
    },
    dpsData: { getVersion: () => "3.0.20" },
  };
  (0, eval)(POPUP_SOURCE);
  const popup = () => body.querySelector(".forkPatchnotes");
  const buttons = () => popup()?.querySelectorAll("button").filter((b) => b.classList.contains("forkPatchnotesButton")) ?? [];
  const button = (label) => buttons().find((b) => b.textContent === label);
  const text = (sel) => popup().querySelector(sel).textContent;
  return { api: window.ForkPatchnotes, calls, listeners, opened, store, popup, buttons, button, text, docHandlers };
}

const UPDATE = {
  msiUrl: "https://example.com/a.msi", archUrl: "", debUrl: "", rpmUrl: "",
  msiSha256: "ab".repeat(32), archSha256: "", debSha256: "", rpmSha256: "",
};
const offerArgs = (extra = {}) => ({ current: "3.0.19", latest: "3.0.20", notes: "", update: UPDATE, ...extra });

test("offer: notes since the installed version, install with progress", async () => {
  const s = setupPopup();
  assert.equal(s.api.offer(offerArgs({ current: "v3.0.18", latest: "v3.0.20" })), true);
  await settle();
  assert.equal(s.text(".forkPatchnotesTitle"), "Update verfügbar");
  assert.equal(s.text(".forkPatchnotesSub"), "v3.0.18 → v3.0.20");
  const html = s.popup().querySelector(".forkPatchnotesBody").innerHTML;
  assert.ok(html.includes("<h3>v3.0.20") && html.includes("<h3>v3.0.19"), html);
  assert.ok(!html.includes("<h3>v3.0.21") && !html.includes("<h3>v3.0.18"), html);
  assert.ok(!html.includes("Installation"), "Installation section dropped");
  assert.deepEqual(s.buttons().map((b) => b.textContent), ["Später", "Jetzt installieren"]);
  assert.deepEqual(s.calls.find((c) => c[0] === "fork_update_can_install")[1], { update: UPDATE });

  s.button("Jetzt installieren").click();
  await settle();
  assert.deepEqual(s.calls.find((c) => c[0] === "fork_install_update")[1], { update: UPDATE });
  assert.equal(s.popup().querySelector(".forkPatchnotesProgress").hidden, false);
  assert.ok(s.buttons().every((b) => b.disabled), "no closing while downloading");
  s.docHandlers[0]({ key: "Escape", stopPropagation() {} });
  assert.ok(s.popup(), "Escape does not close it while downloading");
  s.listeners.get("download-progress")({ payload: 42 });
  assert.equal(s.popup().querySelector(".forkPatchnotesBar").children[0].style.width, "42%");
  assert.equal(s.text(".forkPatchnotesStatus"), "Lade herunter … 42 %");
  s.listeners.get("download-progress")({ payload: 100 });
  assert.match(s.text(".forkPatchnotesStatus"), /starte die Installation/);
});

test("offer: a failed install says so and offers retry and the download page", async () => {
  const s = setupPopup({ install: async () => { throw "the downloaded package does not match the checksum"; } });
  s.api.offer(offerArgs());
  await settle();
  s.button("Jetzt installieren").click();
  await settle();
  assert.match(s.text(".forkPatchnotesStatus"), /^Update fehlgeschlagen: the downloaded package does not match the checksum/);
  assert.ok(s.popup().querySelector(".forkPatchnotesProgress").classList.contains("isError"));
  assert.deepEqual(s.buttons().map((b) => b.textContent), ["Später", "Download-Seite", "Erneut versuchen"]);
  assert.ok(s.buttons().every((b) => !b.disabled));
  assert.equal(s.listeners.has("download-progress"), false, "progress listener removed");
  s.button("Download-Seite").click();
  await settle();
  assert.deepEqual(s.opened, ["https://github.com/maarloms/A2Tools-DPS-Meter/releases/tag/v3.0.20"]);
  s.button("Später").click();
  assert.equal(s.popup(), null);
});

test("offer: where the app cannot install itself, the button opens the release page", async () => {
  const s = setupPopup({ canInstall: false });
  s.api.offer(offerArgs({ update: {} }));
  await settle();
  s.button("Download-Seite öffnen").click();
  await settle();
  assert.deepEqual(s.opened, ["https://github.com/maarloms/A2Tools-DPS-Meter/releases/tag/v3.0.20"]);
  assert.equal(s.calls.some((c) => c[0] === "fork_install_update"), false);
  assert.equal(s.popup(), null);
});

test("offer: without the release list, latest.json's notes stand in", async () => {
  const s = setupPopup({ fetchFails: true });
  s.api.offer(offerArgs({ notes: "**Neu**\r\n- aus latest.json" }));
  await settle();
  const html = s.popup().querySelector(".forkPatchnotesBody").innerHTML;
  assert.ok(html.includes("<h3>v3.0.20</h3><h4>Neu</h4><ul><li>aus latest.json</li></ul>"), html);
});

test("a locked overlay is unlocked while the popup is open and locked again after", async () => {
  const s = setupPopup({ locked: true });
  s.api.offer(offerArgs());
  await settle();
  const locks = () => s.calls.filter((c) => c[0] === "set_overlay_locked").map((c) => c[1]);
  assert.deepEqual(locks(), [{ locked: false }]);
  s.button("Später").click();
  await settle();
  assert.deepEqual(locks(), [{ locked: false }, { locked: true }]);
  assert.ok(s.calls.filter((c) => c[0] === "resize").length >= 2, "window resized on open and close");
});

test("an unlocked overlay is left alone", async () => {
  const s = setupPopup();
  s.api.offer(offerArgs());
  await settle();
  s.button("Später").click();
  assert.equal(s.calls.some((c) => c[0] === "set_overlay_locked"), false);
});

test("Escape closes the offer", async () => {
  const s = setupPopup();
  s.api.offer(offerArgs());
  await settle();
  s.docHandlers[0]({ key: "Escape", stopPropagation() {} });
  assert.equal(s.popup(), null);
  assert.equal(s.docHandlers.length, 0);
});

test("links in the notes open in the browser, only https", async () => {
  const s = setupPopup();
  s.api.offer(offerArgs());
  await settle();
  const body = s.popup().querySelector(".forkPatchnotesBody");
  for (const href of ["https://example.com/x", "http://example.com/y"]) {
    const a = fakeElement("a");
    a.setAttribute("href", href);
    body.append(a);
    let prevented = false;
    body.dispatch("click", { target: a, preventDefault: () => { prevented = true; } });
    assert.ok(prevented, "never navigates the meter");
  }
  assert.deepEqual(s.opened, ["https://example.com/x"]);
});

test("whatsNew: first start shows the installed version once and remembers it", async () => {
  const s = setupPopup();
  assert.equal(await s.api.whatsNew({ installed: "3.0.20" }), true);
  assert.equal(s.text(".forkPatchnotesTitle"), "Was ist neu");
  const html = s.popup().querySelector(".forkPatchnotesBody").innerHTML;
  assert.ok(html.includes("<h3>v3.0.20") && !html.includes("<h3>v3.0.19"), html);
  assert.equal(s.store["fork.patchnotes.seen"], "3.0.20");
  s.button("OK").click();
  assert.equal(s.popup(), null);
  assert.equal(await s.api.whatsNew({ installed: "3.0.20" }), false, "only once");
});

test("whatsNew: after an update, everything since the last version shown", async () => {
  const s = setupPopup({ settings: { "fork.patchnotes.seen": "3.0.18" } });
  assert.equal(await s.api.whatsNew({ installed: "v3.0.20" }), true);
  const html = s.popup().querySelector(".forkPatchnotesBody").innerHTML;
  assert.ok(html.includes("<h3>v3.0.20") && html.includes("<h3>v3.0.19") && !html.includes("<h3>v3.0.18"), html);
  assert.equal(s.store["fork.patchnotes.seen"], "3.0.20");
});

test("whatsNew: offline it waits for the next start", async () => {
  const s = setupPopup({ fetchFails: true, settings: { "fork.patchnotes.seen": "3.0.18" } });
  assert.equal(await s.api.whatsNew({ installed: "3.0.20" }), false);
  assert.equal(s.popup(), null);
  assert.equal(s.store["fork.patchnotes.seen"], "3.0.18");
});

test("whatsNew never covers an update offer", async () => {
  const s = setupPopup({ settings: { "fork.patchnotes.seen": "3.0.18" } });
  s.api.offer(offerArgs({ current: "3.0.20", latest: "3.0.21" }));
  assert.equal(await s.api.whatsNew({ installed: "3.0.20" }), false);
  assert.equal(s.text(".forkPatchnotesTitle"), "Update verfügbar");
  assert.equal(s.store["fork.patchnotes.seen"], "3.0.18");
});

test("an offer replaces an open Was ist neu", async () => {
  const s = setupPopup();
  await s.api.whatsNew({ installed: "3.0.20" });
  s.api.offer(offerArgs({ current: "3.0.20", latest: "3.0.21" }));
  await settle();
  assert.equal(s.text(".forkPatchnotesTitle"), "Update verfügbar");
  assert.equal(s.docHandlers.length, 1);
});

test("whatsNew: a version without a release (dev build) is marked seen without a popup", async () => {
  const s = setupPopup({ settings: { "fork.patchnotes.seen": "3.0.21" } });
  assert.equal(await s.api.whatsNew({ installed: "3.0.25" }), false);
  assert.equal(s.popup(), null);
  assert.equal(s.store["fork.patchnotes.seen"], "3.0.25");
});

test("demo and demoWhatsNew install nothing and remember nothing", async () => {
  const s = setupPopup();
  await s.api.demo();
  await settle();
  assert.ok(s.popup());
  assert.equal(s.calls.some((c) => c[0] === "fork_update_can_install"), false);
  assert.equal(await s.api.demoWhatsNew(), true);
  assert.equal(s.store["fork.patchnotes.seen"], undefined);
});

// ------------------------------------------------ checkRelease.js fork hook

const CHECK_SOURCE = readFileSync(new URL("../public/src/js/checkRelease.js", import.meta.url), "utf8");

// The 6-hour re-check's interval is only recorded: a real one would keep node
// running after the tests, and a test runs it by hand.
const intervals = [];
globalThis.setInterval = (fn, ms) => {
  intervals.push({ fn, ms });
  return intervals.length;
};

async function runCheckRelease({ withPopup, onAvailable, manifest = { version: "3.0.20" } }) {
  const calls = [];
  const offers = [];
  intervals.length = 0;
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          calls.push([cmd, args]);
          if (cmd === "fetch_url") {
            return JSON.stringify({ msiUrl: "https://x/a.msi", msiSha256: "ab".repeat(32), notes: "**Neu**\n- x", ...manifest });
          }
          return false;
        },
      },
    },
    dpsData: { getVersion: () => "3.0.19" },
    javaBridge: { openBrowser() {} },
  };
  if (withPopup) window.ForkPatchnotes = { offer: (info) => { offers.push(info); return true; } };
  (0, eval)(CHECK_SOURCE);
  window.ReleaseChecker.start(onAvailable);
  for (let i = 0; i < 50 && !calls.some((c) => c[0] === "show_update_window") && !offers.length && !intervals.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  // Let the first run finish (onAvailable comes after the offer).
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return { calls, offers };
}

// One 6-hour re-check, run by hand.
async function recheck() {
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 6 * 60 * 60 * 1000);
  await intervals[0].fn();
}

test("checkRelease hands the update with its notes to the popup", async () => {
  const { calls, offers } = await runCheckRelease({ withPopup: true });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].current, "v3.0.19");
  assert.equal(offers[0].latest, "v3.0.20");
  assert.equal(offers[0].notes, "**Neu**\n- x");
  assert.equal(offers[0].update.msiUrl, "https://x/a.msi");
  assert.equal(offers[0].update.msiSha256, "ab".repeat(32));
  assert.equal(calls.some((c) => c[0] === "show_update_window"), false);
});

test("checkRelease falls back to the native dialog without the popup", async () => {
  const { calls } = await runCheckRelease({ withPopup: false });
  const dialog = calls.find((c) => c[0] === "show_update_window");
  assert.ok(dialog);
  assert.equal(dialog[1].latest, "v3.0.20");
  assert.equal(dialog[1].msiSha256, "ab".repeat(32));
});

test("at start the popup comes up and the title's button opens it again", async () => {
  const available = [];
  const { calls, offers } = await runCheckRelease({ withPopup: true, onAvailable: (v) => available.push(v) });
  assert.equal(offers.length, 1);
  assert.deepEqual(available, ["v3.0.20"]);
  // The button: the popup again, nothing native; it stays until installing.
  assert.equal(await window.ReleaseChecker.offer(), false);
  assert.equal(offers.length, 2);
  assert.equal(offers[1].latest, "v3.0.20");
  assert.equal(calls.some((c) => c[0] === "show_update_window"), false);
});

test("Settings' check asks with the popup too", async () => {
  const { offers } = await runCheckRelease({ withPopup: true });
  const found = await window.ReleaseChecker.checkNow();
  assert.deepEqual(found, { state: "update", latest: "v3.0.20" });
  assert.equal(offers.length, 2);
});

test("the 6-hour re-check pops the popup up once per version, the button stays", async () => {
  const available = [];
  const manifest = { version: "3.0.20" };
  const { calls, offers } = await runCheckRelease({ withPopup: true, onAvailable: (v) => available.push(v), manifest });
  assert.equal(offers.length, 1);
  await recheck();
  await recheck();
  assert.equal(offers.length, 1, "same version: no popup again");
  assert.deepEqual(available, ["v3.0.20", "v3.0.20", "v3.0.20"], "the button stays");
  // The button still opens it.
  assert.equal(await window.ReleaseChecker.offer(), false);
  assert.equal(offers.length, 2);
  // A newer version: the popup once more, the button then offers that one.
  manifest.version = "3.0.21";
  await recheck();
  assert.equal(offers.length, 3);
  assert.equal(offers[2].latest, "v3.0.21");
  await recheck();
  assert.equal(offers.length, 3);
  await window.ReleaseChecker.offer();
  assert.equal(offers[3].latest, "v3.0.21");
  // Settings' check opens it whenever asked.
  assert.deepEqual(await window.ReleaseChecker.checkNow(), { state: "update", latest: "v3.0.21" });
  assert.equal(offers.length, 5);
  assert.equal(calls.some((c) => c[0] === "show_update_window"), false);
});

test("a version first seen in Settings doesn't pop up again on the re-check", async () => {
  const manifest = { version: "3.0.19" }; // current at start: nothing
  const { offers } = await runCheckRelease({ withPopup: true, manifest });
  assert.equal(offers.length, 0);
  manifest.version = "3.0.20";
  await window.ReleaseChecker.checkNow();
  assert.equal(offers.length, 1);
  await recheck();
  assert.equal(offers.length, 1);
  assert.equal(await window.ReleaseChecker.offer(), false, "the button opens it");
  assert.equal(offers.length, 2);
});
