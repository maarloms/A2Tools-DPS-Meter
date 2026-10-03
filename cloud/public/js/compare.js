// Vergleich: die Mitglieder direkt gegeneinander – Kennzahlen, Verlauf, Anteile, pro Boss.

import {
  $, apiJson, avatar, bossSelect, currentRoute, empty, esc, failed, fmtNum, fmtPct, fmtShort, job, loadBosses, loadMembers,
  loading, memberColor, pageHead, periodSelect, seriesLines, tz, view,
} from "./core.js";
import { drawTrend } from "./me.js";

const ui = { days: 30, boss: "", metric: "avgDps", hidden: new Set() };
const METRICS = { avgDps: "Ø DPS", bestDps: "Best-DPS", avgShare: "Ø Anteil" };

export async function loadCompare() {
  view.innerHTML = loading("Vergleich");
  try {
    await Promise.all([loadMembers(), loadBosses()]);
    const qs = new URLSearchParams({ days: String(ui.days), tz: tz(), bucket: ui.days > 60 || ui.days === 0 ? "week" : "day" });
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
      (m) => `<div class="cmp-head">${avatar(m.name, m.job, m.jobId)}<div><b>${esc(m.name)}</b><div class="muted small">${esc(job(m.job, m.jobId).name)} · ${fmtNum(m.fights)} Kämpfe</div></div></div>`,
    )
    .join("");
  const bosses = d.matrix.slice(0, 12);
  const names = ms.map((m) => m.name);
  const matrix = bosses
    .map((b) => {
      const best = Math.max(...b.players.map((p) => p.bestDps));
      return `<tr><td><b>${esc(b.boss)}</b><div class="muted small">${b.dungeonId ? `Instanz ${b.dungeonId} · ` : ""}${b.fights} Kämpfe</div></td>${names
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
      ${barRow("Bestwert", ms, (m) => m.bestDps, fmtShort)}
      ${barRow("Ø Anteil am Bossschaden", ms, (m) => m.avgShare, fmtPct)}
      ${barRow("Krit-Quote", ms, (m) => m.avgCrit, fmtPct)}
      ${barRow("Rücken-Quote", ms, (m) => m.avgBack, fmtPct)}
      ${barRow("Platz 1 in gemeinsamen Kämpfen", ms, (m) => m.firsts, (v) => fmtNum(v), "")}
    </section>
    <section class="card"><div class="card-head"><h2>Über die Zeit</h2>
      <div class="seg" role="group" aria-label="Kennzahl">${Object.entries(METRICS)
        .map(([k, l]) => `<button type="button" data-metric="${k}" class="${ui.metric === k ? "on" : ""}">${l}</button>`)
        .join("")}</div></div>
      <div class="chart" id="cChart"></div><div class="legend" id="cLegend"></div></section>
    <section class="card"><h2>Pro Boss</h2><p class="muted small">Bester DPS, darunter Ø DPS und Ø Anteil. ★ = vorne.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Boss</th>${names.map((n) => `<th class="num">${esc(n)}</th>`).join("")}</tr></thead><tbody>${matrix}</tbody></table></div></section>
  </div>`;
  bind();
  const { periods, lines } = seriesLines(d.series.points, ui.metric);
  const host = $("#cChart");
  drawTrend(host, periods, lines, d.series.bucket, ui.hidden, ui.metric === "avgShare" ? fmtPct : fmtShort);
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
