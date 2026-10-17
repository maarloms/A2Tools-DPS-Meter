// Training-dummy test ("Puppen-Test"): numbers and history
// (public/fork/dummy-logic.js) and the popup flow (public/fork/dummy.js) on a
// small fake DOM with a fake backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const LOGIC_SRC = readFileSync(new URL("../public/fork/dummy-logic.js", import.meta.url), "utf8");
const UI_SRC = readFileSync(new URL("../public/fork/dummy.js", import.meta.url), "utf8");

// Values from the vm realm have other prototypes: compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => assert.deepEqual(plain(a), b);

function logic() {
  const ctx = vm.createContext({});
  vm.runInContext(LOGIC_SRC, ctx);
  return ctx.ForkDummyLogic;
}
const L = logic();

const skill = (code, dmg, hits, extra = {}) => ({ code, name: `S${code}`, dot: false, dmg, hits, crit: 0, multi: 0, back: 0, ...extra });
const result = (over = {}) => ({
  id: 1_000,
  durationMs: 60_000,
  startTs: 1_000,
  endTs: 61_000,
  profile: { name: "Marlon", serverId: 1304, class: "Gladiator", gearScore: 3210, combatPower: 98_765 },
  targets: [
    { targetId: 5, dmg: 50, hits: 1, skills: [skill(1, 50, 1)] },
    { targetId: 9, dmg: 6_000_000, hits: 12, skills: [
      skill(10, 3_000_000, 6, { crit: 3, multi: 2, back: 1 }),
      skill(20, 2_000_000, 4, { crit: 1 }),
      skill(10, 1_000_000, 2, { dot: true, name: "S10 - DOT", crit: 2 }),
    ] },
  ],
  ...over,
});

// --------------------------------------------------------------- numbers

test("pickTarget: the target with the most damage, nothing without damage", () => {
  assert.equal(L.pickTarget(result()).targetId, 9);
  assert.equal(L.pickTarget({ targets: [{ targetId: 3, dmg: 0 }] }), null);
  assert.equal(L.pickTarget(null), null);
  // A tie goes to the lower id, so the pick does not depend on order.
  assert.equal(L.pickTarget({ targets: [{ targetId: 8, dmg: 5 }, { targetId: 4, dmg: 5 }] }).targetId, 4);
});

test("summarize: DPS over the whole window, rates over direct hits, other targets left out", () => {
  const run = L.summarize(result(), { targetName: "Trainingspuppe" });
  assert.equal(run.dmg, 6_000_000);
  assert.equal(run.dps, 100_000); // 6 Mio. / 60 s, however early the last hit was
  assert.equal(run.critPct, 40); // 4 of 10 direct hits; the DoT's "crits" do not count
  assert.equal(run.multiPct, 20);
  assert.equal(run.backPct, 10);
  assert.equal(run.hasMulti, true);
  assert.equal(run.otherDmg, 50);
  assert.equal(run.targetName, "Trainingspuppe");
  same([run.char, run.serverId, run.durationS, run.gearScore, run.combatPower], ["Marlon", 1304, 60, 3210, 98_765]);
  same(run.skills.map((s) => [s.code, s.dot, s.pct, s.hits]), [[10, false, 50, 6], [20, false, 33.3, 4], [10, true, 16.7, 2]]);
  assert.equal(L.summarize({ targets: [] }), null);
});

test("summarize: more than eight skills fold into Sonstige", () => {
  const skills = Array.from({ length: 11 }, (_, i) => skill(i + 1, 100 - i, 1));
  const total = skills.reduce((a, s) => a + s.dmg, 0);
  const run = L.summarize({ ...result(), targets: [{ targetId: 1, dmg: total, hits: 11, skills }] });
  assert.equal(run.skills.length, 9);
  const rest = run.skills[8];
  same([rest.name, rest.dmg, rest.hits, rest.other], ["Sonstige", 92 + 91 + 90, 3, true]);
  assert.equal(run.hasMulti, false);
});

