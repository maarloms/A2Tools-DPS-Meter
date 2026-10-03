// Bestenliste & Rekorde, Gruppenvergleich, Verlauf & Trends (Daten aus D1)

import { lineChart } from "./chart.js";
import {
  $, $$, SERIES_COLORS, apiJson, bossLabel, currentRoute, empty, esc, failed, fmtDay, fmtNum, fmtPct, fmtShort, fmtTime,
  jobTag, loadBosses, loadMembers, loading, nf1, state, view,
} from "./core.js";

const rs = { boss: "", days: 0, player: "", trendBoss: "", trendDays: 90, bucket: "day", metric: "avgDps", hidden: new Set() };

const PERIODS = [
  [7, "7 Tage"],
  [30, "30 Tage"],
  [90, "90 Tage"],
  [365, "1 Jahr"],
  [0, "Gesamt"],
];
const periodSelect = (id, value, list = PERIODS) =>
  `<select class="select" id="${id}" aria-label="Zeitraum">${list.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;

/** Farbe folgt dem Mitglied (alphabetische Reihenfolge), nicht dem Rang */
function memberColor(name) {
  const list = (state.members || []).map((m) => m.name.toLowerCase()).sort();
  const i = list.indexOf(String(name).toLowerCase());
  return SERIES_COLORS[(i < 0 ? list.length : i) % SERIES_COLORS.length];
}

const tabs = (active) => `
  <nav class="tabs" aria-label="Bestenliste">
    <a href="#/ranks/boss" class="${active === "boss" ? "on" : ""}">Pro Boss</a>
    <a href="#/ranks/player" class="${active === "player" ? "on" : ""}">Persönliche Rekorde</a>
    <a href="#/ranks/compare" class="${active === "compare" ? "on" : ""}">Gruppenvergleich</a>
  </nav>`;

// ================= Bestenliste =================

export async function loadRanks(tab) {
  view.innerHTML = tabs(tab) + loading("Bestenliste");
  try {
    await Promise.all([loadBosses(true), loadMembers(true)]);
    if (currentRoute().name !== "ranks") return;
    if (tab === "player") return await renderPlayer();
    if (tab === "compare") return await renderCompare();
    return await renderBoss();
  } catch (e) {
    failed(e, "Die Bestenliste");
  }
}

async function renderBoss() {
  const bosses = state.bosses || [];
  if (!bosses.length) {
    view.innerHTML = tabs("boss") + empty("Noch keine Daten", "Sobald Bosskämpfe hochgeladen sind, entstehen hier Bestenlisten.");
    return;
  }
  if (!rs.boss || !bosses.some((b) => b.key === rs.boss)) rs.boss = bosses[0].key;
  const qs = new URLSearchParams({ boss: rs.boss });
  if (rs.days) qs.set("days", String(rs.days));
  const lb = await apiJson(`/stats/leaderboard?${qs}`);
  if (currentRoute().name !== "ranks") return;
  const b = bosses.find((x) => x.key === rs.boss);
  const top = lb.players[0]?.bestDps || 1;
  const rows = lb.players
    .map(
      (p, i) => `<tr class="${i === 0 ? "first" : ""}"><td>${i + 1}</td><td>${jobTag(p.job, p.jobId)}</td><td>${esc(p.player)}</td>
        <td class="bar"><span class="fill" style="width:${((p.bestDps / top) * 100).toFixed(1)}%"></span><span>${fmtShort(p.bestDps)}</span></td>
        <td>${fmtShort(p.avgDps)}</td><td>${fmtNum(p.fights)}</td><td>${fmtPct(p.bestShare)}</td><td>${fmtPct(p.avgCrit)}</td>
        <td><a href="#/fight/${esc(p.bestFightId)}">${fmtDay(p.bestMs)}</a></td></tr>`,
    )
    .join("");
  const topRows = lb.top
    .map(
      (t, i) => `<tr><td>${i + 1}</td><td>${jobTag(t.job, t.jobId)}</td><td>${esc(t.player)}</td><td class="num-strong">${fmtShort(t.dps)}</td>
        <td>${fmtPct(t.share)}</td><td>${fmtTime(t.durationMs)}</td><td><a href="#/fight/${esc(t.fightId)}">${fmtDay(t.startMs)}</a></td></tr>`,
    )
    .join("");
  const cards = bosses
    .slice(0, 24)
    .map(
      (x) => `<button type="button" class="bosscard ${x.key === rs.boss ? "on" : ""}" data-key="${esc(x.key)}">
        <span class="bname">${esc(x.boss)}</span>
        <span class="meta">${x.dungeonId ? `Instanz ${x.dungeonId} · ` : ""}${x.fights} Kämpfe</span>
        ${x.best ? `<span class="bbest">${esc(x.best.player)} <b>${fmtShort(x.best.dps)}</b></span>` : ""}</button>`,
    )
    .join("");
  view.innerHTML = `${tabs("boss")}
    <div class="toolbar">
      <select class="select" id="bossSel" aria-label="Boss">${bosses.map((x) => `<option value="${esc(x.key)}" ${x.key === rs.boss ? "selected" : ""}>${esc(bossLabel(x))} (${x.fights})</option>`).join("")}</select>
      ${periodSelect("days", rs.days)}
    </div>
    <article class="card">
      <div class="enc-head"><div><h2>${esc(b?.boss ?? "")}</h2>
        <div class="meta">${b?.dungeonId ? `Instanz ${b.dungeonId}<span class="sep">·</span>` : ""}${fmtNum(lb.boss.fights)} Kämpfe${lb.boss.avgMs ? `<span class="sep">·</span>Ø Kampfzeit ${fmtTime(lb.boss.avgMs)}` : ""}</div></div></div>
      <h3 style="margin-top:12px">Bestwerte der Gruppe</h3>
      ${rows ? `<div class="table-wrap"><table class="players"><thead><tr><th>#</th><th>Klasse</th><th>Name</th><th>Best-DPS</th><th>Ø DPS</th><th>Kämpfe</th><th>Anteil</th><th>Ø Krit</th><th>Datum</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="meta">Im Zeitraum keine Kämpfe von Mitgliedern.</p>'}
    </article>
    ${topRows ? `<article class="card"><h3>Top-Leistungen</h3><div class="table-wrap"><table class="players"><thead><tr><th>#</th><th>Klasse</th><th>Name</th><th>DPS</th><th>Anteil</th><th>Kampfzeit</th><th>Datum</th></tr></thead><tbody>${topRows}</tbody></table></div></article>` : ""}
    <h3 class="section-title">Alle Bosse</h3>
    <div class="bossgrid">${cards}</div>`;
  $("#bossSel", view).addEventListener("change", (e) => ((rs.boss = e.target.value), renderBoss().catch((x) => failed(x, "Die Bestenliste"))));
  $("#days", view).addEventListener("change", (e) => ((rs.days = Number(e.target.value)), renderBoss().catch((x) => failed(x, "Die Bestenliste"))));
  $$(".bosscard", view).forEach((c) =>
    c.addEventListener("click", () => {
      rs.boss = c.dataset.key;
      renderBoss().catch((x) => failed(x, "Die Bestenliste"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }),
  );
}

async function renderPlayer() {
  const members = state.members || [];
  if (!members.length) {
    view.innerHTML = tabs("player") + empty("Noch keine Mitglieder", "Mitglieder erscheinen, sobald die App verbunden war oder Kämpfe hochgeladen hat.");
    return;
  }
  if (!rs.player || !members.some((m) => m.name === rs.player)) rs.player = members[0].name;
  const qs = new URLSearchParams({ name: rs.player });
  if (rs.days) qs.set("days", String(rs.days));
  const pr = await apiJson(`/stats/player?${qs}`);
  if (currentRoute().name !== "ranks") return;
  const chips = members
    .map((m) => `<button type="button" class="chip ${m.name === rs.player ? "on" : ""}" data-name="${esc(m.name)}"><span class="sw" style="background:${memberColor(m.name)}"></span>${esc(m.name)}</button>`)
    .join("");
  const recs = pr.records
    .map(
      (r) => `<tr><td>${esc(r.boss)}${r.dungeonId ? `<div class="meta">Instanz ${r.dungeonId}</div>` : ""}</td><td class="num-strong">${fmtShort(r.bestDps)}</td>
        <td>${fmtShort(r.avgDps)}</td><td>${fmtNum(r.fights)}</td><td>${fmtPct(r.bestShare)}</td><td>${fmtPct(r.avgCrit)}</td><td>${fmtPct(r.avgBack)}</td>
        <td><a href="#/fight/${esc(r.bestFightId)}">${fmtDay(r.bestMs)}</a></td></tr>`,
    )
    .join("");
  const recent = pr.recent
    .map(
      (r) => `<tr><td><a href="#/fight/${esc(r.fightId)}">${esc(r.boss)}</a></td><td class="num-strong">${fmtShort(r.dps)}</td><td>${fmtPct(r.share)}</td>
        <td>${fmtPct(r.critRate)}</td><td>${fmtTime(r.durationMs)}</td><td>${fmtDay(r.startMs)}</td></tr>`,
    )
    .join("");
  view.innerHTML = `${tabs("player")}
    <div class="toolbar"><div class="chips" role="group" aria-label="Mitglied">${chips}</div>${periodSelect("days", rs.days)}</div>
    <article class="card"><h3>Rekorde von ${esc(rs.player)}</h3>
      ${recs ? `<div class="table-wrap"><table class="players"><thead><tr><th>Boss</th><th>Best-DPS</th><th>Ø DPS</th><th>Kämpfe</th><th>Anteil</th><th>Ø Krit</th><th>Ø Rücken</th><th>Datum</th></tr></thead><tbody>${recs}</tbody></table></div>` : '<p class="meta">Im Zeitraum keine Kämpfe.</p>'}
    </article>
    ${recent ? `<article class="card"><h3>Letzte Kämpfe</h3><div class="table-wrap"><table class="players"><thead><tr><th>Boss</th><th>DPS</th><th>Anteil</th><th>Krit</th><th>Kampfzeit</th><th>Datum</th></tr></thead><tbody>${recent}</tbody></table></div></article>` : ""}`;
  $$(".chip", view).forEach((c) => c.addEventListener("click", () => ((rs.player = c.dataset.name), renderPlayer().catch((x) => failed(x, "Die Rekorde")))));
  $("#days", view).addEventListener("change", (e) => ((rs.days = Number(e.target.value)), renderPlayer().catch((x) => failed(x, "Die Rekorde"))));
}

async function renderCompare() {
  const qs = new URLSearchParams();
  if (rs.days) qs.set("days", String(rs.days));
  const c = await apiJson(`/stats/compare?${qs}`);
  if (currentRoute().name !== "ranks") return;
  const wins = new Map(c.wins.map((w) => [w.player.toLowerCase(), w]));
  const best = Math.max(1, ...c.members.map((m) => m.avgDps));
  const rows = c.members
    .map((m) => {
      const w = wins.get(m.player.toLowerCase());
      return `<tr><td><span class="sw" style="background:${memberColor(m.player)}"></span> ${esc(m.player)}</td>
        <td class="bar"><span class="fill" style="width:${((m.avgDps / best) * 100).toFixed(1)}%"></span><span>${fmtShort(m.avgDps)}</span></td>
        <td>${fmtShort(m.bestDps)}</td><td>${fmtNum(m.fights)}</td><td>${fmtPct(m.avgShare)}</td><td>${fmtPct(m.avgCrit)}</td><td>${fmtPct(m.avgBack)}</td>
        <td>${w ? `${w.firsts} / ${w.together}` : "–"}</td><td>${fmtShort(m.totalDmg)}</td><td>${fmtDay(m.lastMs)}</td></tr>`;
    })
    .join("");
  // Matrix: Bosse mit den meisten Kämpfen × Mitglieder
  const players = c.members.map((m) => m.player);
  const byBoss = new Map();
  for (const r of c.matrix) {
    const k = `${r.mobCode}:${r.dungeonId}`;
    if (!byBoss.has(k)) byBoss.set(k, { boss: r.boss, dungeonId: r.dungeonId, fights: 0, cells: new Map() });
    const e = byBoss.get(k);
    e.fights += r.fights;
    e.cells.set(r.player.toLowerCase(), r.bestDps);
  }
  const bossRows = [...byBoss.values()]
    .sort((a, b) => b.fights - a.fights)
    .slice(0, 12)
    .map((e) => {
      const max = Math.max(...e.cells.values());
      return `<tr><td>${esc(e.boss)}${e.dungeonId ? `<div class="meta">Instanz ${e.dungeonId}</div>` : ""}</td>${players
        .map((p) => {
          const v = e.cells.get(p.toLowerCase());
          return `<td class="${v === max ? "best" : ""}">${v ? fmtShort(v) : "–"}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  view.innerHTML = `${tabs("compare")}
    <div class="toolbar">${periodSelect("days", rs.days)}</div>
    <article class="card"><h3>Mitglieder im Vergleich</h3>
      <p class="meta">Ø über alle Bosskämpfe im Zeitraum. „Platz 1“: in gemeinsamen Kämpfen (≥ 2 Mitglieder) der höchste DPS.</p>
      ${rows ? `<div class="table-wrap"><table class="players"><thead><tr><th>Name</th><th>Ø DPS</th><th>Best</th><th>Kämpfe</th><th>Ø Anteil</th><th>Ø Krit</th><th>Ø Rücken</th><th>Platz 1</th><th>Schaden ges.</th><th>Zuletzt</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="meta">Keine Daten im Zeitraum.</p>'}
    </article>
    ${bossRows ? `<article class="card"><h3>Bestwerte je Boss</h3><p class="meta">Gold = Bestwert des Bosses.</p>
      <div class="table-wrap"><table class="players matrix"><thead><tr><th>Boss</th>${players.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>${bossRows}</tbody></table></div></article>` : ""}`;
  $("#days", view).addEventListener("change", (e) => ((rs.days = Number(e.target.value)), renderCompare().catch((x) => failed(x, "Der Vergleich"))));
}

// ================= Trends =================

const METRICS = { avgDps: ["Ø DPS", fmtShort], bestDps: ["Best-DPS", fmtShort], avgShare: ["Ø Anteil", (v) => `${nf1.format(v)} %`] };

export async function loadTrends() {
  view.innerHTML = loading("Verlauf");
  try {
    await Promise.all([loadBosses(), loadMembers()]);
    const qs = new URLSearchParams({ days: String(rs.trendDays), bucket: rs.bucket, tz: String(-new Date().getTimezoneOffset()) });
    if (rs.trendBoss) qs.set("boss", rs.trendBoss);
    const tr = await apiJson(`/stats/trends?${qs}`);
    if (currentRoute().name !== "trends") return;
    renderTrends(tr);
  } catch (e) {
    failed(e, "Der Verlauf");
  }
}

function periodLabel(p, bucket) {
  if (bucket === "week") {
    const [y, w] = p.split("-W");
    return `KW ${Number(w)}/${y.slice(2)}`;
  }
  const [y, m, d] = p.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

function renderTrends(tr) {
  const [mLabel, mFmt] = METRICS[rs.metric];
  const periods = [...new Set(tr.points.map((p) => p.period))].sort();
  const idx = new Map(periods.map((p, i) => [p, i]));
  const byPlayer = new Map();
  for (const p of tr.points) {
    const k = p.player.toLowerCase();
    if (!byPlayer.has(k)) byPlayer.set(k, { name: p.player, pts: [] });
    byPlayer.get(k).pts.push({ x: idx.get(p.period), y: p[rs.metric], fights: p.fights });
  }
  const series = [...byPlayer.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ id: s.name, name: s.name, color: memberColor(s.name), pts: s.pts.sort((a, b) => a.x - b.x) }));
  const step = Math.max(1, Math.ceil(periods.length / 7));
  const xTicks = periods.map((p, i) => ({ x: i, label: periodLabel(p, tr.bucket) })).filter((_, i) => i % step === 0);
  const bossOpts = (state.bosses || [])
    .map((b) => `<option value="${esc(b.key)}" ${b.key === rs.trendBoss ? "selected" : ""}>${esc(bossLabel(b))}</option>`)
    .join("");
  const tableHead = series.map((s) => `<th>${esc(s.name)}</th>`).join("");
  const tableRows = periods
    .slice()
    .reverse()
    .map((p) => {
      const i = idx.get(p);
      return `<tr><td>${periodLabel(p, tr.bucket)}</td>${series
        .map((s) => {
          const pt = s.pts.find((x) => x.x === i);
          return `<td>${pt ? `${mFmt(pt.y)} <span class="meta">(${pt.fights})</span>` : "–"}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  view.innerHTML = `
    <div class="toolbar">
      <select class="select" id="tBoss" aria-label="Boss"><option value="">Alle Bosse</option>${bossOpts}</select>
      ${periodSelect("tDays", rs.trendDays, PERIODS.filter(([v]) => v >= 30 || v === 0).map(([v, l]) => [v || 3650, l]))}
      <div class="seg" role="group" aria-label="Zeiteinheit">
        <button type="button" data-bucket="day" class="${rs.bucket === "day" ? "on" : ""}">Tage</button>
        <button type="button" data-bucket="week" class="${rs.bucket === "week" ? "on" : ""}">Wochen</button>
      </div>
      <div class="seg" role="group" aria-label="Kennzahl">
        ${Object.entries(METRICS).map(([k, [l]]) => `<button type="button" data-metric="${k}" class="${rs.metric === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
    </div>
    <article class="card"><h3>${esc(mLabel)} pro ${tr.bucket === "week" ? "Woche" : "Tag"}</h3>
      <p class="meta">${rs.trendBoss ? "Nur dieser Boss." : "Alle Bosse gemischt – für faire Vergleiche einen Boss wählen."} In Klammern: Anzahl Kämpfe.</p>
      ${series.length ? `<div class="chart" id="trendChart"></div><div class="legend" id="trendLegend"></div>` : '<p class="meta">Keine Kämpfe im Zeitraum.</p>'}
    </article>
    ${series.length ? `<article class="card"><h3>Werte</h3><div class="table-wrap"><table class="players"><thead><tr><th>${tr.bucket === "week" ? "Woche" : "Tag"}</th>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></div></article>` : ""}`;
  if (series.length) {
    lineChart($("#trendChart"), {
      label: `${mLabel} im Verlauf`,
      series,
      xMin: 0,
      xMax: Math.max(1, periods.length - 1),
      xTicks,
      xFmt: (v) => periodLabel(periods[Math.round(v)] ?? periods[0], tr.bucket),
      yFmt: mFmt,
      legend: $("#trendLegend"),
      hidden: rs.hidden,
    });
  }
  $("#tBoss", view).addEventListener("change", (e) => ((rs.trendBoss = e.target.value), loadTrends()));
  $("#tDays", view).addEventListener("change", (e) => ((rs.trendDays = Number(e.target.value)), loadTrends()));
  $$("[data-bucket]", view).forEach((b) => b.addEventListener("click", () => ((rs.bucket = b.dataset.bucket), loadTrends())));
  $$("[data-metric]", view).forEach((b) => b.addEventListener("click", () => ((rs.metric = b.dataset.metric), renderTrends(tr))));
  state.redrawTrends = () => currentRoute().name === "trends" && renderTrends(tr);
}
