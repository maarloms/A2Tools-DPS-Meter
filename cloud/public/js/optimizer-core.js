// Gear-/Genus-Optimizer: reine Rechenlogik ohne DOM (per node --test prüfbar). Läuft nur im Browser des Nutzers.
//
// MODELL (offen dokumentiert, siehe auch docs/optimizer-modell.md):
//  Datenbasis ist `data/substat-observed.json` – BEOBACHTETE Würfe echter Charaktere (Slot, Gegenstandsstufe, Stat),
//  keine offiziellen Spielwerte. Je (Slot, Stufe, Stat) liegt eine Häufigkeitsverteilung der gesehenen Werte vor.
//  Annahme: ein Reroll würfelt den Wert desselben Stats NEU aus dieser Verteilung (Ziehen mit Zurücklegen).
//  Ob das Spiel genau so rollt, ist nicht belegt – deshalb ist alles als Schätzung beschriftet.
//  - Qualität eines Wurfs   q = (Wert − Min) / (Max − Min)  (0 = schlechtester, 1 = bester gesehener Wert)
//  - Erwartete Änderung     Δ = E[neuer Wert] − aktueller Wert, relativ zum Mittelwert des Stats (in Prozentpunkten)
//  - Chance auf Besser      P = Anteil der Beobachtungen mit Wert > aktuell; erwartete Versuche = 1 / P
//  - Gewichtung             Nutzer stellt Gewicht je Stat ein; Ziel-Stats (Präzision, Krit) zählen 1,5× solange das
//                           Ziel (Summe über alle Zufallswerte der Ausrüstung) nicht erreicht ist, danach 0,25×.
//  - Rang eines Rerolls     gewichtetes Δ (Prozentpunkte) – je höher, desto lohnender.

export const TARGET_BELOW = 1.5;
export const TARGET_MET = 0.25;

const keyOf = (slot, level, stat) => `${slot}|${level}|${stat}`;
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Verteilungen aus dem Messergebnis indizieren (exakt je Stufe + gepoolt je Slot/Stat) */
export function buildTable(observed) {
  const exact = new Map();
  const pooled = new Map();
  const add = (map, key, hist, name) => {
    const e = map.get(key) ?? { values: {}, name };
    for (const [v, n] of Object.entries(hist)) e.values[v] = (e.values[v] ?? 0) + n;
    map.set(key, e);
  };
  for (const e of observed?.entries ?? []) {
    add(exact, keyOf(e.slot, e.itemLevel, e.stat), e.histogram, e.name);
    add(pooled, `${e.slot}|*|${e.stat}`, e.histogram, e.name);
  }
  const finish = (m) => {
    for (const e of m.values()) {
      const vals = Object.entries(e.values).map(([v, n]) => [Number(v), n]).filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
      e.list = vals;
      e.samples = sum(vals.map(([, n]) => n));
      e.min = vals[0]?.[0] ?? 0;
      e.max = vals.at(-1)?.[0] ?? 0;
      e.mean = e.samples ? sum(vals.map(([v, n]) => v * n)) / e.samples : 0;
    }
  };
  finish(exact);
  finish(pooled);
  return { exact, pooled };
}

/** Verteilung für einen Wurf: erst gleiche Stufe, sonst über alle Stufen des Slots gepoolt */
export function lookup(table, slot, level, stat) {
  const e = table.exact.get(keyOf(slot, level, stat));
  if (e && e.samples >= 3) return { ...e, pooled: false };
  const p = table.pooled.get(`${slot}|*|${stat}`);
  return p && p.samples >= 3 ? { ...p, pooled: true } : null;
}

export const quality = (v, d) => (d && d.max > d.min ? Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min))) : null);
export const chanceBetter = (v, d) => (d && d.samples ? sum(d.list.filter(([x]) => x > v).map(([, n]) => n)) / d.samples : 0);
export const chanceAtLeast = (v, d) => (d && d.samples ? sum(d.list.filter(([x]) => x >= v).map(([, n]) => n)) / d.samples : 0);

/** Wert, ab dem die obersten `top` Prozent der Beobachtungen liegen (z. B. 10 → oberes Zehntel) */
export function topValue(d, top) {
  if (!d || !d.samples) return null;
  const need = Math.max(1, Math.ceil((d.samples * top) / 100));
  let got = 0;
  for (let i = d.list.length - 1; i >= 0; i--) {
    got += d.list[i][1];
    if (got >= need) return d.list[i][0];
  }
  return d.min;
}

