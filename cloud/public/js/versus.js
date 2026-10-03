// Zwei Kämpfe desselben Bosses nebeneinander: Eckdaten, unsere Spieler, DPS-Verlauf, Skills.
// Aufruf über #/fight/<a>/vs/<b>; die Auswahl sitzt im Kampfdetail („Vergleichen mit …“).

import { lineChart } from "./chart.js";
import {
  $, $$, SERIES_COLORS, apiJson, avatar, currentRoute, dungeonName, empty, esc, failed, fmtDate, fmtPct, fmtShort, fmtTime, loading,
  loadMembers, pageHead, trunc, view,
} from "./core.js";

const ui = { player: null, a: null, b: null };
const COLORS = [SERIES_COLORS[0], SERIES_COLORS[1]];

export async function loadVersus(a, b) {
  if (ui.a?.summary.id !== a || ui.b?.summary.id !== b) {
    view.innerHTML = loading("Vergleich");
    try {
      await loadMembers().catch(() => null);
      [ui.a, ui.b] = await Promise.all([apiJson(`/fights/${a}`), apiJson(`/fights/${b}`)]);
      ui.player = null;
    } catch (e) {
      failed(e, "Der Kampfvergleich");
      return;
    }
  }
  if (currentRoute().name === "versus") render();
}

/** Prozentuale Veränderung von a nach b, als farbige Zelle */
function delta(a, b, { lowerIsBetter = false, pct = true } = {}) {
  if (!a || !b) return `<td class="num muted">–</td>`;
  const d = pct ? ((b - a) / a) * 100 : b - a;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const txt = pct ? `${d > 0 ? "+" : ""}${d.toFixed(1).replace(".", ",")} %` : `${d > 0 ? "+" : "−"}${fmtTime(Math.abs(d))}`;
  return `<td class="num ${Math.abs(d) < 0.05 ? "muted" : good ? "up" : "down"}">${txt}</td>`;
}

const members = (d) => d.players.filter((p) => p.member !== false);
const ourDps = (d) => members(d).reduce((s, p) => s + p.dps, 0);
const ourShare = (d) => members(d).reduce((s, p) => s + p.share, 0);

function render() {
  const { a, b } = ui;
  const sa = a.summary;
  const sb = b.summary;
  const names = [...new Set([...members(a), ...members(b)].map((p) => p.name))];
  if (!ui.player || !names.includes(ui.player)) ui.player = names[0] ?? null;
  const row = (label, va, vb, d) => `<tr><td>${label}</td><td class="num">${va}</td><td class="num">${vb}</td>${d}</tr>`;
  const head = (s, i) =>
    `<a class="vs-head" href="#/fight/${s.id}" style="--c:${COLORS[i]}"><span class="kpi-label">Kampf ${i ? "B" : "A"}</span><b>${fmtDate(s.startMs)}</b>
      <span class="muted small">${fmtTime(s.durationMs)}${s.killed ? " · besiegt" : ""}</span></a>`;
  const people = names
    .map((n) => {
      const pa = a.players.find((p) => p.name === n);
      const pb = b.players.find((p) => p.name === n);
      const any = pa ?? pb;
      return `<tr><td>${avatar(n, any.job, any.jobId)} <b>${esc(n)}</b></td>
        <td class="num">${pa ? fmtShort(pa.dps) : "–"}</td><td class="num">${pb ? fmtShort(pb.dps) : "–"}</td>${delta(pa?.dps, pb?.dps)}
        <td class="num hide-s">${pa ? fmtPct(pa.share) : "–"}</td><td class="num hide-s">${pb ? fmtPct(pb.share) : "–"}</td></tr>`;
    })
    .join("");

  view.innerHTML = `<div class="page">
    <p><a class="link" href="#/fight/${sa.id}">← Zurück zum Kampf</a></p>
    ${pageHead(`${sa.boss}: Vergleich`, sa.dungeonId ? esc(dungeonName(sa.dungeonId)) : "")}
    <div class="vs-heads">${head(sa, 0)}${head(sb, 1)}</div>
    <section class="card"><h2>Eckdaten</h2><div class="table-wrap"><table class="tbl">
      <thead><tr><th></th><th class="num">A</th><th class="num">B</th><th class="num">B gegen A</th></tr></thead><tbody>
      ${row("Kampfzeit", fmtTime(sa.durationMs), fmtTime(sb.durationMs), delta(sa.durationMs, sb.durationMs, { lowerIsBetter: true, pct: false }))}
      ${row("Besiegt", sa.killed ? "ja" : "–", sb.killed ? "ja" : "–", `<td></td>`)}
      ${row("Unser DPS", fmtShort(ourDps(a)), fmtShort(ourDps(b)), delta(ourDps(a), ourDps(b)))}
      ${row("Unser Anteil", fmtPct(ourShare(a)), fmtPct(ourShare(b)), delta(ourShare(a), ourShare(b)))}
      ${row("Spieler", members(a).length, members(b).length, `<td></td>`)}
      </tbody></table></div></section>
    <section class="card"><h2>Unsere Spieler</h2><div class="table-wrap"><table class="tbl">
      <thead><tr><th>Name</th><th class="num">DPS A</th><th class="num">DPS B</th><th class="num">B gegen A</th><th class="num hide-s">Anteil A</th><th class="num hide-s">Anteil B</th></tr></thead>
      <tbody>${people}</tbody></table></div></section>
    <section class="card"><h2>Unser DPS im Verlauf</h2>
      <p class="muted small">Zusammen, gleitendes 10-s-Fenster ab Kampfbeginn.</p>
      <div class="chart" id="vsChart"></div><div class="legend" id="vsLegend"></div></section>
    <section class="card" id="vsSkills"></section>
  </div>`;
  drawChart();
  renderSkills(names);
}

