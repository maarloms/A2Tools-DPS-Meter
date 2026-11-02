import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Fork rows (public/fork/meterstats.js) against upstream's value menu
// (DPS, damage, taken, HPS, healing, stagger + extra columns), with core.js's
// real number formatting.
const fakeClassList = () => {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, on) => {
      const want = on === undefined ? !set.has(c) : !!on;
      if (want) set.add(c);
      else set.delete(c);
      return want;
    },
    contains: (c) => set.has(c),
  };
};
const fakeNode = () => ({ textContent: "", style: {}, classList: fakeClassList() });
const fakeStatCell = (k) => {
  const parts = { b: fakeNode(), small: fakeNode(), ".forkStatStag": fakeNode(), ".forkStatHp > i": fakeNode() };
  return { dataset: { k }, classList: fakeClassList(), parts, querySelector: (sel) => parts[sel] ?? null };
};

function setup({
  forkSkin = true,
  mode = "dps",
  suffix = true,
  extras = [],
  strip = false,
  staggerLabel = "",
  showTotalDps = true,
} = {}) {
  const classes = new Set(forkSkin ? ["forkSkin"] : []);
  let stripEl = null;
  const document = {
    readyState: "loading",
    addEventListener() {},
    documentElement: { lang: "de", classList: { contains: (c) => classes.has(c) } },
    // No strip anchor unless asked for: mostly only the row text is under test.
    querySelector: () => (strip ? { after() {} } : null),
    createElement: () => {
      stripEl = {
        hidden: false,
        classList: fakeClassList(),
        children: [],
        set innerHTML(html) {
          this.children = [...html.matchAll(/data-k="(\w+)"/g)].map((m) => fakeStatCell(m[1]));
        },
      };
      return stripEl;
    },
  };
  const window = { addEventListener() {} };
  const context = vm.createContext({ window, console, document });
  vm.runInContext(readFileSync(new URL("../public/src/js/core.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../public/fork/meterstats.js", import.meta.url), "utf8"), context);
  const core = vm.runInContext("Object.create(DpsApp.prototype)", context);
  core.displayMode = mode;
  core.extraMetrics = extras;
  core.showDpsSuffix = suffix;
  core.showTotalDps = showTotalDps;
  core.dpsFormatter = new Intl.NumberFormat("en-US"); // set in the constructor, skipped here
  core.roundDps = false;
  core.elBossHpText = { querySelector: () => ({ textContent: staggerLabel }) };
  return { core, meter: window.ForkMeter, strip: () => stripEl };
}

const dd = { id: "1", nickname: "Dd", dps: 12_000, totalDamage: 480_000, damageContribution: 80, hps: 0, healAmount: 0, damageReceived: 30_000, stagger: 6 };
const cleric = { id: "2", nickname: "Kk", dps: 3_000, totalDamage: 120_000, damageContribution: 20, hps: 1_500, healAmount: 60_000, damageReceived: 90_000, stagger: 2 };
// Upstream 2.0.69 lists healers that never hit anything with a row of their own.
const healer = { id: "3", nickname: "Hh", dps: 0, totalDamage: 0, damageContribution: 0, hps: 4_500, healAmount: 180_000, damageReceived: 0, stagger: 0 };
const rows = [dd, cleric, healer];

function textFor(mode, row, opts) {
  const { core, meter } = setup({ mode, ...opts });
  meter.rows(core, rows);
  return { ...meter.rowText(row), core };
}

test("dps: the damage in front, the damage share after; the main figure stays upstream's", () => {
  const t = textFor("dps", dd);
  assert.equal(t.total, t.core.formatAbbreviatedNumber(480_000));
  assert.equal(t.share, "80.0%");
  // No `dps` key: meter.js then draws metric.text, what the value menu picked.
  assert.equal("dps" in t, false);
});

test("totalDamage: the main figure is the damage, so no companion", () => {
  const t = textFor("totalDamage", dd);
  assert.equal(t.total, "");
  assert.equal(t.share, "80.0%");
  assert.equal("dps" in t, false);
});

test("hps: the healing in front, the healing share after", () => {
  const t = textFor("hps", cleric);
  assert.equal(t.total, t.core.formatAbbreviatedNumber(60_000));
  assert.equal(t.share, "25.0%");
  assert.equal("dps" in t, false);
});

test("totalHeal: no companion, the same share as hps", () => {
  const hps = textFor("hps", cleric);
  const heal = textFor("totalHeal", cleric);
  assert.equal(heal.total, "");
  assert.equal(heal.share, hps.share);
});

