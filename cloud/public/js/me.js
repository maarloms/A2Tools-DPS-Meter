// Mein Bereich: persönliche Kennzahlen, Trend, Rekorde pro Boss, letzte Kämpfe.
// „Wer bist du?“ wird einmal gewählt und im Browser gemerkt; umschaltbar auf die anderen.

import { lineChart } from "./chart.js";
import {
  $, $$, activeMembers, apiJson, avatar, bossSelect, currentRoute, empty, esc, failed, fmtDay, fmtNum, fmtPct, fmtShort, fmtTime,
  getMe, job, kpi, loadBosses, loadMembers, loading, pageHead, periodLabel, periodSelect, seriesLines, setMe, trend, tz, view,
} from "./core.js";

const ui = { days: 30, boss: "", hidden: new Set() };

export async function loadMe(who) {
  view.innerHTML = loading("Mein Bereich");
  try {
    await Promise.all([loadMembers(), loadBosses()]);
    const members = activeMembers();
    if (!members.length) {
      view.innerHTML = `<div class="page">${pageHead("Mein Bereich")}${empty("Noch keine Mitglieder", "Sobald jemand die App verbindet oder einen Kampf hochlädt, kannst du dich hier auswählen.")}</div>`;
      return;
    }
    const name = members.find((n) => n.toLowerCase() === (who || getMe()).toLowerCase());
    if (!name) return renderChooser(members);
    await renderMe(name);
  } catch (e) {
    failed(e, "Mein Bereich");
  }
}

function renderChooser(members) {
  view.innerHTML = `<div class="page">${pageHead("Wer bist du?", "Einmal auswählen – dein Browser merkt es sich. Du kannst jederzeit wechseln.")}
    <div class="choose">${members.map((n) => `<button type="button" class="choice" data-name="${esc(n)}">${avatar(n)}<span>${esc(n)}</span></button>`).join("")}</div></div>`;
  $$(".choice", view).forEach((b) =>
    b.addEventListener("click", () => {
      setMe(b.dataset.name);
      document.dispatchEvent(new CustomEvent("me-changed"));
      location.hash = `#/me/${encodeURIComponent(b.dataset.name)}`;
    }),
  );
}

