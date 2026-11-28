// Optimizer-Rechenkern (public/js/optimizer-core.js): synthetische Beobachtungen, keine Netzabfragen.
import test from "node:test";
import assert from "node:assert/strict";
import { buildTable, lookup, quality, chanceBetter, chanceAtLeast, topValue, totals, suggestRerolls, genusPlan, rerollCost, costsFilled, TARGET_BELOW, TARGET_MET } from "../public/js/optimizer-core.js";

const observed = {
  entries: [
    { slot: "Gloves", itemLevel: 54, grade: "Unique", stat: "WeaponFixingDamage", name: "Attack", histogram: { 10: 2, 12: 4, 14: 3, 16: 1 } },
    { slot: "Gloves", itemLevel: 54, grade: "Unique", stat: "Critical", name: "Critical Hit", histogram: { 20: 5, 30: 5 } },
    { slot: "Gloves", itemLevel: 54, grade: "Unique", stat: "WeaponAccuracy", name: "Accuracy", histogram: { 5: 3, 8: 3, 10: 4 } },
    { slot: "Boots", itemLevel: 50, grade: "Unique", stat: "Critical", name: "Critical Hit", histogram: { 10: 2, 20: 2 } },
    { slot: "Boots", itemLevel: 54, grade: "Unique", stat: "Critical", name: "Critical Hit", histogram: { 30: 4 } },
  ],
};
const table = buildTable(observed);

test("Verteilung: Min/Max/Mittel, gepoolt bei fehlender Stufe", () => {
  const d = lookup(table, "Gloves", 54, "WeaponFixingDamage");
  assert.deepEqual([d.min, d.max, d.samples, d.pooled], [10, 16, 10, false]);
  assert.equal(d.mean, 12.6);
  const p = lookup(table, "Boots", 99, "Critical");
  assert.equal(p.pooled, true);
  assert.equal(p.samples, 8);
  assert.equal(lookup(table, "Helmet", 54, "Critical"), null);
  // zu wenige Beobachtungen → keine Aussage
  assert.equal(lookup(buildTable({ entries: [{ slot: "A", itemLevel: 1, stat: "x", name: "x", histogram: { 1: 2 } }] }), "A", 1, "x"), null);
});

test("Qualität und Chancen", () => {
  const d = lookup(table, "Gloves", 54, "WeaponFixingDamage");
  assert.equal(quality(10, d), 0);
  assert.equal(quality(16, d), 1);
  assert.equal(quality(13, d), 0.5);
  assert.equal(chanceBetter(12, d), 0.4);
  assert.equal(chanceAtLeast(14, d), 0.4);
  assert.equal(topValue(d, 10), 16);
  assert.equal(topValue(d, 50), 12);
  assert.equal(quality(5, { min: 3, max: 3 }), null);
});

test("Summen Präzision/Krit", () => {
  const t = totals([{ subStats: [{ id: "Critical", value: "20" }, { id: "WeaponAccuracy", value: "8" }] }, { subStats: [{ id: "Critical", value: "10" }, { id: "WeaponFixingDamage", value: "12" }] }]);
  assert.deepEqual(t, { accuracy: 8, crit: 30 });
});

const items = [{ slot: "Gloves", name: "Handschuhe", level: 54, subStats: [{ id: "WeaponFixingDamage", name: "Attack", value: "10" }, { id: "Critical", name: "Critical Hit", value: "20" }, { id: "Unbekannt", name: "?", value: "5" }] }];

test("Reroll-Vorschläge: niedrigster Wurf zuerst, Unbekanntes ans Ende, Ziele gewichten", () => {
  let r = suggestRerolls(table, items, {});
  assert.equal(r.rows[0].stat, "WeaponFixingDamage"); // 10 vs. Ø 12,6 → +20,6 %
  assert.ok(Math.abs(r.rows[0].deltaPct - 20.63) < 0.1);
  assert.equal(r.rows.at(-1).known, false);
  // Krit-Ziel nicht erreicht → 1,5×; erreicht → 0,25×
  const base = suggestRerolls(table, items, {}).rows.find((x) => x.stat === "Critical").score;
  const below = suggestRerolls(table, items, { targetCrit: 100 }).rows.find((x) => x.stat === "Critical").score;
  const met = suggestRerolls(table, items, { targetCrit: 10 }).rows.find((x) => x.stat === "Critical").score;
  assert.ok(Math.abs(below - base * TARGET_BELOW) < 1e-9 && Math.abs(met - base * TARGET_MET) < 1e-9);
  r = suggestRerolls(table, items, { weights: { WeaponFixingDamage: 0 } });
  assert.notEqual(r.rows[0].stat, "WeaponFixingDamage");
});

test("Genus-Plan: Chance, Versuche, Kosten nur mit Tabelle", () => {
  let rows = genusPlan(table, items, { rerollCosts: { default: { kinah: null, petSoul: null } } }, 10);
  const atk = rows.find((x) => x.stat === "WeaponFixingDamage");
  assert.equal(atk.target, 16);
  assert.equal(atk.chance, 0.1);
  assert.equal(atk.expectedTries, 10);
  assert.equal(atk.cost, null);
  assert.equal(costsFilled({ rerollCosts: { default: { kinah: null, petSoul: null } } }), false);
  const costs = { rerollCosts: { default: { kinah: 1000, petSoul: null }, Gloves: { kinah: 2000, petSoul: 3 } } };
  rows = genusPlan(table, items, costs, 10);
  assert.deepEqual(rows.find((x) => x.stat === "WeaponFixingDamage").cost, { kinah: 20000, petSoul: 30 });
  assert.equal(costsFilled(costs), true);
  assert.deepEqual(rerollCost(costs, "Helmet"), { kinah: 1000, petSoul: null });
  // Ziel schon erreicht → keine Versuche
  assert.equal(genusPlan(table, [{ ...items[0], subStats: [{ id: "Critical", value: "30" }] }], null, 50)[0].reached, true);
});
