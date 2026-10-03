// Kämpfe: Liste und Detail (nur Mitglieder; alle anderen als Sammelzeile „Andere“)

import { lineChart } from "./chart.js";
import {
  $, $$, SERIES_COLORS, api, apiJson, avatar, bossSelect, currentRoute, empty, esc, failed, fmtDate, fmtNum, fmtPct, fmtShort,
  fmtTime, job, kpi, loadBosses, loadMembers, loading, memberColor, pageHead, state, trunc, view,
} from "./core.js";

// ================= Liste =================

export async function loadFights(more = false) {
  if (!more && state.fights) renderFights();
  else if (!more) view.innerHTML = loading("Kämpfe");
  try {
    const qs = new URLSearchParams({ limit: "40" });
    if (state.train) qs.set("train", "1");
    if (state.bossFilter) qs.set("boss", state.bossFilter);
    if (more && state.next) qs.set("before", String(state.next));
    const [data] = await Promise.all([apiJson(`/fights?${qs}`), loadBosses().catch(() => null), loadMembers().catch(() => null)]);
    state.fights = more ? [...(state.fights || []), ...data.fights] : data.fights;
    state.next = data.next;
    if (currentRoute().name === "fights") renderFights();
  } catch (e) {
    failed(e, "Die Kampfliste");
  }
}

export function renderFights() {
  const q = state.query.trim().toLowerCase();
  const list = (state.fights || []).filter(
    (f) => !q || f.boss.toLowerCase().includes(q) || f.top.some((p) => p.name.toLowerCase().includes(q)),
  );
  const items = list
    .map((f) => {
      // Alle Spieler; die Gruppe zuerst und hervorgehoben, Andere gekürzt.
      const mine = f.top.filter((p) => p.member);
      const rest = f.top.filter((p) => !p.member);
      const ours = mine.reduce((s, p) => s + p.share, 0);
      const shown = [...mine, ...rest.slice(0, 3)];
      const more = rest.length - Math.min(rest.length, 3);
      return `<a class="fight" href="#/fight/${f.id}">
        <div class="fight-main"><div class="fight-boss">${esc(f.boss)}${f.isTrain ? ' <span class="badge">Training</span>' : ""}</div>
          <div class="muted small">${fmtDate(f.startMs)} · ${fmtTime(f.durationMs)}${f.dungeonId ? ` · Instanz ${f.dungeonId}` : ""}</div></div>
        <div class="fight-people">${shown
          .map((p) => `<span class="mini${p.member ? "" : " other"}">${avatar(p.name, p.job, p.jobId)}<span>${esc(p.name)}</span><b>${fmtShort(p.dps)}</b></span>`)
          .join("")}${more > 0 ? `<span class="mini other">+${more}</span>` : ""}</div>
        <div class="fight-right"><b>${fmtPct(ours)}</b><span class="muted small">unser Anteil</span></div>
      </a>`;
    })
    .join("");
  view.innerHTML = `<div class="page">
    ${pageHead("Kämpfe", "Alle hochgeladenen Bosskämpfe – neueste zuerst")}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="Boss oder Name suchen" value="${esc(state.query)}" aria-label="Suchen">
      ${bossSelect("bossSel", state.bossFilter)}
      <label class="check"><input type="checkbox" id="train" ${state.train ? "checked" : ""}> Training</label>
    </div>
    <div class="fights">${
      items ||
      empty(
        state.fights?.length ? "Nichts gefunden" : "Noch keine Kämpfe",
        state.fights?.length ? "Kein Kampf passt zur Suche." : "Sobald ihr einen Boss legt, lädt die App den Kampf automatisch hoch und er erscheint hier.",
      )
    }</div>
    ${state.next && !q ? `<p class="center"><button class="btn" id="more" type="button">Ältere laden</button></p>` : ""}</div>`;
  const search = $("#q", view);
  search.addEventListener("input", () => {
    state.query = search.value;
    const pos = search.selectionStart;
    renderFights();
    const s2 = $("#q", view);
    s2.focus();
    s2.setSelectionRange(pos, pos);
  });
  $("#bossSel", view).addEventListener("change", (e) => {
    state.bossFilter = e.target.value;
    state.fights = null;
    loadFights();
  });
  $("#train", view).addEventListener("change", (e) => {
    state.train = e.target.checked;
    state.fights = null;
    loadFights();
  });
  $("#more", view)?.addEventListener("click", () => loadFights(true));
}