test("damageReceived and stagger: share of that value, no companion", () => {
  const taken = textFor("damageReceived", cleric);
  assert.deepEqual([taken.total, taken.share], ["", "75.0%"]); // 90k of 120k
  const stag = textFor("stagger", dd);
  assert.deepEqual([stag.total, stag.share], ["", "75.0%"]); // 6 of 8
  assert.equal("dps" in stag, false);
});

test("a pure healer: its healing share, damage modes read 0 %", () => {
  const t = textFor("hps", healer);
  assert.equal(t.total, t.core.formatAbbreviatedNumber(180_000));
  assert.equal(t.share, "75.0%");
  assert.equal(textFor("totalHeal", dd).share, "0.0%");
  assert.equal(textFor("dps", healer).share, "0.0%");
});

test("extra columns on: no companion (the room goes to the extras)", () => {
  assert.equal(textFor("dps", dd, { extras: ["hps"] }).total, "");
  assert.equal(textFor("hps", cleric, { extras: ["dps"] }).total, "");
  assert.notEqual(textFor("dps", dd, { extras: [] }).total, "");
});

test("no data at all: shares 0 %, no division by zero", () => {
  for (const mode of ["hps", "damageReceived", "stagger"]) {
    const { core, meter } = setup({ mode });
    meter.rows(core, [{ id: "9", dps: 0, totalDamage: 0 }]);
    assert.equal(meter.rowText({ id: "9" }).share, "0.0%", mode);
  }
});

test("upstream themes keep upstream's text", () => {
  const { core, meter } = setup({ forkSkin: false, mode: "hps" });
  meter.rows(core, rows);
  assert.equal(meter.rowText(healer), null);
});

test("meter.js still draws metric.text when the skin gives no `dps` (guard for upstream merges)", () => {
  const src = readFileSync(new URL("../public/src/js/meter.js", import.meta.url), "utf8");
  assert.match(src, /forkText\?\.dps \?\? metric\.text/);
  assert.match(src, /forkText\?\.total/);
  assert.match(src, /forkText\?\.share/);
});

// ---- the strip: boss HP with its stagger %, the footer menu's "Party total" ----

const withBoss = { targetMaxHp: 1_000_000, targetCurrentHp: 600_000 };
const hpCell = (strip) => strip.children.find((c) => c.dataset.k === "hp");

test("strip: the boss stagger % rides the HP cell (the HP bar is hidden in the skin)", () => {
  const { core, meter, strip } = setup({ strip: true, staggerLabel: "STAG 42%" });
  meter.payload(core, withBoss);
  meter.rows(core, rows);
  const cell = hpCell(strip());
  assert.equal(cell.parts[".forkStatStag"].textContent, "STAG 42%");
  assert.equal(cell.parts.b.textContent, "60 %");
  assert.equal(strip().hidden, false);
});

test("strip: stagger turned off upstream (empty label) leaves the cell clean", () => {
  const { core, meter, strip } = setup({ strip: true, staggerLabel: "" });
  meter.payload(core, withBoss);
  meter.rows(core, rows);
  assert.equal(hpCell(strip()).parts[".forkStatStag"].textContent, "");
});

test("strip: no boss, no stagger text, the player count instead", () => {
  const { core, meter, strip } = setup({ strip: true, staggerLabel: "STAG 42%" });
  meter.payload(core, { targetMaxHp: 0 });
  meter.rows(core, rows);
  assert.equal(hpCell(strip()).parts[".forkStatStag"].textContent, "");
  assert.equal(hpCell(strip()).parts.b.textContent, "3");
});

test("strip: Party total off hides the totals, boss HP stays", () => {
  const off = setup({ strip: true, showTotalDps: false });
  off.meter.payload(off.core, withBoss);
  off.meter.rows(off.core, rows);
  assert.equal(off.strip().hidden, false);
  assert.equal(off.strip().classList.contains("noTotals"), true);
  const none = setup({ strip: true, showTotalDps: false });
  none.meter.payload(none.core, { targetMaxHp: 0 });
  none.meter.rows(none.core, rows);
  assert.equal(none.strip().hidden, true);
  const on = setup({ strip: true });
  on.meter.payload(on.core, { targetMaxHp: 0 });
  on.meter.rows(on.core, rows);
  assert.equal(on.strip().hidden, false);
  assert.equal(on.strip().classList.contains("noTotals"), false);
});
