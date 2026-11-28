// Gear- und Genus-Optimizer (Reiter „Charakter“, nur im Browser). Rechenmodell: optimizer-core.js / docs/optimizer-modell.md.
// Daten: data/substat-observed.json (BEOBACHTET, Stichprobe) und data/optimizer-costs.json (Kosten trägt Marlon ein).

import { $, $$, esc, fmtNum } from "./core.js";
import { buildTable, costsFilled, genusPlan, lookup, quality, suggestRerolls } from "./optimizer-core.js";

export const SLOT_DE = {
  MainHand: "Haupthand", SubHand: "Nebenhand", Helmet: "Helm", Shoulder: "Schulter", Torso: "Brust", Pants: "Beine", Gloves: "Handschuhe",
  Boots: "Stiefel", Cape: "Umhang", Belt: "Gürtel", Necklace: "Halskette", Earring1: "Ohrring 1", Earring2: "Ohrring 2", Ring1: "Ring 1",
  Ring2: "Ring 2", Bracelet1: "Armreif 1", Bracelet2: "Armreif 2", Amulet: "Amulett", Rune1: "Rune 1", Rune2: "Rune 2",
  Arcana1: "Arkana 1", Arcana2: "Arkana 2", Arcana3: "Arkana 3", Arcana4: "Arkana 4", Arcana5: "Arkana 5",
};
const KEY = "a2-optimizer";
let dataP = null;

function loadData() {
  dataP ??= Promise.all([
    fetch("/data/substat-observed.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    fetch("/data/optimizer-costs.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
  ]).then(([observed, costs]) => ({ observed, costs, table: buildTable(observed) }));
  return dataP;
}

/** Wurfqualität je Zufallswert eines Teils (für die Item-Karten): [{quality,min,max,mean,samples,pooled}|null, …]; null ohne Messdaten */
export async function rollInfo(slot, level, subStats) {
  const data = await loadData();
  if (!data.observed) return null;
  return (subStats || []).map((s) => {
    const d = lookup(data.table, slot, level, s.id);
    const v = Number(String(s.value).replace(",", "."));
    return d && Number.isFinite(v) ? { quality: quality(v, d), min: d.min, max: d.max, mean: d.mean, samples: d.samples, pooled: d.pooled } : null;
  });
}

const prefs = () => {
  try {
    return { targetAccuracy: 0, targetCrit: 0, top: 10, weights: {}, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { targetAccuracy: 0, targetCrit: 0, top: 10, weights: {} };
  }
};
const savePrefs = (p) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* egal */
  }
};

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;
const sign = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

/** box: Container; loadItem(item) → Promise<Einzel-Item vom Proxy> (mit Cache aus character.js); ch: { data } */
export function mountOptimizer(box, ch, loadItem) {
  box.innerHTML = `<section class="cp-panel cp-opt"><div class="cp-panel-head"><h3>Optimizer</h3><span class="cp-hint">Schätzung, kein offizielles Spielwissen</span></div>
    <p class="cp-lead">Bewertet die Würfe deiner Ausrüstung gegen <b>beobachtete</b> Werte anderer Charaktere und zeigt, wo sich ein Reroll lohnt. Dafür werden die Zufallswerte aller Teile geladen (bis zu ${ch.data.items.length} Abfragen; schon geöffnete Teile werden wiederverwendet).</p>
    <button type="button" class="cp-btn primary" id="optStart">Optimizer starten</button><div id="optBody"></div></section>`;
  $("#optStart").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const body = $("#optBody");
    body.innerHTML = `<div class="cp-load"><span class="spin"></span><span id="optProg">Lade Daten …</span></div>`;
    try {
      const data = await loadData();
      if (!data.observed) {
        body.innerHTML = `<div class="cp-empty err"><b>Messdaten fehlen</b><p>Die Datei substat-observed.json ist nicht erreichbar.</p></div>`;
        return;
      }
      const items = [];
      const todo = ch.data.items.filter((i) => i.slotPos !== 0);
      let done = 0;
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const it = todo[next++];
          try {
            const r = await loadItem(it);
            items.push({ slot: it.slot, slotPos: it.slotPos, name: r.name, level: r.level, grade: r.grade, subStats: r.subStats, stones: r.stones, soulBind: r.soulBind });
          } catch {
            /* Teil überspringen */
          }
          $("#optProg") && ($("#optProg").textContent = `Lade Ausrüstung … ${++done} / ${todo.length}`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      e.target.hidden = true;
      render(body, items, data);
    } catch {
      e.target.disabled = false;
      body.innerHTML = `<div class="cp-empty err"><b>Das hat nicht geklappt</b><p>Bitte später noch einmal versuchen.</p></div>`;
    }
  });
}