test("compare: against the best and the previous run, never against itself", () => {
  const r = (id, at, dps) => ({ id, at, dps });
  const runs = [r(1, 10, 100), r(2, 20, 120), r(3, 30, 90)];
  const now = r(4, 40, 126);
  const c = L.compare([...runs, now], now);
  assert.equal(c.isBest, true);
  assert.ok(Math.abs(c.best.deltaPct - 5) < 1e-9);
  assert.ok(Math.abs(c.last.deltaPct - 40) < 1e-9);
  // An older run shown again: "last" is the one before it, best is over all others.
  const old = L.compare([...runs, now], runs[1]);
  assert.equal(old.last.dps, 100);
  assert.equal(old.best.dps, 126);
  assert.equal(old.isBest, false);
  const first = L.compare([now], now);
  same([first.best, first.last, first.isBest], [null, null, true]);
});

test("German formats", () => {
  assert.equal(L.fmtDelta(4.2), "+4,2 %");
  assert.equal(L.fmtDelta(-12.345), "−12,3 %");
  assert.equal(L.fmtDelta(0.01), "±0,0 %");
  assert.equal(L.fmtDelta(null), "");
  assert.equal(L.fmtPct(40), "40,0 %");
  assert.equal(L.fmtInt(1234567), "1.234.567");
  assert.equal(L.fmtCompact(6_000_000), "6 Mio.");
  assert.equal(L.fmtClock(59_001), "1:00");
  assert.equal(L.fmtClock(-5), "0:00");
  same(L.DURATIONS.map(L.fmtDuration), ["60 s", "3 min", "5 min"]);
  assert.equal(L.className("Templar"), "Templer");
});

// --------------------------------------------------------------- history

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test("history: per character, server and duration; newest 50 kept; once per run id", () => {
  let store = L.emptyStore();
  const run = (i, durationS = 60, char = "Marlon") => ({ id: i, at: i, dps: i, durationS, char, serverId: 1304 });
  for (let i = 1; i <= 55; i++) store = L.addRun(store, run(i));
  store = L.addRun(store, run(55)); // the same run again
  store = L.addRun(store, run(7, 180));
  store = L.addRun(store, run(8, 60, "Zweitchar"));
  const key = L.historyKey("Marlon", 1304, 60);
  const list = L.runsFor(store, key);
  assert.equal(list.length, 50);
  same([list[0].id, list[49].id], [6, 55]);
  assert.equal(L.runsFor(store, L.historyKey("Marlon", 1304, 180)).length, 1);
  assert.equal(L.runsFor(store, L.historyKey("Zweitchar", 1304, 60)).length, 1);
  assert.equal(L.historyKey("", 0, 60), "?@0|60");
});

test("history: delete one run, the key goes with the last one", () => {
  let store = L.addRun(L.addRun(L.emptyStore(), { id: 1, at: 1, durationS: 60, char: "A" }), { id: 2, at: 2, durationS: 60, char: "A" });
  const key = L.historyKey("A", 0, 60);
  store = L.removeRun(store, key, 1);
  same(L.runsFor(store, key).map((r) => r.id), [2]);
  store = L.removeRun(store, key, 2);
  assert.equal(key in store.runs, false);
});

test("history: load and save survive broken or foreign data", () => {
  const s = memoryStorage();
  same(L.load(s), { v: 1, runs: {} });
  s.setItem(L.STORE_KEY, "{kaputt");
  same(L.load(s), { v: 1, runs: {} });
  s.setItem(L.STORE_KEY, JSON.stringify({ v: 2, runs: {} }));
  same(L.load(s), { v: 1, runs: {} });
  s.setItem(L.STORE_KEY, JSON.stringify({ v: 1, runs: { a: [{ id: 1 }], b: "x" } }));
  same(Object.keys(L.load(s).runs), ["a"]);
  assert.equal(L.save(s, L.addRun(L.emptyStore(), { id: 3, at: 3, durationS: 60, char: "A" })), true);
  assert.equal(L.load(s).runs[L.historyKey("A", 0, 60)][0].id, 3);
  assert.equal(L.save({ setItem() { throw new Error("voll"); } }, L.emptyStore()), false);
});

test("sparkPoints: scaled into the box, flat line in the middle", () => {
  assert.equal(L.sparkPoints([1, 2, 3], 100, 20, 0), "0,20 50,10 100,0");
  assert.equal(L.sparkPoints([5, 5], 100, 20, 0), "0,10 100,10");
  assert.equal(L.sparkPoints([], 100, 20), "");
});

// ------------------------------------------------- dummy.js, fake DOM

