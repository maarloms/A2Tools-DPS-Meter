// Live-Gruppenmeter (Daten per WebSocket, siehe app.js). Mitglieder und
// Mitspieler im Kampf (gedimmt); nicht zuordenbarer Rest als Sammelzeile „Andere“.
// Daneben: DPS-Verlauf des laufenden Kampfes, Abstand zum eigenen Bestwert,
// letzter Kampf und heutige Kämpfe (wenn gerade niemand kämpft), Checklisten-Stand.

import {
  $, ago, apiJson, avatar, dungeonName, empty, esc, fmtDate, fmtShort, fmtTime, memberColor, MODES, nf0, nf1, pageHead, recordText,
  state, view,
} from "./core.js";
import { lineChart } from "./chart.js";
import { checklistSummary, dailyResetIn } from "./checklist.js";

// ---------- DPS-Verlauf (im Browser mitgeschrieben, solange das Dashboard offen ist) ----------

const ROLL_MS = 10_000; // gleitendes Fenster der Kurve
const MAX_PTS = 1800;
const hist = new Map(); // encounter key → { last: battleTime, players: Map<name, [{ t, dmg }]> }
const hiddenLines = new Set();

/** Jede Gruppenansicht: Schaden je Mitglied über die Kampfzeit merken. */
export function recordLive(group) {
  const keys = new Set();
  for (const e of group.encounters || []) {
    keys.add(e.key);
    let h = hist.get(e.key);
    // Neuer Kampf mit demselben Ziel: Kampfzeit springt zurück
    if (!h || e.battleTime < h.last - 2000) hist.set(e.key, (h = { last: -1, players: new Map() }));
    if (e.battleTime <= h.last) continue;
    h.last = e.battleTime;
    for (const p of e.players) {
      if (p.member === false) continue;
      let pts = h.players.get(p.name);
      if (!pts) h.players.set(p.name, (pts = []));
      pts.push({ t: e.battleTime, dmg: p.dmg });
      if (pts.length > MAX_PTS) pts.splice(0, pts.length - MAX_PTS);
    }
  }
  for (const k of hist.keys()) if (!keys.has(k)) hist.delete(k);
}

