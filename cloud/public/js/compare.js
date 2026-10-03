// Vergleich: die Mitglieder direkt gegeneinander – Kennzahlen, Verlauf, Anteile, pro Boss.

import {
  $, apiJson, avatar, bossSelect, currentRoute, dungeonName, empty, esc, failed, fmtNum, fmtPct, fmtShort, job, loadBosses, loading, loadMembers, memberColor, pageHead, periodSelect, seriesLines, tz, view,
} from "./core.js";
import { drawTrend } from "./me.js";

const ui = { days: 30, boss: "", metric: "avgDps", hidden: new Set(), gear: "gs", gearHidden: new Set() };
const GEAR = { gs: "Gearscore", cp: "Combat Score" };
/** „GS 1.560 · CS 73,5K“ – fehlende Werte weglassen */
const gearText = (m) =>
  [m.gs ? `GS ${fmtNum(m.gs)}` : "", m.cp ? `CS ${fmtShort(m.cp)}` : ""].filter(Boolean).join(" · ");
// Pro Kampf gibt es je Spieler nur einen Wert – Ø und Bestwert fallen zusammen.
const METRICS = { avgDps: "DPS", peakDps: "Peak (10 s)", avgShare: "Anteil" };

export async function loadCompare() {
  view.innerHTML = loading("Vergleich");
  try {
    await Promise.all([loadMembers(), loadBosses()]);
    const qs = new URLSearchParams({ days: String(ui.days), tz: tz(), bucket: "fight" });
    if (ui.boss) qs.set("boss", ui.boss);
    const d = await apiJson(`/stats/compare?${qs}`);
    if (currentRoute().name === "compare") render(d);
  } catch (e) {
    failed(e, "Der Vergleich");
  }
}

/** Zeile "Kennzahl" mit horizontalen Balken je Mitglied */
function barRow(label, members, value, fmt, note = "") {
  const max = Math.max(1e-9, ...members.map(value));
  const best = Math.max(...members.map(value));
  return `<div class="cmp-row"><div class="cmp-label">${esc(label)}${note ? `<span class="muted small">${note}</span>` : ""}</div>
    <div class="cmp-bars">${members
      .map((m) => {
        const v = value(m) || 0;
        return `<div class="cmp-bar ${v === best && v > 0 ? "lead" : ""}"><span class="cmp-name">${esc(m.name)}</span>
          <span class="cmp-track"><span class="cmp-fill" style="width:${((v / max) * 100).toFixed(1)}%;background:${memberColor(m.name)}"></span></span>
          <span class="cmp-val">${m.fights ? fmt(v) : "–"}</span></div>`;
      })
      .join("")}</div></div>`;
}

