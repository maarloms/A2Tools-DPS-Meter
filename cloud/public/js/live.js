// Live-Gruppenmeter (Daten per WebSocket, siehe app.js). Nur Mitglieder;
// alle anderen erscheinen als eine Sammelzeile „Andere“.

import {
  ago, avatar, dungeonName, empty, esc, fmtShort, fmtTime, MODES, nf1, pageHead, state, view,
} from "./core.js";

export function renderLive() {
  const g = state.group;
  if (!g) {
    view.innerHTML = `<div class="page">${pageHead("Live")}${empty("Verbinde …", "Die Live-Ansicht kommt gleich.")}</div>`;
    return;
  }
  const members = g.members
    .map((m) => {
      const st = m.state === "fighting" ? "on" : m.state === "idle" ? "wait" : "off";
      const label = m.state === "fighting" ? `${fmtShort(m.dps)} DPS` : m.state === "idle" ? "bereit" : `offline · ${ago(m.updatedAt)}`;
      return `<span class="pill ${m.state === "offline" ? "dim" : ""}"><span class="dot ${st}"></span><b>${esc(m.name)}</b><span class="muted">${esc(label)}</span></span>`;
    })
    .join("");

  const encs = g.encounters;
  const body = !encs.length
    ? empty("Gerade kämpft niemand", "Sobald jemand mit verbundener App einen Gegner angreift, erscheint der Schaden hier – live, ohne Neuladen.")
    : encs
        .map((e, i) => {
          if (i === 0) return `<section class="card">${encounterHtml(e, true)}</section>`;
          const open = state.openEnc.has(e.key) ? "open" : "";
          return `<details class="card more" data-key="${esc(e.key)}" ${open}>
            <summary>${esc(e.target.name || "Alle Ziele")} · ${esc(e.reporters.join(", "))} · ${ago(e.updatedAt)}</summary>
            <div class="more-body">${encounterHtml(e, false)}</div></details>`;
        })
        .join("");
  view.innerHTML = `<div class="page">${pageHead("Live", "Schaden der Gruppe im laufenden Kampf")}
    <div class="pills">${members || '<span class="muted">Noch niemand mit der App verbunden.</span>'}</div>${body}</div>`;
  view.querySelectorAll("details.more").forEach((d) =>
    d.addEventListener("toggle", () => (d.open ? state.openEnc.add(d.dataset.key) : state.openEnc.delete(d.dataset.key))),
  );
}

/** Zeilen: nur Mitglieder + Sammelzeile „Andere“ */
export function meterRows(e, compact = false) {
  const top = Math.max(e.players[0]?.dmg || 0, e.others?.dmg || 0, 1);
  const rows = e.players
    .map(
      (p, i) => `<div class="prow">
      <span class="fill" style="width:${((p.dmg / top) * 100).toFixed(1)}%;--c:var(--gold-fill)"></span>
      <span class="rank">${i + 1}</span>${avatar(p.name, p.job)}
      <span class="name">${esc(p.name)}</span>
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
  const groupDps = e.players.reduce((s, p) => s + p.dps, 0);
  const groupShare = e.players.reduce((s, p) => s + p.share, 0);
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