export const isAccuracy = (id) => /accura|precis/i.test(id);
export const isCrit = (id) => /crit/i.test(id) && !/resist|defen|avoid|evad/i.test(id);

/** Summe der Zufallswerte je Zielgruppe über die ganze Ausrüstung */
export function totals(items) {
  let accuracy = 0;
  let crit = 0;
  for (const it of items) {
    for (const s of it.subStats ?? []) {
      const v = Number(s.value);
      if (!Number.isFinite(v)) continue;
      if (isAccuracy(s.id)) accuracy += v;
      else if (isCrit(s.id)) crit += v;
    }
  }
  return { accuracy, crit };
}

/**
 * Reroll-Vorschläge. items: [{ slot, name, level, subStats:[{id,name,value}] }]
 * opts: { weights:{statId:number}, targetAccuracy, targetCrit }
 * → sortiert nach gewichtetem Δ (absteigend)
 */
export function suggestRerolls(table, items, opts = {}) {
  const t = totals(items);
  const weights = opts.weights ?? {};
  const rows = [];
  for (const it of items) {
    for (const s of it.subStats ?? []) {
      const v = Number(s.value);
      const d = lookup(table, it.slot, it.level, s.id);
      if (!Number.isFinite(v) || !d) {
        rows.push({ slot: it.slot, item: it.name, stat: s.id, name: s.name, value: v, known: false });
        continue;
      }
      let w = weights[s.id] ?? 1;
      const target = isAccuracy(s.id) ? opts.targetAccuracy : isCrit(s.id) ? opts.targetCrit : null;
      if (target != null && target > 0) w *= (isAccuracy(s.id) ? t.accuracy : t.crit) < target ? TARGET_BELOW : TARGET_MET;
      const delta = d.mean ? ((d.mean - v) / d.mean) * 100 : 0;
      const better = chanceBetter(v, d);
      rows.push({
        slot: it.slot,
        item: it.name,
        stat: s.id,
        name: s.name,
        value: v,
        known: true,
        pooled: d.pooled,
        samples: d.samples,
        min: d.min,
        max: d.max,
        mean: Math.round(d.mean * 100) / 100,
        quality: quality(v, d),
        chanceBetter: better,
        expectedTries: better > 0 ? 1 / better : null,
        deltaPct: delta,
        weight: w,
        score: delta * w,
      });
    }
  }
  return {
    totals: t,
    rows: rows.sort((a, b) => (b.known ? b.score : -Infinity) - (a.known ? a.score : -Infinity)),
  };
}

/** Kosten je Reroll für einen Slot aus optimizer-costs.json; null = noch nicht eingetragen */
export function rerollCost(costs, slot) {
  const c = costs?.rerollCosts?.[slot] ?? costs?.rerollCosts?.default;
  const kinah = typeof c?.kinah === "number" ? c.kinah : null;
  const petSoul = typeof c?.petSoul === "number" ? c.petSoul : null;
  return kinah === null && petSoul === null ? null : { kinah, petSoul };
}

export const costsFilled = (costs) => Object.values(costs?.rerollCosts ?? {}).some((c) => typeof c?.kinah === "number" || typeof c?.petSoul === "number");

/**
 * Genus-/Ziel-Rolls je Slot und Stat: Zielwert = obere `top` Prozent der Beobachtungen.
 * → Chance je Reroll, erwartete Versuche, erwartete Kosten (nur wenn Kosten eingetragen).
 */
export function genusPlan(table, items, costs, top = 10) {
  const out = [];
  for (const it of items) {
    for (const s of it.subStats ?? []) {
      const d = lookup(table, it.slot, it.level, s.id);
      const v = Number(s.value);
      if (!d || !Number.isFinite(v)) continue;
      const target = topValue(d, top);
      const p = chanceAtLeast(target, d);
      const have = v >= target;
      const tries = p > 0 ? 1 / p : null;
      const cost = rerollCost(costs, it.slot);
      out.push({
        slot: it.slot,
        item: it.name,
        stat: s.id,
        name: s.name,
        value: v,
        target,
        reached: have,
        chance: p,
        expectedTries: have ? 0 : tries,
        pooled: d.pooled,
        samples: d.samples,
        cost: cost && tries && !have ? { kinah: cost.kinah === null ? null : cost.kinah * tries, petSoul: cost.petSoul === null ? null : cost.petSoul * tries } : null,
      });
    }
  }
  return out;
}