// ================= Detail =================

const ui = { mode: "rolling", player: null };

export async function loadFight(id) {
  if (state.detail?.summary.id !== id) {
    view.innerHTML = loading("Kampf");
    try {
      await loadMembers().catch(() => null);
      state.detail = await apiJson(`/fights/${id}`);
      state.hiddenSeries.clear();
      ui.player = null;
    } catch (e) {
      if (e.message === "HTTP 404") view.innerHTML = `<div class="page">${empty("Kampf nicht gefunden", 'Er wurde gelöscht. <a href="#/fights">Zur Liste</a>')}</div>`;
      else failed(e, "Der Kampf");
      return;
    }
  }
  if (currentRoute().name === "fight") renderFight();
}

export function renderFight() {
  const d = state.detail;
  const s = d.summary;
  const o = d.others;
  const maxDmg = Math.max(d.players[0]?.dmg || 0, o?.dmg || 0, 1);
  const mine = d.players.filter((p) => p.member !== false);
  if (!ui.player || !d.players.some((p) => p.name === ui.player)) ui.player = (mine[0] ?? d.players[0])?.name ?? null;
  const ourShare = mine.reduce((a, p) => a + p.share, 0);
  const ourDps = mine.reduce((a, p) => a + p.dps, 0);
  const rows = d.players
    .map(
      (p, i) => `<tr class="p ${p.name === ui.player ? "sel" : ""}${p.member === false ? " other" : ""}" data-name="${esc(p.name)}" tabindex="0">
        <td class="muted">${i + 1}</td><td>${avatar(p.name, p.job, p.jobId)} <b>${esc(p.name)}</b></td>
        <td class="bar"><span class="fill" style="width:${((p.dmg / maxDmg) * 100).toFixed(1)}%"></span><span>${fmtShort(p.dps)}</span></td>
        <td class="num">${fmtShort(p.dmg)}</td><td class="num strong">${fmtPct(p.share)}</td><td class="num">${fmtPct(p.critRate)}</td>
        <td class="num">${fmtPct(p.backRate)}</td><td class="num hide-s">${p.heal ? fmtShort(p.heal) : "–"}</td><td class="num hide-s muted">${p.selfReport ? "eigene" : esc(p.source)}</td></tr>`,
    )
    .join("");
  const othersRow =
    o && o.count > 0
      ? `<tr class="others"><td></td><td class="muted">Andere (${fmtNum(o.count)})</td>
        <td class="bar"><span class="fill grey" style="width:${((o.dmg / maxDmg) * 100).toFixed(1)}%"></span><span class="muted">–</span></td>
        <td class="num muted">${fmtShort(o.dmg)}</td><td class="num muted">${fmtPct(o.share)}</td><td colspan="4" class="hide-s"></td></tr>`
      : "";
  const uploads = d.uploads
    .map(
      (u) => `<li><b>${esc(u.uploader)}</b> <span class="muted small">${u.startMs !== s.startMs ? `+${fmtTime(u.startMs - s.startMs)} · ` : ""}${fmtTime(u.durationMs)}</span>
        ${u.raw ? `<button class="btn small" type="button" data-raw="${u.id}">Original (JSON)</button>` : ""}</li>`,
    )
    .join("");

  view.innerHTML = `<div class="page">
    <p><a class="link" href="#/fights">← Alle Kämpfe</a></p>
    ${pageHead(s.boss, `${fmtDate(s.startMs)}${s.dungeonId ? ` · Instanz ${s.dungeonId}` : ""}${s.isTrain ? " · Training" : ""}`,
      `<button class="btn danger" id="del" type="button">Löschen</button>`)}
    <div class="kpis">
      ${kpi("Kampfzeit", fmtTime(s.durationMs))}
      ${kpi("Unser Anteil", fmtPct(ourShare), "am Bossschaden")}
      ${kpi("Unser DPS", fmtShort(ourDps), "zusammen")}
      ${kpi("Bossschaden", fmtShort(s.totalDamage), s.maxHp ? `Max-HP ${fmtShort(s.maxHp)}` : "")}
    </div>
    <section class="card"><h2>Spieler</h2>
      <p class="muted small">Alle Spieler im Kampf, unsere Gruppe hervorgehoben. Zeile antippen für die Skill-Analyse. Anteil = Anteil am gesamten Bossschaden.</p>
      <div class="table-wrap"><table class="tbl players">
        <thead><tr><th>#</th><th>Name</th><th>DPS</th><th class="num">Schaden</th><th class="num">Anteil</th><th class="num">Krit</th><th class="num">Rücken</th><th class="num hide-s">Heilung</th><th class="num hide-s">Messung</th></tr></thead>
        <tbody>${rows}${othersRow}</tbody></table></div></section>
    ${d.timeline.series.length ? `<section class="card">
      <div class="card-head"><h2>DPS-Verlauf</h2>
        <div class="seg" role="group" aria-label="Darstellung">
          <button type="button" data-mode="rolling" class="${ui.mode === "rolling" ? "on" : ""}">Gleitend</button>
          <button type="button" data-mode="avg" class="${ui.mode === "avg" ? "on" : ""}">Durchschnitt</button></div></div>
      <p class="muted small" id="dpsNote"></p>
      <div class="chart" id="dpsChart"></div><div class="legend" id="dpsLegend"></div></section>` : ""}
    <section class="card" id="skillCard"></section>
    <details class="card more"><summary>Mehr: Boss-HP, Ping, Messungen</summary><div class="more-body">
      ${s.maxHp && d.timeline.total ? `<h3>Boss-HP</h3><div class="chart" id="hpChart"></div>` : ""}
      ${d.ping.length ? `<h3>Ping</h3><div class="chart" id="pingChart"></div><div class="legend" id="pingLegend"></div>` : ""}
      <h3>Messungen</h3><p class="muted small">Jedes Mitglied mit App liefert eine eigene Messung; pro Person zählt die eigene.</p>
      <ul class="uploads">${uploads}</ul></div></details>
  </div>`;

  $$("tr.p", view).forEach((tr) => {
    const pick = () => {
      ui.player = tr.dataset.name;
      $$("tr.p", view).forEach((r) => r.classList.toggle("sel", r === tr));
      renderSkills();
      $("#skillCard").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
  });
  $$("[data-raw]", view).forEach((b) => b.addEventListener("click", () => downloadRaw(b.dataset.raw)));
  $("#del", view).addEventListener("click", deleteFight);
  $$(".seg button", view).forEach((b) =>
    b.addEventListener("click", () => {
      ui.mode = b.dataset.mode;
      $$(".seg button", view).forEach((x) => x.classList.toggle("on", x === b));
      drawCharts();
    }),
  );
  $("details.more", view).addEventListener("toggle", () => drawCharts());
  renderSkills();
  drawCharts();
}

/** Gleitender DPS wie in der App: Fenster ~10 % der Kampfzeit, 5–15 s */
function dpsPoints(series, mode, durationMs) {
  const { bucketMs, offsetMs, dmg } = series;
  const windowMs = Math.max(5000, Math.min(15000, durationMs * 0.1));
  const w = Math.max(1, Math.round(windowMs / bucketMs));
  const cum = [];
  dmg.reduce((acc, v, i) => (cum[i] = acc + v), 0);
  return dmg.map((_, i) => {
    const tEnd = (i + 1) * bucketMs;
    let v;
    if (mode === "avg") v = cum[i] / (tEnd / 1000);
    else {
      const from = Math.max(0, i - w + 1);
      v = (cum[i] - (from > 0 ? cum[from - 1] : 0)) / (((i - from + 1) * bucketMs) / 1000);
    }
    return { x: offsetMs + tEnd, y: v };
  });
}

export function drawCharts() {
  const d = state.detail;
  if (!d || currentRoute().name !== "fight") return;
  const s = d.summary;
  const xFmt = (v) => fmtTime(v);
  if ($("#dpsChart")) {
    const windowS = Math.round(Math.max(5000, Math.min(15000, s.durationMs * 0.1)) / 1000);
    $("#dpsNote").textContent = ui.mode === "rolling" ? `DPS im gleitenden ${windowS}-s-Fenster (wie in der App).` : "Durchschnitts-DPS seit Kampfbeginn.";
    lineChart($("#dpsChart"), {
      label: "DPS-Verlauf",
      // Nur die Gruppe, sonst wird das Diagramm bei Weltbossen unlesbar.
      series: (d.timeline.series.some((t) => t.member !== false) ? d.timeline.series.filter((t) => t.member !== false) : d.timeline.series).map((t) => ({ id: t.name, name: t.name, color: memberColor(t.name), pts: dpsPoints(t, ui.mode, s.durationMs) })),
      xMin: 0,
      xMax: s.durationMs,
      xFmt,
      yFmt: fmtShort,
      legend: $("#dpsLegend"),
      hidden: state.hiddenSeries,
      skipFrac: ui.mode === "avg" ? 0.08 : 0,
    });
  }
  if (!$("details.more")?.open) return;
  if ($("#hpChart")) {
    const t = d.timeline.total;
    let cum = 0;
    const pts = [{ x: t.offsetMs, y: 100 }].concat(
      t.dmg.map((v, i) => {
        cum += v;
        return { x: t.offsetMs + (i + 1) * t.bucketMs, y: Math.max(0, 100 - (cum / s.maxHp) * 100) };
      }),
    );
    lineChart($("#hpChart"), {
      label: "Boss-HP in Prozent",
      series: [{ id: "hp", name: "Boss-HP", color: "#e66767", pts }],
      xMin: 0,
      xMax: s.durationMs,
      xFmt,
      yFmt: (v) => `${Math.round(v)} %`,
      yMax: 100,
      height: 160,
    });
  }
  if ($("#pingChart")) {
    lineChart($("#pingChart"), {
      label: "Ping",
      series: d.ping.map((p) => ({ id: p.uploader, name: p.uploader, color: memberColor(p.uploader), pts: p.points.map(([t, ms]) => ({ x: p.offsetMs + t, y: ms })) })),
      xFmt,
      yFmt: (v) => `${Math.round(v)} ms`,
      legend: $("#pingLegend"),
      height: 150,
    });
  }
}

function renderSkills() {
  const d = state.detail;
  const card = $("#skillCard");
  const p = d.players.find((x) => x.name === ui.player);
  if (!card) return;
  if (!p) {
    card.innerHTML = `<h2>Skill-Analyse</h2>${empty("Keine Daten", "Für diesen Kampf liegen keine Skills von Mitgliedern vor.")}`;
    return;
  }
  const chips = d.players
    .map((x) => `<button type="button" class="chip ${x.name === p.name ? "on" : ""}" data-name="${esc(x.name)}">${esc(trunc(x.name, 16))}</button>`)
    .join("");
  const pct = (n, h) => (h ? fmtPct((n / h) * 100) : "–");
  const topDmg = p.skills[0]?.dmg || 1;
  const skillRows = p.skills
    .map(
      (k) => `<tr><td>${esc(k.name || k.code)}${k.dot ? ' <span class="badge">DoT</span>' : ""}</td>
        <td class="bar"><span class="fill" style="width:${((k.dmg / topDmg) * 100).toFixed(1)}%"></span><span>${fmtShort(k.dmg)}</span></td>
        <td class="num">${p.dmg ? fmtPct((k.dmg / p.dmg) * 100) : "–"}</td><td class="num">${fmtNum(k.hits)}</td>
        <td class="num">${pct(k.crit, k.hits)}</td><td class="num">${pct(k.back, k.hits)}</td>
        <td class="num hide-s">${pct(k.perfect, k.hits)}</td><td class="num hide-s">${pct(k.double, k.hits)}</td>
        <td class="num hide-s">${k.hits ? fmtShort(k.dmg / k.hits) : "–"}</td><td class="num hide-s">${fmtShort(k.max)}</td></tr>`,
    )
    .join("");
  const heals = p.heals?.length
    ? `<h3>Heilung</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Skill</th><th class="num">Menge</th><th class="num">Ticks</th></tr></thead><tbody>${p.heals
        .map((h) => `<tr><td>${esc(h.name)}${h.hot ? ' <span class="badge">HoT</span>' : ""}</td><td class="num">${fmtShort(h.amount)}</td><td class="num">${fmtNum(h.ticks)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : "";
  const lane = d.timeline.lanes.find((l) => l.name === p.name);
  card.innerHTML = `
    <div class="card-head"><h2>Skill-Analyse</h2><div class="chips">${chips}</div></div>
    <div class="kpis compact">
      ${kpi(job(p.job, p.jobId).name, esc(trunc(p.name, 16)), p.selfReport ? "eigene Messung" : `gemessen von ${esc(p.source)}`)}
      ${kpi("DPS", fmtShort(p.dps))}
      ${kpi("Krit · Rücken", `${fmtPct(p.critRate)} · ${fmtPct(p.backRate)}`)}
      ${kpi("Perfekt · Doppel", `${fmtPct(p.perfectRate)} · ${fmtPct(p.doubleRate)}`)}
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Skill</th><th>Schaden</th><th class="num">Anteil</th><th class="num">Treffer</th><th class="num">Krit</th><th class="num">Rücken</th>
        <th class="num hide-s">Perfekt</th><th class="num hide-s">Doppel</th><th class="num hide-s">Ø</th><th class="num hide-s">Max</th></tr></thead>
      <tbody>${skillRows || '<tr><td colspan="10" class="muted">Keine Skill-Daten</td></tr>'}</tbody></table></div>
    ${heals}
    ${lane ? `<h3>Skill-Zeitleiste</h3><p class="muted small">Treffer je ${Math.round(lane.bucketMs / 1000)} s – je kräftiger, desto mehr.</p><div class="lanes" id="lanes"></div>` : ""}`;
  $$(".chip", card).forEach((b) =>
    b.addEventListener("click", () => {
      ui.player = b.dataset.name;
      $$("tr.p", view).forEach((r) => r.classList.toggle("sel", r.dataset.name === ui.player));
      renderSkills();
    }),
  );
  if (lane) drawLanes($("#lanes"), lane, memberColor(p.name) || SERIES_COLORS[0]);
}

function drawLanes(host, lane, color) {
  const dur = state.detail.summary.durationMs;
  const W = Math.max(300, host.clientWidth || 600);
  const labelW = W < 500 ? 96 : 150;
  const rowH = 16;
  const gap = 4;
  const H = lane.skills.length * (rowH + gap) + 20;
  const iw = W - labelW - 8;
  const x = (t) => labelW + (t / dur) * iw;
  const maxC = Math.max(1, ...lane.skills.flatMap((s) => s.hits.map((h) => h[1])));
  const rows = lane.skills
    .map((s, i) => {
      const y = i * (rowH + gap);
      const cells = s.hits
        .map(([b, c]) => {
          const t0 = lane.offsetMs + b * lane.bucketMs;
          const w = Math.max(1.5, (lane.bucketMs / dur) * iw);
          return `<rect x="${x(t0).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" fill="${color}" opacity="${(0.25 + 0.75 * (c / maxC)).toFixed(2)}"><title>${esc(s.name)}: ${c} Treffer bei ${fmtTime(t0)}</title></rect>`;
        })
        .join("");
      return `<text x="0" y="${y + 12}" class="lane-label">${esc(trunc(s.name, W < 500 ? 13 : 22))}${s.dot ? " (DoT)" : ""}</text>
        <rect x="${labelW}" y="${y}" width="${iw}" height="${rowH}" class="lane-bg"/>${cells}`;
    })
    .join("");
  const axisY = lane.skills.length * (rowH + gap) + 12;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${x(dur * f)}" y="${axisY}" text-anchor="middle" class="lane-axis">${fmtTime(dur * f)}</text>`).join("");
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Skill-Zeitleiste">${rows}${ticks}</svg>`;
}

async function downloadRaw(uploadId) {
  try {
    const blob = await (await api(`/uploads/${uploadId}/raw`)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fight-${uploadId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch {
    /* 401 → Login */
  }
}

async function deleteFight() {
  const s = state.detail.summary;
  if (!confirm(`Kampf „${s.boss}“ vom ${fmtDate(s.startMs)} für alle löschen? Er fehlt dann auch in Bestwerten und Trends.`)) return;
  try {
    await api(`/fights/${s.id}`, { method: "DELETE" });
    state.detail = null;
    if (state.fights) state.fights = state.fights.filter((f) => f.id !== s.id);
    location.hash = "#/fights";
  } catch {
    alert("Löschen hat nicht geklappt.");
  }
}