function render(body, items, data) {
  const o = data.observed;
  body.innerHTML = `<p class="cp-hint">Stichprobe: ${fmtNum(o.itemsRead)} Gegenstände aus ${esc(o.region?.toUpperCase() || "?")}, Stand ${esc(o.generated)} – ${esc(o.note)}</p>
    <div class="cp-tabs" role="tablist" aria-label="Optimizer"><button type="button" role="tab" data-tab="gear" class="on">Gear-Optimizer</button><button type="button" role="tab" data-tab="genus">Genus-Optimizer</button></div>
    <div id="optTab"></div>`;
  const tab = (name) => {
    $$("button[data-tab]", body).forEach((b) => {
      b.classList.toggle("on", b.dataset.tab === name);
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
    });
    (name === "gear" ? gear : genus)($("#optTab"), items, data);
  };
  $$("button[data-tab]", body).forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
  tab("gear");
}

function costText(c) {
  if (!c) return "–";
  const parts = [];
  if (c.kinah !== null) parts.push(`${fmtNum(c.kinah)} Kinah`);
  if (c.petSoul !== null) parts.push(`${fmtNum(c.petSoul)} Pet Soul`);
  return parts.join(" · ") || "–";
}

const qcell = (q) => (q === null || q === undefined ? "–" : `<span class="cp-q ${q >= 2 / 3 ? "hi" : q >= 1 / 3 ? "mid" : "lo"}"><span class="cp-q-bar"><i style="width:${Math.max(3, Math.round(q * 100))}%"></i></span><b>${Math.round(q * 100)} %</b></span>`);
const cbar = (c) => `<span class="cp-q chance"><span class="cp-q-bar"><i style="width:${Math.max(3, Math.min(100, Math.round(c * 100)))}%"></i></span><b>${pct(c)}</b></span>`;
const slotName = (x) => `<b>${esc(SLOT_DE[x.slot] || x.slot)}</b><small>${esc(x.item)}</small>`;

function gear(el, items, data) {
  const p = prefs();
  const stats = [...new Set(items.flatMap((i) => (i.subStats || []).map((s) => `${s.id}|${s.name}`)))].sort();
  el.innerHTML = `<p class="cp-lead">Ein Reroll würfelt den Wert desselben Stats neu aus den beobachteten Werten. Rang = Abstand zum Durchschnitt in Prozent, mal Gewicht. Präzision und Krit zählen 1,5&times;, solange das Ziel nicht erreicht ist, danach 0,25&times;.</p>
    <div class="cp-form"><label class="cp-f"><span>Ziel Präzision (Summe)</span><input id="gTA" type="number" min="0" step="1" value="${p.targetAccuracy}"></label>
      <label class="cp-f"><span>Ziel Krit (Summe)</span><input id="gTC" type="number" min="0" step="1" value="${p.targetCrit}"></label></div>
    <details class="cp-fold"><summary>Gewichte je Stat${ICO_CHEV}</summary><div class="cp-form w">${stats
      .map((s) => {
        const [id, name] = s.split("|");
        return `<label class="cp-f"><span>${esc(name)}</span><input data-w="${esc(id)}" type="number" min="0" max="5" step="0.5" value="${p.weights[id] ?? 1}"></label>`;
      })
      .join("")}</div></details>
    <div id="gOut"></div>`;
  const draw = () => {
    const cur = prefs();
    const r = suggestRerolls(data.table, items, cur);
    const t = r.totals;
    const goal = (label, have, target) => `<div class="cp-kpi"><dt>${label}</dt><dd>${fmtNum(have)}</dd><small class="${target > 0 && have >= target ? "ok" : ""}">${target > 0 ? (have >= target ? `Ziel ${fmtNum(target)} erreicht` : `Ziel ${fmtNum(target)} – fehlt ${fmtNum(target - have)}`) : "kein Ziel gesetzt"}</small></div>`;
    const known = r.rows.filter((x) => x.known);
    $("#gOut").innerHTML = `<dl class="cp-kpis two">${goal("Präzision gesamt", t.accuracy, cur.targetAccuracy)}${goal("Krit gesamt", t.crit, cur.targetCrit)}</dl>
      <div class="cp-tbl-wrap"><table class="cp-tbl stack"><thead><tr><th>Teil</th><th>Stat</th><th class="num">Wert</th><th class="num">Bereich (beob.)</th><th>Qualität</th><th class="num">Chance besser</th><th class="num">Rang</th></tr></thead><tbody>${
        known
          .map(
            (x) => `<tr><td data-label="Teil" class="first">${slotName(x)}</td><td data-label="Stat">${esc(x.name)}</td><td data-label="Wert" class="num">${fmtNum(x.value)}</td>
        <td data-label="Bereich" class="num">${fmtNum(x.min)}–${fmtNum(x.max)}${x.pooled ? ' <span title="Stufe nicht einzeln beobachtet, alle Stufen des Slots gepoolt">*</span>' : ""} <small>n=${x.samples}</small></td>
        <td data-label="Qualität">${qcell(x.quality)}</td><td data-label="Chance besser" class="num">${x.chanceBetter ? pct(x.chanceBetter) : "–"}</td>
        <td data-label="Rang" class="num"><span class="cp-rank ${x.score > 0 ? "up" : "down"}">${sign(x.score)}</span></td></tr>`,
          )
          .join("") || '<tr><td colspan="7" class="cp-none">Keine Zufallswerte mit Vergleichsdaten gefunden.</td></tr>'
      }</tbody></table></div>
      ${r.rows.length - known.length ? `<p class="cp-hint">${r.rows.length - known.length} Würfe ohne Vergleichsdaten (zu wenig Beobachtungen für diesen Slot/Stat).</p>` : ""}
      <p class="cp-hint">Rang positiv = Wurf liegt unter dem Durchschnitt, ein Reroll lohnt im Mittel; negativ = eher behalten. * = alle Stufen des Slots gepoolt. ${costsFilled(data.costs) ? "" : "Kosten noch nicht eingetragen."}</p>`;
  };
  const save = () => {
    const w = {};
    $$("input[data-w]", el).forEach((i) => (w[i.dataset.w] = Number(i.value) || 0));
    savePrefs({ ...prefs(), targetAccuracy: Number($("#gTA").value) || 0, targetCrit: Number($("#gTC").value) || 0, weights: w });
    draw();
  };
  $$("input", el).forEach((i) => i.addEventListener("input", save));
  draw();
}

