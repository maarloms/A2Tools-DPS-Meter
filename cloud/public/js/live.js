// Live-Gruppenmeter (Daten kommen per WebSocket, siehe app.js)

import { MODES, ago, esc, fmtShort, fmtTime, jobTag, nf1, state, view } from "./core.js";

export function renderLive() {
  const g = state.group;
  if (!g) {
    view.innerHTML = `<div class="card empty"><b>Verbinde …</b>Die Gruppenansicht kommt gleich.</div>`;
    return;
  }
  const members = g.members
    .map((m) => {
      const st = m.state === "fighting" ? "on" : m.state === "idle" ? "wait" : "off";
      const label = m.state === "fighting" ? `${fmtShort(m.dps)} DPS` : m.state === "idle" ? "bereit" : `offline · ${ago(m.updatedAt)}`;
      return `<span class="member ${m.state === "offline" ? "offline" : ""}" title="${esc(m.target ? "Ziel: " + m.target : "")}">
        <span class="dot ${st}"></span><span class="who">${esc(m.name)}</span><span class="what">${esc(label)}</span></span>`;
    })
    .join("");

  const encs = g.encounters;
  let body;
  if (!encs.length) {
    body = `<div class="card empty"><b>Noch kein Kampf</b>Sobald ein Mitglied mit verbundener App kämpft, erscheint der Schaden hier live.</div>`;
  } else {
    body = encs
      .map((e, i) => {
        if (i === 0) return `<article class="card">${encounterHtml(e, true)}</article>`;
        const open = state.openEnc.has(e.key) ? "open" : "";
        return `<details class="card more" data-key="${esc(e.key)}" ${open}>
          <summary>${esc(e.target.name || "Alle Ziele")} · ${e.players.length} Spieler · ${esc(e.reporters.join(", "))} · ${ago(e.updatedAt)}</summary>
          <div style="margin-top:10px">${encounterHtml(e, false)}</div></details>`;
      })
      .join("");
  }
  view.innerHTML = `<section class="members" aria-label="Mitglieder">${members || '<span class="meta">Noch kein Mitglied verbunden.</span>'}</section>${body}`;
  view.querySelectorAll("details.more").forEach((d) =>
    d.addEventListener("toggle", () => (d.open ? state.openEnc.add(d.dataset.key) : state.openEnc.delete(d.dataset.key))),
  );
}

function encounterHtml(e, primary) {
  const top = e.players[0]?.dmg || 1;
  const groupDps = e.players.filter((p) => p.member).reduce((s, p) => s + p.dps, 0);
  const t = e.target;
  const hpKnown = t.maxHp > 0;
  const hp = hpKnown ? (t.hp >= 0 ? t.hp : Math.max(0, t.maxHp - e.dealt)) : 0;
  const hpPct = hpKnown ? Math.max(0, Math.min(100, (hp / t.maxHp) * 100)) : 0;
  const meta = [MODES[t.mode] || t.mode, e.dungeonId ? `Instanz ${e.dungeonId}` : "", `gemeldet von ${e.reporters.join(", ")}`]
    .filter(Boolean)
    .map(esc)
    .join('<span class="sep">·</span>');
  const rows = e.players
    .map(
      (p, i) => `<div class="prow ${p.member ? "member" : ""}">
      <span class="fill" style="width:${((p.dmg / top) * 100).toFixed(1)}%"></span>
      <span class="rank">${i + 1}</span>${jobTag(p.job)}
      <span class="name">${esc(p.name)}${p.member && p.src && p.src.toLowerCase() !== p.name.toLowerCase() ? `<small>via ${esc(p.src)}</small>` : ""}</span>
      <span class="dps">${fmtShort(p.dps)}</span><span class="dmg">${fmtShort(p.dmg)}</span><span class="share">${nf1.format(p.share)}%</span></div>`,
    )
    .join("");
  return `
    <div class="enc-head">
      <div>
        ${primary ? `<h2>${esc(t.name || "Alle Ziele")}</h2>` : ""}
        <div class="meta">${meta}</div>
      </div>
      <span class="badge ${e.active ? "live" : ""}">${e.active ? "LIVE" : esc(ago(e.updatedAt))}</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Kampfzeit</div><div class="v">${fmtTime(e.battleTime)}</div></div>
      <div class="stat"><div class="k">Gesamtschaden am Ziel</div><div class="v">${fmtShort(e.dealt)}</div></div>
      <div class="stat"><div class="k">Gruppen-DPS</div><div class="v">${fmtShort(groupDps)}</div></div>
      ${hpKnown ? `<div class="stat"><div class="k">Ziel-HP</div><div class="v">${nf1.format(hpPct)} %</div></div>` : ""}
    </div>
    ${hpKnown ? `<div class="hp"><div class="hp-track" role="meter" aria-label="Ziel-HP" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hpPct.toFixed(0)}"><div class="hp-fill" style="width:${hpPct.toFixed(1)}%"></div></div>
      <div class="hp-label"><span>${fmtShort(hp)} / ${fmtShort(t.maxHp)}</span><span>${nf1.format(hpPct)} %</span></div></div>` : ""}
    <div class="rows-head" aria-hidden="true"><span>#</span><span>Klasse</span><span>Name</span><span>DPS</span><span class="h-dmg">Schaden</span><span>Anteil</span></div>
    <div class="rows">${rows}</div>`;
}