function fakeElement(tag) {
  const classes = new Set();
  const handlers = new Map();
  const e = {
    tagName: String(tag).toUpperCase(), children: [], parent: null, attrs: {}, style: {}, hidden: false, disabled: false,
    id: "", title: "", type: "", value: "", selected: false, _text: "", _html: "",
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => (on ?? !classes.has(c) ? classes.add(c) : classes.delete(c)),
    },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } },
    appendChild(k) { this.append(k); return k; },
    prepend(k) { k.parent = this; this.children.unshift(k); },
    after(k) { const s = this.parent.children; k.parent = this.parent; s.splice(s.indexOf(this) + 1, 0, k); },
    replaceChildren(...kids) { this.children = []; this._html = ""; this._text = ""; this.append(...kids); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    addEventListener(n, h) { handlers.set(n, [...(handlers.get(n) || []), h]); },
    dispatch(n, event) { (handlers.get(n) || []).forEach((h) => h(event)); },
    click() { if (!this.disabled) this.dispatch("click", { target: this, preventDefault() {}, stopPropagation() {} }); },
    querySelectorAll(sel) {
      const out = [];
      const want = sel.slice(1).split(".");
      const walk = (n) => { for (const c of n.children) { if (want.every((w) => c.classList.contains(w))) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
  };
  return e;
}

// A fixed clock for the popup and the fake backend.
const T = Date.UTC(2026, 9, 17, 12, 0, 0);
class FixedDate extends Date {
  constructor(...a) { super(...(a.length ? a : [T])); }
  static now() { return T; }
}

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function setupUi({ hasLocal = true, locked = false, storage = memoryStorage() } = {}) {
  const calls = [];
  const backend = { phase: "idle", now: 0, durationMs: 0, damage: 0, hasLocal, result: null };
  const body = fakeElement("body");
  if (locked) body.classList.add("overlayLocked");
  const header = fakeElement("div");
  header.className = "headerBtns";
  const timerBtn = fakeElement("div");
  timerBtn.className = "headerBtn timerBtn";
  header.append(timerBtn);
  const document = {
    body,
    readyState: "complete",
    documentElement: { lang: "de" },
    createElement: fakeElement,
    createElementNS: (_ns, tag) => fakeElement(tag),
    querySelector: (sel) => (sel === ".headerBtns" ? header : null),
    addEventListener() {},
    removeEventListener() {},
  };
  const ctx = vm.createContext({
    document, console, Date: FixedDate, Math, JSON, Number, String, Object, Array, Map, Promise,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (f) => f(),
    localStorage: storage,
    A2_VIEW: "main",
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          calls.push([cmd, args]);
          if (cmd === "fork_dummy_status") return { ...backend, now: T };
          if (cmd === "fork_dummy_start") Object.assign(backend, { phase: "armed", durationMs: args.durationS * 1000, result: null });
          if (cmd === "fork_dummy_cancel") Object.assign(backend, { phase: "idle", result: null });
          return undefined;
        },
      },
    },
    javaBridge: { updateOverlaySize: () => calls.push(["resize"]) },
    dpsData: { getDetailsContext: () => JSON.stringify({ targets: [{ targetId: 9, targetName: "Trainingspuppe" }] }) },
  });
  ctx.window = ctx;
  vm.runInContext(LOGIC_SRC, ctx);
  vm.runInContext(UI_SRC, ctx);
  const button = header.children[1];
  const popup = () => body.querySelector(".forkDummy");
  const buttons = () => popup()?.querySelectorAll(".forkPatchnotesButton") ?? [];
  const press = (label) => {
    const b = buttons().find((x) => x.textContent === label);
    assert.ok(b, `button ${label}`);
    b.click();
  };
  return { ctx, calls, backend, body, header, button, popup, buttons, press, storage };
}