function genus(el, items, data) {
  const p = prefs();
  el.innerHTML = `<p class="cp-lead">Zielwerte je Slot: Du wählst, wie hoch die Messlatte liegt (oberes X % der beobachteten Werte). Gezeigt werden Chance je Reroll, erwartete Versuche (1 / Chance) und – sobald Kosten in <code>data/optimizer-costs.json</code> eingetragen sind – die Kosten.</p>
    <div class="cp-form"><label class="cp-f"><span>Ziel: obere X % der Beobachtungen</span><input id="uTop" type="number" min="1" max="100" step="1" value="${p.top}"></label></div>
    <div id="uOut"></div>`;
  const draw = () => {
    const top = Math.min(100, Math.max(1, Number($("#uTop").value) || 10));
    savePrefs({ ...prefs(), top });
    const rows = genusPlan(data.table, items, data.costs, top);
    $("#uOut").innerHTML = `${costsFilled(data.costs) ? "" : '<p class="cp-hint"><b>Kosten noch nicht eingetragen.</b> Die Spalte bleibt leer, bis Kinah/Pet-Soul-Kosten pro Reroll in der Tabelle stehen.</p>'}
      <div class="cp-tbl-wrap"><table class="cp-tbl stack"><thead><tr><th>Teil</th><th>Stat</th><th class="num">Wert</th><th class="num">Ziel</th><th>Chance/Reroll</th><th class="num">Ø Versuche</th><th class="num">Kosten (Ø)</th></tr></thead><tbody>${
        rows
          .map(
            (x) => `<tr class="${x.reached ? "dim" : ""}"><td data-label="Teil" class="first">${slotName(x)}</td><td data-label="Stat">${esc(x.name)}</td><td data-label="Wert" class="num">${fmtNum(x.value)}</td>
        <td data-label="Ziel" class="num">${fmtNum(x.target)}${x.pooled ? "*" : ""} <small>n=${x.samples}</small></td><td data-label="Chance/Reroll">${x.reached ? "–" : cbar(x.chance)}</td>
        <td data-label="Ø Versuche" class="num">${x.reached ? '<span class="cp-rank ok">erreicht</span>' : x.expectedTries ? x.expectedTries.toFixed(1) : "–"}</td>
        <td data-label="Kosten (Ø)" class="num">${x.reached ? "–" : esc(costText(x.cost))}</td></tr>`,
          )
          .join("") || '<tr><td colspan="7" class="cp-none">Keine Zufallswerte mit Vergleichsdaten.</td></tr>'
      }</tbody></table></div><p class="cp-hint">* Stufe nicht einzeln beobachtet, alle Stufen des Slots gepoolt.</p>`;
  };
  $("#uTop").addEventListener("input", draw);
  draw();
}

const ICO_CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