function render(d) {
  const ms = d.members;
  const filters = `${bossSelect("cBoss", ui.boss)}${periodSelect("cDays", ui.days)}`;
  if (!ms.length || !ms.some((m) => m.fights)) {
    view.innerHTML = `<div class="page">${pageHead("Vergleich", "", filters)}${empty(
      "Noch nichts zu vergleichen",
      "Sobald ihr Bosse legt, stehen hier eure Werte nebeneinander. Tipp: Zeitraum „Gesamt“ wählen.",
    )}</div>`;
    bind();
    return;
  }
  const heads = ms
    .map(
      (m) => `<div class="cmp-head">${avatar(m.name, m.job, m.jobId)}<div><b>${esc(m.name)}</b><div class="muted small">${esc(job(m.job, m.jobId).name)} · ${fmtNum(m.fights)} Kämpfe</div>${
        gearText(m) ? `<div class="small gear">${gearText(m)}</div>` : ""
      }</div></div>`,
    )
    .join("");
  const bosses = d.matrix.slice(0, 12);
  const names = ms.map((m) => m.name);
  const matrix = bosses
    .map((b) => {
      const best = Math.max(...b.players.map((p) => p.bestDps));
      return `<tr><td><b>${esc(b.boss)}</b><div class="muted small">${b.dungeonId ? `${esc(dungeonName(b.dungeonId))} · ` : ""}${b.fights} Kämpfe</div></td>${names
        .map((n) => {
          const p = b.players.find((x) => x.name.toLowerCase() === n.toLowerCase());
          if (!p) return `<td class="num muted">–</td>`;
          return `<td class="num ${p.bestDps === best ? "lead" : ""}">${p.bestDps === best ? "★ " : ""}${fmtShort(p.bestDps)}<div class="muted small">Ø ${fmtShort(p.avgDps)} · ${fmtPct(p.avgShare)}</div></td>`;
        })
        .join("")}</tr>`;
    })
    .join("");

  view.innerHTML = `<div class="page">
    ${pageHead("Vergleich", ui.boss ? "Nur der gewählte Boss" : "Alle Bosse – für faire Zahlen einen Boss wählen", filters)}
    <div class="cmp-heads">${heads}</div>
    <section class="card">
      ${barRow("Ø DPS", ms, (m) => m.avgDps, fmtShort)}
      ${barRow("Bester Schnitt", ms, (m) => m.bestDps, fmtShort, "ganzer Kampf")}
      ${barRow("Peak (10 s)", ms, (m) => m.bestPeak, fmtShort, "bester Burst")}
      ${barRow("Ø Anteil am Bossschaden", ms, (m) => m.avgShare, fmtPct)}
      ${barRow("Krit-Quote", ms, (m) => m.avgCrit, fmtPct)}
      ${barRow("Rücken-Quote", ms, (m) => m.avgBack, fmtPct)}
      ${barRow("Frontal-Quote", ms, (m) => m.avgFront, fmtPct)}
      ${barRow("Platz 1 in gemeinsamen Kämpfen", ms, (m) => m.firsts, (v) => fmtNum(v), "")}
    </section>
    <section class="card"><div class="card-head"><div><h2>Über die Zeit</h2><p class="muted small">Ein Punkt pro Bosskampf, die letzten 60 im Zeitraum.</p></div>
      <div class="seg" role="group" aria-label="Kennzahl">${Object.entries(METRICS)
        .map(([k, l]) => `<button type="button" data-metric="${k}" class="${ui.metric === k ? "on" : ""}">${l}</button>`)
        .join("")}</div></div>
      <div class="chart" id="cChart"></div><div class="legend" id="cLegend"></div></section>
    <section class="card"><div class="card-head"><div><h2>Ausrüstung über die Zeit</h2><p class="muted small">Stand beim letzten Kampf des Tages.</p></div>
      <div class="seg" role="group" aria-label="Wert">${Object.entries(GEAR)
        .map(([k, l]) => `<button type="button" data-gear="${k}" class="${ui.gear === k ? "on" : ""}">${l}</button>`)
        .join("")}</div></div>
      <div class="chart" id="gChart"></div><div class="legend" id="gLegend"></div></section>
    <section class="card"><h2>Pro Boss</h2><p class="muted small">Bester DPS, darunter Ø DPS und Ø Anteil. ★ = vorne.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Boss</th>${names.map((n) => `<th class="num">${esc(n)}</th>`).join("")}</tr></thead><tbody>${matrix}</tbody></table></div></section>
  </div>`;
  bind();
  const { periods, lines } = seriesLines(d.series.points, ui.metric);
  const host = $("#cChart");
  const bossAt = new Map(d.series.points.map((p) => [p.period, p.boss]));
  drawTrend(host, periods, lines, d.series.bucket, ui.hidden, ui.metric === "avgShare" ? fmtPct : fmtShort, bossAt);
  const gear = seriesLines((d.gear ?? []).filter((p) => p[ui.gear] > 0), ui.gear);
  drawTrend($("#gChart"), gear.periods, gear.lines, "day", ui.gearHidden, ui.gear === "gs" ? fmtNum : fmtShort);
  view.querySelectorAll("[data-gear]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.gear = b.dataset.gear;
      render(d);
    }),
  );
  view.querySelectorAll("[data-metric]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.metric = b.dataset.metric;
      render(d);
    }),
  );
}

function bind() {
  $("#cBoss", view)?.addEventListener("change", (e) => ((ui.boss = e.target.value), loadCompare()));
  $("#cDays", view)?.addEventListener("change", (e) => ((ui.days = Number(e.target.value)), loadCompare()));
}