test("dummy.js: the button sits after the timer button, opens and closes the popup", async () => {
  const ui = setupUi();
  await settle();
  assert.ok(ui.button.classList.contains("forkDummyBtn"));
  assert.ok(ui.button.parent === ui.header && ui.header.children[0].classList.contains("timerBtn"));
  ui.button.click();
  await settle();
  assert.ok(ui.popup().classList.contains("forkPatchnotes"), "same frame as the patch notes: the window grows for it");
  assert.ok(ui.calls.some(([c]) => c === "resize"));
  assert.match(ui.popup().textContent, /Noch keine Läufe/);
  ui.button.click();
  assert.equal(ui.popup(), null);
  assert.ok(!/\son[a-z]+="/.test(UI_SRC), "CSP: listeners only via addEventListener");
});

test("dummy.js: start, ready, countdown, result saved and compared, delete a run", async () => {
  const ui = setupUi();
  await settle();
  ui.button.click();
  await settle();
  // Pick 3 min, then start.
  ui.popup().querySelectorAll(".forkDummyDuration")[1].click();
  ui.press("Starten");
  await settle();
  same(ui.calls.find(([c]) => c === "fork_dummy_start")[1], { durationS: 180 });
  assert.match(ui.popup().textContent, /Bereit – startet beim ersten Treffer/);
  assert.equal(ui.button.querySelector(".forkDummyBtnTime").textContent, "bereit");

  const now = T;
  Object.assign(ui.backend, { phase: "running", startTs: now - 30_000, endTs: now + 150_000, damage: 3_000_000 });
  await ui.ctx.ForkDummy.poll();
  assert.equal(ui.popup().querySelector(".forkDummyClock").textContent, "2:30");
  assert.match(ui.popup().querySelector(".forkDummyLiveDmg").textContent, /100\.000 DPS/);

  // A best run from before, then this one finishes.
  const key = L.historyKey("Marlon", 1304, 180);
  const old = { id: 5, at: 5, durationS: 180, char: "Marlon", serverId: 1304, dps: 25_000, skills: [] };
  L.save(ui.storage, L.addRun(L.emptyStore(), old));
  const res = result({ id: now, startTs: now, durationMs: 180_000 });
  Object.assign(ui.backend, { phase: "done", result: res });
  await ui.ctx.ForkDummy.poll();
  const text = ui.popup().textContent;
  assert.match(text, /33\.333/); // 6 Mio. / 180 s
  assert.match(text, /Neuer Bestwert \(\+33,3 %\)/);
  assert.match(text, /\+33,3 % zum letzten Lauf/);
  assert.match(text, /Ziel: Trainingspuppe/);
  assert.match(text, /Kampfkraft/);
  assert.equal(L.runsFor(L.load(ui.storage), key).length, 2);

  // Polling the same result again does not add it twice.
  await ui.ctx.ForkDummy.poll();
  assert.equal(L.runsFor(L.load(ui.storage), key).length, 2);

  // Delete the old run from the list.
  const rows = ui.popup().querySelectorAll(".forkDummyRun");
  assert.equal(rows.length, 2);
  rows[1].querySelector(".forkDummyRunDel").click();
  same(L.runsFor(L.load(ui.storage), key).map((r) => r.id), [now]);
});

test("dummy.js: cancel while ready, warning without a known character, locked overlay unlocked while open", async () => {
  const ui = setupUi({ hasLocal: false, locked: true });
  await settle();
  ui.button.click();
  await settle();
  assert.ok(ui.calls.some(([c, a]) => c === "set_overlay_locked" && a.locked === false));
  ui.press("Starten");
  await settle();
  assert.match(ui.popup().textContent, /noch nicht erkannt/);
  // Polling without a change keeps the buttons: a rebuilt one would lose a click.
  const before = ui.buttons()[0];
  await ui.ctx.ForkDummy.poll();
  assert.equal(ui.buttons()[0], before);
  ui.press("Abbrechen");
  await settle();
  assert.ok(ui.calls.some(([c]) => c === "fork_dummy_cancel"));
  assert.equal(ui.button.querySelector(".forkDummyBtnTime").hidden, true);
  ui.popup().querySelector(".forkPatchnotesClose").click();
  assert.ok(ui.calls.some(([c, a]) => c === "set_overlay_locked" && a.locked === true));
});

test("dummy.js: a test that finishes with the popup closed opens it with the result", async () => {
  const ui = setupUi();
  await settle();
  Object.assign(ui.backend, { phase: "running", startTs: 1, endTs: 2, durationMs: 60_000 });
  await ui.ctx.ForkDummy.poll();
  assert.equal(ui.popup(), null);
  Object.assign(ui.backend, { phase: "done", result: result() });
  await ui.ctx.ForkDummy.poll();
  assert.ok(ui.popup());
  assert.match(ui.popup().textContent, /Erster Lauf mit dieser Dauer/);
});