/** Schaden unserer Spieler je Sekunde ab Kampfbeginn, gleitend über 10 s */
function groupRolling(d) {
  const secs = Math.max(1, Math.ceil(d.summary.durationMs / 1000));
  const perSec = new Array(secs).fill(0);
  const ours = new Set(members(d).map((p) => p.name));
  for (const s of d.timeline.series.filter((t) => ours.has(t.name))) {
    s.dmg.forEach((v, i) => {
      // Bucket gleichmäßig auf seine Sekunden verteilen
      const from = (s.offsetMs + i * s.bucketMs) / 1000;
      const n = Math.max(1, Math.round(s.bucketMs / 1000));
      for (let k = 0; k < n; k++) {
        const sec = Math.floor(from + k);
        if (sec >= 0 && sec < secs) perSec[sec] += v / n;
      }
    });
  }
  const W = 10;
  let sum = 0;
  return perSec.map((v, i) => {
    sum += v - (i >= W ? perSec[i - W] : 0);
    return { x: (i + 1) * 1000, y: sum / Math.min(W, i + 1) };
  });
}

function drawChart() {
  const host = $("#vsChart");
  if (!host) return;
  const { a, b } = ui;
  lineChart(host, {
    label: "Unser DPS, beide Kämpfe",
    series: [
      { id: "a", name: `A · ${fmtDate(a.summary.startMs)}`, color: COLORS[0], pts: groupRolling(a) },
      { id: "b", name: `B · ${fmtDate(b.summary.startMs)}`, color: COLORS[1], pts: groupRolling(b) },
    ],
    xMin: 0,
    xMax: Math.max(a.summary.durationMs, b.summary.durationMs),
    xFmt: (v) => fmtTime(v),
    yFmt: fmtShort,
    legend: $("#vsLegend"),
  });
}

/** Skill-Anteile eines Spielers in beiden Kämpfen */
function renderSkills(names) {
  const card = $("#vsSkills");
  const pa = ui.a.players.find((p) => p.name === ui.player);
  const pb = ui.b.players.find((p) => p.name === ui.player);
  const chips = names
    .map((n) => `<button type="button" class="chip ${n === ui.player ? "on" : ""}" data-name="${esc(n)}">${esc(trunc(n, 16))}</button>`)
    .join("");
  const skills = new Map();
  for (const [k, p] of [["a", pa], ["b", pb]])
    for (const s of p?.skills ?? []) {
      const e = skills.get(s.name) ?? { name: s.name, a: null, b: null };
      e[k] = { share: p.dmg ? (s.dmg / p.dmg) * 100 : 0, hits: s.hits, dmg: s.dmg };
      skills.set(s.name, e);
    }
  const rows = [...skills.values()]
    .sort((x, y) => (y.b?.dmg ?? y.a?.dmg ?? 0) - (x.b?.dmg ?? x.a?.dmg ?? 0))
    .slice(0, 15)
    .map(
      (s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.a ? fmtPct(s.a.share) : "–"}</td><td class="num">${s.b ? fmtPct(s.b.share) : "–"}</td>
        <td class="num hide-s">${s.a ? s.a.hits : "–"}</td><td class="num hide-s">${s.b ? s.b.hits : "–"}</td></tr>`,
    )
    .join("");
  card.innerHTML = `<div class="card-head"><h2>Skills im Vergleich</h2><div class="chips">${chips}</div></div>
    <p class="muted small">Anteil am eigenen Schaden und Treffer. ${!pa || !pb ? "Der Spieler war nur in einem der beiden Kämpfe." : ""}</p>
    ${rows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Skill</th><th class="num">Anteil A</th><th class="num">Anteil B</th>
      <th class="num hide-s">Treffer A</th><th class="num hide-s">Treffer B</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("Keine Skill-Daten")}`;
  $$(".chip", card).forEach((c) =>
    c.addEventListener("click", () => {
      ui.player = c.dataset.name;
      renderSkills(names);
    }),
  );
}

export function redrawVersus() {
  if (currentRoute().name === "versus" && ui.a) drawChart();
}
