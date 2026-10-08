// Übersicht der Gruppe: Mitglieder-Karten, gemeinsame Kennzahlen, wer führt pro Boss,
// letzte Kämpfe, kompaktes Live-Panel.

import {
  apiJson, avatar, currentRoute, dungeonName, empty, esc, failed, fmtDate, fmtNum, fmtPct, fmtShort, fmtTime, job, kpi, loading, loadMembers, pageHead, trend, view,
  recordText,
} from "./core.js";
import { livePanel } from "./live.js";

let last = null;

export async function loadOverview() {
  if (!last) view.innerHTML = loading("Übersicht");
  else renderOverview(last);
  try {
    const [data] = await Promise.all([apiJson("/stats/overview"), loadMembers(true)]);
    last = data;
    if (currentRoute().name === "overview") renderOverview(data);
  } catch (e) {
    failed(e, "Die Übersicht");
  }
}

/** Live-Panel ohne Neuladen der Statistik aktualisieren */
export function refreshOverviewLive() {
  const host = document.getElementById("livePanel");
  if (host) host.innerHTML = livePanel();
}

/** Wochenrückblick: letzte 7 Tage, Verbesserung gegen die Woche davor */
function weekCard(w, members) {
  if (!w || !w.fights) return "";
  const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} %`;
  const jobOf = (name) => members.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? {};
  const highlights = [
    w.bestRun
      ? `<a class="wk" href="#/fight/${esc(w.bestRun.fightId)}"><span class="kpi-label">Bester Run</span><b>${esc(w.bestRun.name)} · ${fmtShort(w.bestRun.dps)}</b><span class="muted small">${esc(w.bestRun.boss)}</span></a>`
      : "",
    w.riser
      ? `<div class="wk"><span class="kpi-label">Größter Fortschritt</span><b>${esc(w.riser.name)} · ${pct(w.riser.change)}</b><span class="muted small">Ø DPS je Boss gegen die Vorwoche</span></div>`
      : "",
    w.fastestKill
      ? `<a class="wk" href="#/fight/${esc(w.fastestKill.fightId)}"><span class="kpi-label">Schnellster Kill</span><b>${fmtTime(w.fastestKill.durationMs)}</b><span class="muted small">${esc(w.fastestKill.boss)}</span></a>`
      : "",
  ].join("");
  const rows = [...w.members]
    .sort((a, b) => b.fights - a.fights)
    .map((m) => {
      const j = jobOf(m.name);
      const cls = m.change === null ? "muted" : m.change >= 0 ? "up" : "down";
      return `<tr><td>${avatar(m.name, j.job, j.jobId)} <b>${esc(m.name)}</b></td><td class="num">${fmtNum(m.fights)}</td><td class="num">${fmtNum(m.kills)}</td>
        <td class="num">${m.best ? fmtShort(m.best.dps) : "–"}</td><td class="num ${cls}">${m.change === null ? "–" : pct(m.change)}</td></tr>`;
    })
    .join("");
  return `<section class="card week"><div class="card-head"><div><h2>Diese Woche</h2>
      <p class="muted small">Seit ${fmtDate(w.from)} · ${fmtNum(w.fights)} Bosskämpfe, ${fmtNum(w.kills)} besiegt</p></div></div>
    ${highlights ? `<div class="wks">${highlights}</div>` : ""}
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Wer</th><th class="num">Kämpfe</th><th class="num">Kills</th><th class="num">Bester DPS</th>
      <th class="num" title="Ø DPS je Boss gegen die Vorwoche, nur Bosse aus beiden Wochen">Fortschritt</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

/** Neue Bestwerte der letzten 14 Tage, je Kampf und Spieler eine Zeile */
function recordsCard(records, members) {
  if (!records?.length) return "";
  const jobOf = (name) => members.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? {};
  const rows = new Map();
  for (const r of records) {
    const k = `${r.fightId}|${r.name}`;
    if (!rows.has(k)) rows.set(k, { ...r, list: [] });
    rows.get(k).list.push(r);
  }
  const items = [...rows.values()]
    .map((r) => {
      const j = jobOf(r.name);
      return `<a class="frow" href="#/fight/${esc(r.fightId)}"><div>${avatar(r.name, j.job, j.jobId)} <b>${esc(r.name)}</b>
        <div class="muted small">${esc(r.boss)}${r.dungeonId ? ` · ${esc(dungeonName(r.dungeonId))}` : ""} · ${fmtDate(r.startMs)}</div></div>
        <div class="rec-vals">${r.list.map((x) => `<span>${esc(recordText(x))}</span>`).join("")}</div></a>`;
    })
    .join("");
  return `<section class="card"><div class="card-head"><div><h2>🏆 Neue Bestwerte</h2>
    <p class="muted small">Letzte 14 Tage · besser als jeder frühere Kampf gegen denselben Boss</p></div></div>
    <div class="flist">${items}</div></section>`;
}

