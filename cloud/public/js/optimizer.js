// Gear- und Genus-Optimizer (Reiter „Charakter“, nur im Browser). Rechenmodell: optimizer-core.js / docs/optimizer-modell.md.
// Daten: data/substat-observed.json (BEOBACHTET, Stichprobe) und data/optimizer-costs.json (Kosten trägt Marlon ein).

import { $, $$, esc, fmtNum } from "./core.js";
import { buildTable, costsFilled, genusPlan, suggestRerolls } from "./optimizer-core.js";

const KEY = "a2-optimizer";
let dataP = null;

function loadData() {
  dataP ??= Promise.all([
    fetch("/data/substat-observed.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    fetch("/data/optimizer-costs.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
  ]).then(([observed, costs]) => ({ observed, costs, table: buildTable(observed) }));
  return dataP;
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

/** box: Container; loadItem(slotPos) → Promise<Einzel-Item vom Proxy>; ch: { data } aus character.js */
export function mountOptimizer(box, ch, loadItem) {
  box.innerHTML = `<section class="card"><h3>Optimizer</h3>
    <p class="muted small">Schätzung auf Basis <b>beobachteter</b> Würfe anderer Charaktere (kein offizielles Spielwissen). Lädt dafür die Zufallswerte aller Ausrüstungsteile (ca. ${ch.data.items.length} Abfragen).</p>
    <button type="button" class="btn" id="optStart">Optimizer starten</button><div id="optBody"></div></section>`;
  $("#optStart").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const body = $("#optBody");
    body.innerHTML = `<p class="muted small" id="optProg">Lade Daten …</p>`;
    try {
      const data = await loadData();
      if (!data.observed) {
        body.innerHTML = `<p class="muted">Die Messdaten (substat-observed.json) fehlen.</p>`;
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
      render(body, items, data);
    } catch {
      body.innerHTML = `<p class="muted">Das hat nicht geklappt. Bitte später noch einmal versuchen.</p>`;
    }
  });
}

function render(body, items, data) {
  const o = data.observed;
  body.innerHTML = `<p class="muted small">Stichprobe: ${fmtNum(o.itemsRead)} Gegenstände aus ${o.region?.toUpperCase()}, Stand ${esc(o.generated)} – ${esc(o.note)}</p>
    <div class="seg" role="group" aria-label="Optimizer"><button type="button" data-tab="gear" class="on">Gear-Optimizer</button><button type="button" data-tab="genus">Genus-Optimizer</button></div>
    <div id="optTab"></div>`;
  const tab = (name) => {
    $$("button[data-tab]", body).forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    (name === "gear" ? gear : genus)($("#optTab"), items, data);
  };
  $$("button[data-tab]", body).forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
  tab("gear");
}

function costText(c) {
  if (!c) return "Kosten noch nicht eingetragen";
  const parts = [];
  if (c.kinah !== null) parts.push(`${fmtNum(c.kinah)} Kinah`);
  if (c.petSoul !== null) parts.push(`${fmtNum(c.petSoul)} Pet Soul`);
  return parts.join(" · ") || "Kosten noch nicht eingetragen";
}

function gear(el, items, data) {
  const p = prefs();
  const stats = [...new Set(items.flatMap((i) => (i.subStats || []).map((s) => `${s.id}|${s.name}`)))].sort();
  el.innerHTML = `<h4>Gear-Optimizer</h4>
    <p class="muted small">Modell: Ein Reroll würfelt den Wert desselben Stats neu aus den beobachteten Werten. Rang = Abstand zum Durchschnitt in Prozent, mal Gewicht. Präzision/Krit zählen 1,5×, solange das Ziel nicht erreicht ist, danach 0,25×.</p>
    <div class="toolbar"><label class="field">Ziel Präzision (Summe) <input class="input" id="gTA" type="number" min="0" step="1" value="${p.targetAccuracy}" style="width:100px"></label>
      <label class="field">Ziel Krit (Summe) <input class="input" id="gTC" type="number" min="0" step="1" value="${p.targetCrit}" style="width:100px"></label></div>
    <details><summary class="muted small">Gewichte je Stat</summary><div class="toolbar">${stats
      .map((s) => {
        const [id, name] = s.split("|");
        return `<label class="field">${esc(name)} <input class="input" data-w="${esc(id)}" type="number" min="0" max="5" step="0.5" value="${p.weights[id] ?? 1}" style="width:70px"></label>`;
      })
      .join("")}</div></details>
    <div id="gOut"></div>`;
  const draw = () => {
    const cur = prefs();
    const r = suggestRerolls(data.table, items, cur);
    const t = r.totals;
    const gap = (have, target) => (target > 0 ? ` <span class="muted">(Ziel ${fmtNum(target)}, ${have >= target ? "erreicht" : `fehlt ${fmtNum(target - have)}`})</span>` : "");
    const known = r.rows.filter((x) => x.known);
    $("#gOut").innerHTML = `<p>Präzision gesamt: <b>${fmtNum(t.accuracy)}</b>${gap(t.accuracy, cur.targetAccuracy)} · Krit gesamt: <b>${fmtNum(t.crit)}</b>${gap(t.crit, cur.targetCrit)}</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Teil</th><th>Stat</th><th class="num">Wert</th><th class="num">Bereich (beob.)</th><th class="num">Qualität</th><th class="num">Chance besser</th><th class="num">Rang</th></tr></thead><tbody>${
        known
          .map(
            (x) => `<tr><td>${esc(x.slot)} <span class="muted small">${esc(x.item)}</span></td><td>${esc(x.name)}</td><td class="num">${fmtNum(x.value)}</td>
        <td class="num">${fmtNum(x.min)}–${fmtNum(x.max)}${x.pooled ? ' <span class="muted" title="Stufe nicht einzeln beobachtet, alle Stufen des Slots gepoolt">*</span>' : ""} <span class="muted small">n=${x.samples}</span></td>
        <td class="num">${x.quality === null ? "–" : pct(x.quality)}</td><td class="num">${x.chanceBetter ? pct(x.chanceBetter) : "–"}</td><td class="num"><b>${sign(x.score)}</b></td></tr>`,
          )
          .join("") || '<tr><td colspan="7" class="muted">Keine Zufallswerte mit Vergleichsdaten gefunden.</td></tr>'
      }</tbody></table></div>
      ${r.rows.length - known.length ? `<p class="muted small">${r.rows.length - known.length} Würfe ohne Vergleichsdaten (zu wenig Beobachtungen für diesen Slot/Stat).</p>` : ""}
      <p class="muted small">Rang positiv = Wurf liegt unter dem Durchschnitt, ein Reroll lohnt im Mittel; negativ = eher behalten. ${costsFilled(data.costs) ? "" : "Kosten noch nicht eingetragen."}</p>`;
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
  el.innerHTML = `<h4>Genus-Optimizer</h4>
    <p class="muted small">Zielwerte je Slot: Du wählst, wie hoch die Messlatte liegt (oberes X % der beobachteten Werte). Gezeigt werden Chance je Reroll, erwartete Versuche (1 / Chance) und – sobald Marlon sie in <code>data/optimizer-costs.json</code> einträgt – die Kosten.</p>
    <label class="field">Ziel: obere <input class="input" id="uTop" type="number" min="1" max="100" step="1" value="${p.top}" style="width:70px"> % der Beobachtungen</label>
    <div id="uOut"></div>`;
  const draw = () => {
    const top = Math.min(100, Math.max(1, Number($("#uTop").value) || 10));
    savePrefs({ ...prefs(), top });
    const rows = genusPlan(data.table, items, data.costs, top);
    $("#uOut").innerHTML = `${costsFilled(data.costs) ? "" : '<p class="muted small"><b>Kosten noch nicht eingetragen.</b> Die Spalte bleibt leer, bis Kinah/Pet-Soul-Kosten pro Reroll in der Tabelle stehen.</p>'}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Teil</th><th>Stat</th><th class="num">Wert</th><th class="num">Ziel</th><th class="num">Chance/Reroll</th><th class="num">Ø Versuche</th><th class="num">Kosten (Ø)</th></tr></thead><tbody>${
        rows
          .map(
            (x) => `<tr class="${x.reached ? "dim" : ""}"><td>${esc(x.slot)} <span class="muted small">${esc(x.item)}</span></td><td>${esc(x.name)}</td><td class="num">${fmtNum(x.value)}</td>
        <td class="num">${fmtNum(x.target)}${x.pooled ? "*" : ""} <span class="muted small">n=${x.samples}</span></td><td class="num">${pct(x.chance)}</td>
        <td class="num">${x.reached ? "erreicht" : x.expectedTries ? x.expectedTries.toFixed(1) : "–"}</td>
        <td class="num">${x.reached ? "–" : esc(costText(x.cost))}</td></tr>`,
          )
          .join("") || '<tr><td colspan="7" class="muted">Keine Zufallswerte mit Vergleichsdaten.</td></tr>'
      }</tbody></table></div><p class="muted small">* Stufe nicht einzeln beobachtet, alle Stufen des Slots gepoolt.</p>`;
  };
  $("#uTop").addEventListener("input", draw);
  draw();
}