/** DPS der letzten 10 s je Punkt (am Anfang: Schnitt seit Kampfbeginn) */
function rollingLines(e) {
  const h = hist.get(e.key);
  if (!h) return [];
  return [...h.players]
    .filter(([, pts]) => pts.length >= 2)
    .map(([name, pts]) => {
      let j = 0;
      const out = pts.map((p) => {
        while (j + 1 < pts.length && pts[j + 1].t <= p.t - ROLL_MS) j++;
        const ref = pts[j].t <= p.t - ROLL_MS ? pts[j] : null;
        const y = ref ? ((p.dmg - ref.dmg) / (p.t - ref.t)) * 1000 : p.t > 0 ? (p.dmg / p.t) * 1000 : 0;
        return { x: p.t / 1000, y: Math.max(0, y) };
      });
      return { id: name, name, color: memberColor(name), pts: out };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Zusatzdaten (Bestwerte, letzte Kämpfe, Checkliste), höchstens jede Minute ----------

const side = { at: 0, loading: false, matrix: [], records: [], fights: [], checklist: null, jobs: new Map() };

/** Nach einem neuen Kampf-Upload beim nächsten Zeichnen neu laden */
export function invalidateLiveSide() {
  side.at = 0;
}

function ensureSide() {
  if (side.loading || Date.now() - side.at < 60_000) return;
  side.loading = true;
  Promise.allSettled([apiJson("/stats/overview"), apiJson("/fights?limit=12"), apiJson("/checklist")])
    .then(([ov, fl, cl]) => {
      if (ov.status === "fulfilled") {
        side.matrix = ov.value.matrix || [];
        side.records = ov.value.records || [];
        side.jobs = new Map((ov.value.members || []).map((m) => [m.name.toLowerCase(), m]));
      }
      if (fl.status === "fulfilled") side.fights = fl.value.fights || [];
      if (cl.status === "fulfilled") side.checklist = cl.value;
      side.at = Date.now();
    })
    .finally(() => {
      side.loading = false;
      if (location.hash.startsWith("#/live")) renderLive();
    });
}

/** Bestwert eines Mitglieds an diesem Boss (gleicher Dungeon bevorzugt) */
function bestFor(e, name) {
  const boss = String(e.target.name || "").toLowerCase();
  if (!boss) return 0;
  const hits = side.matrix.filter((b) => String(b.boss).toLowerCase() === boss);
  const b = hits.find((x) => x.dungeonId === e.dungeonId) ?? hits[0];
  return b?.players.find((p) => p.name.toLowerCase() === name.toLowerCase())?.bestDps || 0;
}

// ---------- Seite ----------

// Solange der Zeiger über dem Diagramm ist, nicht neu zeichnen (sonst verschwindet der Tooltip)
let hovering = false;

export function renderLive() {
  if (hovering && $("#liveChart")) return;
  hovering = false;
  const g = state.group;
  if (!g) {
    view.innerHTML = `<div class="page">${pageHead("Live")}${empty("Verbinde …", "Die Live-Ansicht kommt gleich.")}</div>`;
    return;
  }
  ensureSide();
  const members = g.members
    .map((m) => {
      const st = m.state === "fighting" ? "on" : m.state === "idle" ? "wait" : "off";
      const label = m.state === "fighting" ? `${fmtShort(m.dps)} DPS` : m.state === "idle" ? "bereit" : `offline · ${ago(m.updatedAt)}`;
      return `<span class="pill ${m.state === "offline" ? "dim" : ""}"><span class="dot ${st}"></span><b>${esc(m.name)}</b><span class="muted">${esc(label)}</span></span>`;
    })
    .join("");

  const encs = g.encounters;
  const main = encs[0];
  const fighting = main?.active;
  let body;
  if (!encs.length) {
    body = idleCards(true);
  } else {
    const first = `<section class="card">${encounterHtml(main, true)}</section>`;
    const rest = encs
      .slice(1)
      .map((e) => {
        const open = state.openEnc.has(e.key) ? "open" : "";
        return `<details class="card more" data-key="${esc(e.key)}" ${open}>
          <summary>${esc(e.target.name || "Alle Ziele")} · ${esc(e.reporters.join(", "))} · ${ago(e.updatedAt)}</summary>
          <div class="more-body">${encounterHtml(e, false)}</div></details>`;
      })
      .join("");
    // Vorbei und nicht mitgeschrieben: keine leere Kurve zeigen
    const chart = fighting || rollingLines(main).length ? chartCard(main) : "";
    body = first + chart + rest + (fighting ? "" : idleCards(false));
  }
  view.innerHTML = `<div class="page">${pageHead("Live", "Schaden der Gruppe im laufenden Kampf")}
    <div class="pills">${members || '<span class="muted">Noch niemand mit der App verbunden.</span>'}</div>
    ${body}
    <div class="grid-2 live-side">${checklistCard()}${recordsCard()}</div></div>`;
  view.querySelectorAll("details.more").forEach((d) =>
    d.addEventListener("toggle", () => (d.open ? state.openEnc.add(d.dataset.key) : state.openEnc.delete(d.dataset.key))),
  );
  if (main) drawChart(main);
}

function chartCard(e) {
  return `<section class="card"><div class="card-head"><h2>DPS-Verlauf</h2>
      <span class="muted small">gleitend über ${ROLL_MS / 1000} s · seit das Dashboard offen ist</span></div>
    <div class="chart" id="liveChart"></div><div class="legend" id="liveLegend"></div></section>`;
}

function drawChart(e) {
  const host = $("#liveChart");
  if (!host) return;
  const series = rollingLines(e);
  if (!series.length) {
    host.innerHTML = `<p class="muted small">Die Kurve beginnt mit den nächsten Meldungen.</p>`;
    return;
  }
  host.onpointerenter = () => (hovering = true);
  host.onpointerleave = () => {
    hovering = false;
    renderLive();
  };
  lineChart(host, {
    series,
    legend: $("#liveLegend"),
    hidden: hiddenLines,
    label: "DPS-Verlauf",
    height: 220,
    xMin: Math.min(...series.map((l) => l.pts[0].x)),
    xFmt: (s) => fmtTime(s * 1000),
    yFmt: (v) => fmtShort(v),
  });
}

/** Wenn gerade niemand kämpft: letzter Kampf und die Kämpfe von heute */
function idleCards(nobody) {
  const hint = nobody
    ? empty("Gerade kämpft niemand", "Sobald jemand mit verbundener App einen Gegner angreift, erscheint der Schaden hier – live, ohne Neuladen.")
    : "";
  const [last, ...earlier] = side.fights;
  if (!last) return hint;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todays = earlier.filter((f) => f.startMs >= today.getTime());
  const mine = last.top.filter((p) => p.member);
  const rows = last.top
    .slice(0, 8)
    .map(
      (p, i) => `<div class="prow${p.member ? "" : " other"}">
      <span class="fill" style="width:${((p.dps / Math.max(last.top[0]?.dps || 1, 1)) * 100).toFixed(1)}%;--c:var(--gold-fill)"></span>
      <span class="rank">${i + 1}</span>${avatar(p.name, p.job, p.jobId)}<span class="name">${esc(p.name)}</span>
      <span class="dps">${fmtShort(p.dps)}</span><span class="dmg"></span><span class="share">${nf1.format(p.share)} %</span></div>`,
    )
    .join("");
  const recs = (last.records || []).map((r) => `<span class="chip">🏆 ${esc(r.name)} · ${esc(recordText(r))}</span>`).join("");
  const lastCard = `<section class="card"><div class="card-head"><div><span class="kpi-label">Letzter Kampf</span><h2>${esc(last.boss)}</h2>
      <div class="muted small">${fmtDate(last.startMs)} · ${fmtTime(last.durationMs)} · ${last.killed ? "besiegt" : "nicht besiegt"}${
        last.dungeonId ? ` · ${esc(dungeonName(last.dungeonId))}` : ""
      }</div></div><a class="link" href="#/fight/${esc(last.id)}">Details →</a></div>
    ${recs ? `<div class="chips">${recs}</div>` : ""}
    <div class="kpis compact">
      <div class="kpi"><div class="kpi-label">Unser DPS</div><div class="kpi-value">${fmtShort(mine.reduce((s, p) => s + p.dps, 0))}</div></div>
      <div class="kpi"><div class="kpi-label">Unser Anteil</div><div class="kpi-value">${nf1.format(mine.reduce((s, p) => s + p.share, 0))} %</div></div>
      <div class="kpi"><div class="kpi-label">Schaden</div><div class="kpi-value">${fmtShort(last.totalDamage)}</div></div>
    </div>
    <div class="rows-head" aria-hidden="true"><span>#</span><span></span><span>Name</span><span>DPS</span><span class="h-dmg"></span><span>Anteil</span></div>
    <div class="rows">${rows}</div></section>`;
  const todayCard = todays.length
    ? `<section class="card"><div class="card-head"><h2>Heute davor</h2><span class="muted small">${todays.length} Kämpfe</span></div>
      <div class="flist">${todays
        .map((f) => {
          const best = f.top.find((p) => p.member);
          return `<a class="frow" href="#/fight/${esc(f.id)}"><div><b>${esc(f.boss)}</b>
            <div class="muted small">${fmtDate(f.startMs)} · ${fmtTime(f.durationMs)}${f.killed ? "" : " · nicht besiegt"}</div></div>
            ${best ? `<div class="frow-right"><b>${fmtShort(best.dps)}</b><span class="muted small">${esc(best.name)}</span></div>` : ""}</a>`;
        })
        .join("")}</div></section>`
    : "";
  return hint + lastCard + todayCard;
}

function checklistCard() {
  const rows = checklistSummary(side.checklist);
  if (!rows.length) return "";
  const body = rows
    .map(
      (r) => `<div class="cl-row"><span class="cl-name">${avatar(r.player, side.jobs.get(r.player.toLowerCase())?.job, side.jobs.get(r.player.toLowerCase())?.jobId)}<b>${esc(r.player)}</b></span>${r.sections
        .map((s) => {
          const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
          return `<span class="cl-bar ${pct >= 100 ? "done" : ""}" title="${esc(s.title)}: ${s.done}/${s.total}">
            <span class="cl-label">${esc(s.title)}</span><span class="cl-track"><span style="width:${pct}%"></span></span><span class="cl-num">${pct} %</span></span>`;
        })
        .join("")}</div>`,
    )
    .join("");
  return `<section class="card"><div class="card-head"><h2>Checkliste</h2><a class="link" href="#/checklist">Abhaken →</a></div>
    <p class="muted small">Tagesreset in ${esc(dailyResetIn())}</p><div class="cl-list">${body}</div></section>`;
}

function recordsCard() {
  const list = side.records.slice(0, 6);
  const body = list.length
    ? `<div class="flist">${list
        .map(
          (r) => `<a class="frow" href="#/fight/${esc(r.fightId)}"><div><b>${esc(r.name)}</b>
            <div class="muted small">${esc(r.boss)} · ${esc(ago(r.startMs))}</div></div>
            <div class="frow-right"><b>${esc(r.kind === "peak" ? "Peak" : "DPS")} ${fmtShort(r.value)}</b><span class="muted small">vorher ${fmtShort(r.prev)}</span></div></a>`,
        )
        .join("")}</div>`
    : `<p class="muted small">In den letzten 14 Tagen kein neuer Bestwert.</p>`;
  return `<section class="card"><div class="card-head"><h2>Neue Rekorde</h2><span class="muted small">14 Tage</span></div>${body}</section>`;
}

// ---------- Meter ----------

/** Abstand zum Bestwert an diesem Boss, erst nach 20 s Kampfzeit */
function vsBest(e, p) {
  if (p.member === false || e.battleTime < 20_000) return "";
  const best = bestFor(e, p.name);
  if (!best) return "";
  const d = ((p.dps - best) / best) * 100;
  const title = `Bestwert an diesem Boss: ${fmtShort(best)} DPS`;
  if (d >= 0) return `<span class="vsrec up" title="${esc(title)}">★ Rekordkurs</span>`;
  return `<span class="vsrec ${d > -10 ? "near" : ""}" title="${esc(title)}">${nf0.format(d)} % zum Rekord</span>`;
}

/** Zeilen: Mitglieder, Mitspieler (gedimmt) + Sammelzeile „Andere“ */
export function meterRows(e, compact = false) {
  const top = Math.max(e.players[0]?.dmg || 0, e.others?.dmg || 0, 1);
  const rows = e.players
    .map(
      (p, i) => `<div class="prow${p.member === false ? " other" : ""}">
      <span class="fill" style="width:${((p.dmg / top) * 100).toFixed(1)}%;--c:var(--gold-fill)"></span>
      <span class="rank">${i + 1}</span>${avatar(p.name, p.job)}
      <span class="name">${esc(p.name)}${compact ? "" : vsBest(e, p)}</span>
      <span class="dps">${fmtShort(p.dps)}</span>${compact ? "" : `<span class="dmg">${fmtShort(p.dmg)}</span>`}<span class="share">${nf1.format(p.share)} %</span></div>`,
    )
    .join("");
  const o = e.others;
  const others =
    o && o.count > 0
      ? `<div class="prow others"><span class="fill" style="width:${((o.dmg / top) * 100).toFixed(1)}%"></span>
        <span class="rank"></span><span class="avatar ghost">+${o.count}</span><span class="name muted">Andere (${o.count})</span>
        <span class="dps muted">–</span>${compact ? "" : `<span class="dmg muted">${fmtShort(o.dmg)}</span>`}<span class="share muted">${nf1.format(o.share)} %</span></div>`
      : "";
  return `<div class="rows ${compact ? "compact" : ""}">${rows}${others}</div>`;
}

function hpOf(e) {
  const t = e.target;
  if (!(t.maxHp > 0)) return null;
  const hp = t.hp >= 0 ? t.hp : Math.max(0, t.maxHp - e.dealt);
  return { hp, pct: Math.max(0, Math.min(100, (hp / t.maxHp) * 100)) };
}

export const hpBar = (e) => {
  const h = hpOf(e);
  if (!h) return "";
  return `<div class="hp"><div class="hp-track" role="meter" aria-label="Ziel-HP" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${h.pct.toFixed(0)}">
    <div class="hp-fill" style="width:${h.pct.toFixed(1)}%"></div></div>
    <div class="hp-label"><span>HP ${fmtShort(h.hp)} / ${fmtShort(e.target.maxHp)}</span><span>${nf1.format(h.pct)} %</span></div></div>`;
};

function encounterHtml(e, primary) {
  const ours = e.players.filter((p) => p.member !== false);
  const groupDps = ours.reduce((s, p) => s + p.dps, 0);
  const groupShare = ours.reduce((s, p) => s + p.share, 0);
  const meta = [MODES[e.target.mode] || e.target.mode, e.dungeonId ? dungeonName(e.dungeonId) : "", `gemeldet von ${e.reporters.join(", ")}`]
    .filter(Boolean)
    .map(esc)
    .join('<span class="sep">·</span>');
  return `
    <div class="card-head">
      <div>${primary ? `<h2>${esc(e.target.name || "Alle Ziele")}</h2>` : ""}<div class="muted small">${meta}</div></div>
      <span class="badge ${e.active ? "live" : ""}">${e.active ? "LIVE" : esc(ago(e.updatedAt))}</span>
    </div>
    <div class="kpis compact">
      <div class="kpi"><div class="kpi-label">Kampfzeit</div><div class="kpi-value">${fmtTime(e.battleTime)}</div></div>
      <div class="kpi"><div class="kpi-label">Gruppen-DPS</div><div class="kpi-value">${fmtShort(groupDps)}</div></div>
      <div class="kpi"><div class="kpi-label">Unser Anteil</div><div class="kpi-value">${nf1.format(groupShare)} %</div></div>
      <div class="kpi"><div class="kpi-label">Schaden am Ziel</div><div class="kpi-value">${fmtShort(e.dealt)}</div></div>
    </div>
    ${hpBar(e)}
    <div class="rows-head" aria-hidden="true"><span>#</span><span></span><span>Name</span><span>DPS</span><span class="h-dmg">Schaden</span><span>Anteil</span></div>
    ${meterRows(e)}`;
}

/** Kompaktes Live-Panel für die Übersicht (nur wenn gerade gekämpft wird) */
export function livePanel() {
  const e = state.group?.encounters?.find((x) => x.active);
  if (!e) return "";
  return `<section class="card live-panel">
    <div class="card-head"><div><span class="badge live">LIVE</span> <b class="live-title">${esc(e.target.name || "Kampf")}</b>
      <span class="muted small">${fmtTime(e.battleTime)}</span></div><a class="link" href="#/live">Zum Live-Meter →</a></div>
    ${hpBar(e)}${meterRows(e, true)}</section>`;
}