async function renderMe(name) {
  const qs = new URLSearchParams({ name, days: String(ui.days), tz: tz(), bucket: ui.days > 60 || ui.days === 0 ? "week" : "day" });
  if (ui.boss) qs.set("boss", ui.boss);
  const d = await apiJson(`/stats/player?${qs}`);
  if (currentRoute().name !== "me") return;
  const me = getMe();
  const isMe = me.toLowerCase() === name.toLowerCase();
  const k = d.kpi;
  const periodTxt = ui.days ? `letzte ${ui.days} Tage` : "gesamt";
  const switcher = activeMembers()
    .map((n) => `<a class="chip ${n === name ? "on" : ""}" href="#/me/${encodeURIComponent(n)}">${esc(n)}${n.toLowerCase() === me.toLowerCase() ? " (du)" : ""}</a>`)
    .join("");
  const fav = k.favorite;
  const records = d.records
    .map(
      (r) => `<tr><td><b>${esc(r.boss)}</b>${r.dungeonId ? `<div class="muted small">Instanz ${r.dungeonId}</div>` : ""}</td>
        <td class="num strong">${fmtShort(r.bestDps)}</td><td class="num">${fmtShort(r.avgDps)}</td><td class="num">${fmtPct(r.avgShare)}</td>
        <td class="num">${fmtNum(r.fights)}</td><td class="num"><a href="#/fight/${esc(r.bestFightId)}">${fmtDay(r.bestMs)}</a></td></tr>`,
    )
    .join("");
  const recent = d.recent
    .map(
      (r) => `<a class="frow" href="#/fight/${esc(r.fightId)}"><div><b>${esc(r.boss)}</b><div class="muted small">${fmtDay(r.startMs)} · ${fmtTime(r.durationMs)}</div></div>
        <div class="frow-right"><b>${fmtShort(r.dps)}</b><span class="muted small">${fmtPct(r.share)} Anteil</span></div></a>`,
    )
    .join("");

  view.innerHTML = `<div class="page">
    ${pageHead(isMe ? "Mein Bereich" : name, `${avatar(name, d.job, d.jobId)} <span>${esc(name)} · ${esc(job(d.job, d.jobId).name)}</span>`,
      `${periodSelect("mDays", ui.days)}`)}
    <div class="chips">${switcher}${!isMe ? `<button class="chip ghost" id="thisIsMe" type="button">Das bin ich</button>` : ""}</div>
    ${
      !k.fights
        ? empty("Noch keine Kämpfe in diesem Zeitraum", `Sobald ${isMe ? "du" : esc(name)} einen Boss legst, steht hier, wie es läuft. Zeitraum „Gesamt“ zeigt alles.`)
        : `<div class="kpis">
      ${kpi("Ø DPS", fmtShort(k.avgDps), `${trend(k.avgDps, k.prevAvgDps, "der Zeitraum davor")} ${periodTxt}`)}
      ${kpi("Bestwert", fmtShort(k.bestDps), "höchster DPS")}
      ${kpi("Ø Anteil", fmtPct(k.avgShare), "am Bossschaden")}
      ${kpi("Kämpfe", fmtNum(k.fights), periodTxt)}
      ${kpi("Lieblingsboss", fav ? esc(fav.boss) : "–", fav ? `${fmtNum(fav.fights)} Kämpfe` : "", "text")}
    </div>
    <section class="card"><div class="card-head"><h2>DPS-Verlauf</h2>${bossSelect("mBoss", ui.boss)}</div>
      <p class="muted small">Ø DPS pro ${d.series.bucket === "week" ? "Woche" : "Tag"}${ui.boss ? "" : " über alle Bosse – für faire Werte einen Boss wählen"}.</p>
      <div class="chart" id="meChart"></div></section>
    <div class="grid-2">
      <section class="card"><h2>Rekorde pro Boss</h2>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Boss</th><th class="num">Best</th><th class="num">Ø DPS</th><th class="num">Ø Anteil</th><th class="num">Kämpfe</th><th class="num">Datum</th></tr></thead><tbody>${records}</tbody></table></div></section>
      <section class="card"><h2>Letzte Kämpfe</h2><div class="flist">${recent}</div></section>
    </div>`
    }</div>`;

  $("#mDays", view).addEventListener("change", (e) => ((ui.days = Number(e.target.value)), renderMe(name).catch((x) => failed(x, "Mein Bereich"))));
  $("#mBoss", view)?.addEventListener("change", (e) => ((ui.boss = e.target.value), renderMe(name).catch((x) => failed(x, "Mein Bereich"))));
  $("#thisIsMe", view)?.addEventListener("click", () => {
    setMe(name);
    document.dispatchEvent(new CustomEvent("me-changed"));
    renderMe(name);
  });
  const host = $("#meChart", view);
  if (host) {
    const { periods, lines } = seriesLines(d.series.points, "avgDps");
    drawTrend(host, periods, lines, d.series.bucket);
  }
}

export function drawTrend(host, periods, lines, bucket, hidden, yFmt = fmtShort) {
  if (!periods.length) {
    host.innerHTML = '<p class="muted small">Keine Daten im Zeitraum.</p>';
    return;
  }
  const step = Math.max(1, Math.ceil(periods.length / 7));
  lineChart(host, {
    label: "DPS-Verlauf",
    series: lines,
    xMin: 0,
    xMax: Math.max(1, periods.length - 1),
    xTicks: periods.map((p, i) => ({ x: i, label: periodLabel(p, bucket) })).filter((_, i) => i % step === 0),
    xFmt: (v) => periodLabel(periods[Math.round(v)] ?? periods[0], bucket),
    yFmt,
    hidden,
    legend: hidden ? host.nextElementSibling : undefined,
  });
}