function renderOverview(d) {
  const g = d.group;
  if (!d.members.length) {
    view.innerHTML = `<div class="page">${pageHead("Übersicht")}${empty(
      "Noch keine Mitglieder",
      "Sobald jemand die App mit dem Einladungslink verbindet oder einen Bosskampf hochlädt, erscheint er hier. Wie das geht, steht auf der <a href=\"#/start\">Startseite</a>.",
    )}</div>`;
    return;
  }
  const cards = d.members
    .map((m) => {
      const has = m.fights > 0;
      return `<a class="mcard" href="#/me/${encodeURIComponent(m.name)}">
        <div class="mcard-head">${avatar(m.name, m.job, m.jobId)}<div><div class="mname">${esc(m.name)}</div><div class="muted small">${esc(job(m.job, m.jobId).name)}</div></div></div>
        ${
          has
            ? `<div class="mcard-main"><div class="kpi-label">Ø DPS · 7 Tage</div>
                 <div class="big-num">${m.avg7 ? fmtShort(m.avg7) : "–"} ${trend(m.avg7, m.prev7)}</div></div>
               <dl class="mstats"><div><dt>Bestwert</dt><dd>${fmtShort(m.best)}</dd></div>
                 <div><dt>Kämpfe</dt><dd>${fmtNum(m.fights7)} <span class="muted">/ ${fmtNum(m.fights)}</span></dd></div>
                 <div><dt>Ø Anteil</dt><dd>${fmtPct(m.avgShare)}</dd></div></dl>`
            : `<p class="muted small">Noch keine Bosskämpfe hochgeladen.</p>`
        }</a>`;
    })
    .join("");

  const bosses = d.matrix.slice(0, 8);
  const names = d.members.map((m) => m.name);
  const bossRows = bosses
    .map((b) => {
      const best = Math.max(...b.players.map((p) => p.bestDps));
      const cells = names
        .map((n) => {
          const p = b.players.find((x) => x.name.toLowerCase() === n.toLowerCase());
          if (!p) return `<td class="muted">–</td>`;
          const lead = p.bestDps === best;
          return `<td class="${lead ? "lead" : ""}">${lead ? '<span class="crown" aria-label="führt">★</span> ' : ""}${fmtShort(p.bestDps)}</td>`;
        })
        .join("");
      return `<tr><td><b>${esc(b.boss)}</b><div class="muted small">${b.dungeonId ? `${esc(dungeonName(b.dungeonId))} · ` : ""}${b.fights} Kämpfe</div></td>${cells}</tr>`;
    })
    .join("");

  const recent = d.recent
    .map(
      (f) => `<a class="frow" href="#/fight/${f.id}">
        <div><b>${esc(f.boss)}</b>${f.field ? ' <span class="badge">Feldboss</span>' : ""}<div class="muted small">${fmtDate(f.startMs)} · ${fmtTime(f.durationMs)}${f.members.length > 1 ? " · zusammen" : ""}</div></div>
        <div class="frow-people">${f.members
          .slice(0, 3)
          .map((p) => `<span class="mini">${avatar(p.name, p.job, p.jobId)}<span>${esc(p.name)}</span><b>${fmtShort(p.dps)}</b></span>`)
          .join("")}</div></a>`,
    )
    .join("");

  view.innerHTML = `<div class="page">
    ${pageHead("Übersicht", "Unsere Gruppe auf einen Blick")}
    <div id="livePanel">${livePanel()}</div>
    <div class="mcards">${cards}</div>
    ${weekCard(d.week, d.members)}
    ${recordsCard(d.records, d.members)}
    <div class="kpis">
      ${kpi("Kämpfe zusammen", fmtNum(g.together), `von ${fmtNum(g.fights)} Bosskämpfen`)}
      ${kpi("Diese Woche", fmtNum(g.fights7), "Bosskämpfe")}
      ${kpi("Unser Schaden", fmtShort(g.dmg), "gesamt")}
      ${kpi("Bosse", fmtNum(g.bosses), "verschiedene")}
    </div>
    ${
      g.fights
        ? `<div class="grid-2">
      <section class="card"><div class="card-head"><h2>Wer führt?</h2><a class="link" href="#/compare">Vergleich →</a></div>
        <p class="muted small">Bester DPS je Boss, ★ = vorne.</p>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Boss</th>${names.map((n) => `<th>${esc(n)}</th>`).join("")}</tr></thead><tbody>${bossRows}</tbody></table></div>
      </section>
      <section class="card"><div class="card-head"><h2>Letzte Kämpfe</h2><a class="link" href="#/fights">Alle →</a></div>
        <div class="flist">${recent}</div></section>
    </div>`
        : empty("Noch keine Kämpfe", "Sobald ihr einen Boss legt, lädt die App den Kampf automatisch hoch – dann füllt sich diese Seite.")
    }
  </div>`;
}

