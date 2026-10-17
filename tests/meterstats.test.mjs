import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Fork rows (public/fork/meterstats.js) against upstream's display modes
// (DPS/DMG/both/HPS/HEAL), with core.js's real number formatting.
function setup({ forkSkin = true, mode = "dps", suffix = true } = {}) {
  const classes = new Set(forkSkin ? ["forkSkin"] : []);
  const document = {
    readyState: "loading",
    addEventListener() {},
    documentElement: { lang: "de", classList: { contains: (c) => classes.has(c) } },
    querySelector: () => null, // no strip anchor: only the row text is under test
  };
  const window = { addEventListener() {} };
  const context = vm.createContext({ window, console, document });
  vm.runInContext(readFileSync(new URL("../public/src/js/core.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../public/fork/meterstats.js", import.meta.url), "utf8"), context);
  const core = vm.runInContext("Object.create(DpsApp.prototype)", context);
  core.displayMode = mode;
  core.showDpsSuffix = suffix;
  core.dpsFormatter = new Intl.NumberFormat("en-US"); // set in the constructor, skipped here
  core.roundDps = false;
  return { core, meter: window.ForkMeter };
}

const dd = { id: "1", nickname: "Dd", dps: 12_000, totalDamage: 480_000, damageContribution: 80, hps: 0, healAmount: 0 };
const cleric = { id: "2", nickname: "Kk", dps: 3_000, totalDamage: 120_000, damageContribution: 20, hps: 1_500, healAmount: 60_000 };
// Upstream 2.0.69 lists healers that never hit anything with a row of their own.
const healer = { id: "3", nickname: "Hh", dps: 0, totalDamage: 0, damageContribution: 0, hps: 4_500, healAmount: 180_000 };
const rows = [dd, cleric, healer];

function textFor(mode, row, opts) {
  const { core, meter } = setup({ mode, ...opts });
  meter.rows(core, rows);
  return { ...meter.rowText(row), core };
}

for (const mode of ["dps", "totalDamage", "both"]) {
  test(`${mode}: damage, DPS and damage share`, () => {
    const t = textFor(mode, dd);
    assert.equal(t.total, t.core.formatAbbreviatedNumber(480_000));
    assert.equal(t.dps, `${t.core.formatDpsThousands(12_000)}/s`);
    assert.equal(t.share, "80.0%");
  });
}

test("hps: healing, HPS and share of the healing", () => {
  const t = textFor("hps", cleric);
  assert.equal(t.total, t.core.formatAbbreviatedNumber(60_000));
  assert.equal(t.dps, `${t.core.formatDpsThousands(1_500)}/s`);
  assert.equal(t.share, "25.0%");
});

test("totalHeal: the same readout as hps", () => {
  const hps = textFor("hps", cleric);
  const heal = textFor("totalHeal", cleric);
  assert.deepEqual([heal.total, heal.dps, heal.share], [hps.total, hps.dps, hps.share]);
});

test("a pure healer shows its healing, not 0/s", () => {
  const t = textFor("hps", healer);
  assert.equal(t.dps, `${t.core.formatDpsThousands(4_500)}/s`);
  assert.notEqual(t.dps, "0/s");
  assert.equal(t.total, t.core.formatAbbreviatedNumber(180_000));
  assert.equal(t.share, "75.0%");
  // ...and a damage dealer in the heal modes reads 0 rather than its DPS.
  const d = textFor("totalHeal", dd);
  assert.equal(d.dps, `${d.core.formatDpsThousands(0)}/s`);
  assert.equal(d.share, "0.0%");
});

test("no healing at all: share 0 %, no division by zero", () => {
  const { core, meter } = setup({ mode: "hps" });
  meter.rows(core, [dd]);
  assert.equal(meter.rowText(dd).share, "0.0%");
});

test("follows upstream's DPS suffix setting", () => {
  assert.equal(textFor("dps", dd, { suffix: false }).dps.endsWith("/s"), false);
  assert.equal(textFor("hps", healer, { suffix: false }).dps.endsWith("/s"), false);
});

test("upstream themes keep upstream's text", () => {
  const { core, meter } = setup({ forkSkin: false, mode: "hps" });
  meter.rows(core, rows);
  assert.equal(meter.rowText(healer), null);
});
