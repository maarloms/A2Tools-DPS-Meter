// Kampfliste und Kampf-Detail mit Skill-Analyse

import { lineChart } from "./chart.js";
import {
  $, $$, SERIES_COLORS, apiJson, api, bossLabel, currentRoute, empty, esc, failed, fmtDate, fmtNum, fmtPct, fmtShort,
  fmtTime, jobTag, job, loadBosses, loading, state, trunc, view,
} from "./core.js";

// ================= Liste =================

export async function loadFights(more = false) {
  if (!more && state.fights) renderFights();
  else if (!more) view.innerHTML = loading("Kämpfe");
  try {
    const qs = new URLSearchParams({ limit: "50" });
    if (state.train) qs.set("train", "1");
    if (state.bossFilter) qs.set("boss", state.bossFilter);
    if (more && state.next) qs.set("before", String(state.next));
    const [data] = await Promise.all([apiJson(`/fights?${qs}`), loadBosses().catch(() => null)]);
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
    (f) =>
      !q ||
      f.boss.toLowerCase().includes(q) ||
      f.uploaders.some((u) => u.toLowerCase().includes(q)) ||
      f.top.some((p) => p.name.toLowerCase().includes(q)),
  );
  const items = list
    .map((f) => {
      const tops = f.top
        .slice(0, 3)
        .map((p) => `<b>${esc(p.name)}</b> ${fmtShort(p.dps)}`)
        .join('<span class="sep">·</span>');
      return `<a class="fight" href="#/fight/${f.id}">
        <div><div class="boss">${esc(f.boss)}${f.isTrain ? ' <span class="badge">Training</span>' : ""}</div>
          <div class="meta">${fmtDate(f.startMs)}<span class="sep">·</span>${fmtTime(f.durationMs)}<span class="sep">·</span>${esc(f.uploaders.join(", "))}</div></div>
        <div class="tops">${tops || "–"}</div>
        <div class="right"><div class="v">${fmtShort(f.totalDamage)}</div><div class="meta">${fmtShort(f.totalDamage / (f.durationMs / 1000))} DPS</div></div>
      </a>`;
    })
    .join("");
  const bossOpts = (state.bosses || [])
    .map((b) => `<option value="${esc(b.key)}" ${b.key === state.bossFilter ? "selected" : ""}>${esc(bossLabel(b))} (${b.fights})</option>`)
    .join("");
  view.innerHTML = `
    <div class="toolbar">
      <input class="search" type="search" placeholder="Boss, Spieler oder Uploader suchen" value="${esc(state.query)}" aria-label="Suchen">
      <select class="select" id="bossSel" aria-label="Boss"><option value="">Alle Bosse</option>${bossOpts}</select>
      <label class="check" style="margin:0"><input type="checkbox" id="train" ${state.train ? "checked" : ""}> Training</label>
      <button class="btn" id="reload" type="button">Aktualisieren</button>
    </div>
    <div class="fights">${items || empty("Keine Kämpfe", state.fights?.length ? "Nichts passt zur Suche." : "Noch nichts hochgeladen. Die App lädt abgeschlossene Bosskämpfe automatisch hoch, solange sie in einem Raum ist.")}</div>
    ${state.next && !q ? `<p style="text-align:center"><button class="btn" id="more" type="button">Ältere laden</button></p>` : ""}`;
  const search = $(".search", view);
  search.addEventListener("input", () => {
    state.query = search.value;
    const pos = search.selectionStart;
    renderFights();
    const s2 = $(".search", view);
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
  $("#reload", view).addEventListener("click", () => {
    state.fights = null;
    loadBosses(true).catch(() => null);
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
      state.detail = await apiJson(`/fights/${id}`);
      state.hiddenSeries.clear();
      ui.player = null;
    } catch (e) {
      if (e.message === "HTTP 404") view.innerHTML = empty("Nicht gefunden", 'Der Kampf wurde gelöscht. <a href="#/fights">Zur Liste</a>');
      else failed(e, "Der Kampf");
      return;
    }
  }
  if (currentRoute().name === "fight") renderFight();
}

/** Farbe je Spieler – fest für diesen Kampf (Reihenfolge der Zeitreihen) */
function colorMap(d) {
  const m = new Map();
  d.timeline.series.forEach((s, i) => m.set(s.name.toLowerCase(), SERIES_COLORS[i % SERIES_COLORS.length]));
  return m;
}

export function renderFight() {
  const d = state.detail;
  const s = d.summary;
  const maxDmg = d.players[0]?.dmg || 1;
  const memberSet = new Set((state.members || []).map((m) => m.name.toLowerCase()));
  for (const u of s.uploaders) memberSet.add(u.toLowerCase());
  if (!ui.player || !d.players.some((p) => p.name === ui.player)) {
    ui.player = (d.players.find((p) => p.selfReport) || d.players[0])?.name ?? null;
  }
  const rows = d.players
    .map((p, i) => {
      const cls = [memberSet.has(p.name.toLowerCase()) ? "member" : "", p.name === ui.player ? "sel" : ""].join(" ");
      return `<tr class="p ${cls}" data-name="${esc(p.name)}" tabindex="0">
        <td>${i + 1}</td><td>${jobTag(p.job, p.jobId)}</td><td>${esc(p.name)}</td>
        <td class="bar"><span class="fill" style="width:${((p.dmg / maxDmg) * 100).toFixed(1)}%"></span><span>${fmtShort(p.dps)}</span></td>
        <td>${fmtShort(p.dmg)}</td><td>${fmtPct(p.share)}</td><td>${fmtPct(p.critRate)}</td><td>${fmtPct(p.backRate)}</td>
        <td>${fmtNum(p.hits)}</td><td>${p.heal ? fmtShort(p.heal) : "–"}</td><td>${p.cp ? fmtNum(p.cp) : "–"}</td>
        <td class="src">${p.selfReport ? "selbst" : esc(p.source)}</td></tr>`;
    })
    .join("");
  const uploads = d.uploads
    .map(
      (u) => `<li><b>${esc(u.uploader)}</b> <span class="meta">${u.startMs !== s.startMs ? `+${fmtTime(u.startMs - s.startMs)} · ` : ""}${fmtTime(u.durationMs)}</span>
        ${u.raw ? `<button class="btn small" type="button" data-raw="${u.id}">Original (JSON)</button>` : ""}</li>`,
    )
    .join("");
  view.innerHTML = `
    <p><a href="#/fights">← Alle Kämpfe</a></p>
    <article class="card">
      <div class="enc-head">
        <div><h2>${esc(s.boss)}</h2>
          <div class="meta">${fmtDate(s.startMs)}${s.dungeonId ? `<span class="sep">·</span>Instanz ${s.dungeonId}` : ""}${s.isTrain ? '<span class="sep">·</span>Training' : ""}</div></div>
        <div class="detail-actions"><button class="btn danger" id="del" type="button">Löschen</button></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">Kampfzeit</div><div class="v">${fmtTime(s.durationMs)}</div></div>
        <div class="stat"><div class="k">Gesamtschaden</div><div class="v">${fmtShort(s.totalDamage)}</div></div>
        <div class="stat"><div class="k">Schaden / s gesamt</div><div class="v">${fmtShort(s.totalDamage / (s.durationMs / 1000))}</div></div>
        ${s.maxHp ? `<div class="stat"><div class="k">Max-HP Ziel</div><div class="v">${fmtShort(s.maxHp)}</div></div>` : ""}
        <div class="stat"><div class="k">Beteiligte</div><div class="v">${fmtNum(s.actorCount)}</div></div>
      </div>
      <div class="meta">Perspektiven (je ein Meter):</div>
      <ul class="uploads">${uploads}</ul>
    </article>

    ${d.timeline.series.length ? `<article class="card">
      <div class="card-head"><h3>DPS-Verlauf</h3>
        <div class="seg" role="group" aria-label="Darstellung">
          <button type="button" data-mode="rolling" class="${ui.mode === "rolling" ? "on" : ""}">Gleitend</button>
          <button type="button" data-mode="avg" class="${ui.mode === "avg" ? "on" : ""}">Durchschnitt</button>
        </div></div>
      <p class="meta" id="dpsNote"></p>
      <div class="chart" id="dpsChart"></div><div class="legend" id="dpsLegend"></div>
    </article>` : ""}

    ${s.maxHp && d.timeline.total ? `<article class="card"><h3>Boss-HP</h3>
      <p class="meta">Aus dem Meter von ${esc(d.timeline.total.source)} (Schaden aller Spieler, die es gesehen hat).</p>
      <div class="chart" id="hpChart"></div></article>` : ""}

    <article class="card">
      <h3>Spieler</h3>
      <p class="meta">Zeile antippen für die Skill-Analyse.${s.actorCount > d.players.length ? ` Gezeigt: ${d.players.length} von ${s.actorCount}.` : ""} „Quelle“: wessen Meter den Wert geliefert hat.</p>
      <div class="table-wrap"><table class="players">
        <thead><tr><th>#</th><th>Klasse</th><th>Name</th><th>DPS</th><th>Schaden</th><th>Anteil</th><th>Krit</th><th>Rücken</th><th>Treffer</th><th>Heilung</th><th>KP</th><th>Quelle</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </article>

    <article class="card" id="skillCard"></article>
    ${d.ping.length ? `<article class="card"><h3>Ping</h3><div class="chart" id="pingChart"></div><div class="legend" id="pingLegend"></div></article>` : ""}`;

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
      const sum = cum[i] - (from > 0 ? cum[from - 1] : 0);
      v = sum / (((i - from + 1) * bucketMs) / 1000);
    }
    return { x: offsetMs + tEnd, y: v };
  });
}

export function drawCharts() {
  const d = state.detail;
  if (!d || currentRoute().name !== "fight") return;
  const s = d.summary;
  const colors = colorMap(d);
  const xFmt = (v) => fmtTime(v);
  if ($("#dpsChart")) {
    const windowS = Math.round(Math.max(5000, Math.min(15000, s.durationMs * 0.1)) / 1000);
    $("#dpsNote").textContent =
      ui.mode === "rolling" ? `DPS im gleitenden ${windowS}-s-Fenster (wie in der App).` : "Durchschnitts-DPS seit Kampfbeginn.";
    lineChart($("#dpsChart"), {
      label: "DPS-Verlauf",
      series: d.timeline.series.map((t) => ({
        id: t.name,
        name: t.name,
        color: colors.get(t.name.toLowerCase()),
        pts: dpsPoints(t, ui.mode, s.durationMs),
      })),
      xMin: 0,
      xMax: s.durationMs,
      xFmt,
      yFmt: fmtShort,
      legend: $("#dpsLegend"),
      hidden: state.hiddenSeries,
      skipFrac: ui.mode === "avg" ? 0.08 : 0,
    });
  }
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
      height: 170,
    });
  }
  if ($("#pingChart")) {
    lineChart($("#pingChart"), {
      label: "Ping",
      series: d.ping.map((p, i) => ({
        id: p.uploader,
        name: p.uploader,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        pts: p.points.map(([t, ms]) => ({ x: p.offsetMs + t, y: ms })),
      })),
      xFmt,
      yFmt: (v) => `${Math.round(v)} ms`,
      legend: $("#pingLegend"),
      height: 160,
    });
  }
}

function renderSkills() {
  const d = state.detail;
  const card = $("#skillCard");
  const p = d.players.find((x) => x.name === ui.player);
  if (!card || !p) return;
  const chips = d.players
    .slice(0, 16)
    .map((x) => `<button type="button" class="chip ${x.name === p.name ? "on" : ""}" data-name="${esc(x.name)}">${esc(trunc(x.name, 16))}</button>`)
    .join("");
  const pct = (n, h) => (h ? fmtPct((n / h) * 100) : "–");
  const skillRows = p.skills
    .map(
      (k) => `<tr><td>${esc(k.name || k.code)}${k.dot ? ' <span class="badge">DoT</span>' : ""}</td>
        <td class="bar"><span class="fill" style="width:${((k.dmg / (p.skills[0]?.dmg || 1)) * 100).toFixed(1)}%"></span><span>${fmtShort(k.dmg)}</span></td>
        <td>${p.dmg ? fmtPct((k.dmg / p.dmg) * 100) : "–"}</td><td>${fmtNum(k.hits)}</td>
        <td>${pct(k.crit, k.hits)}</td><td>${pct(k.back, k.hits)}</td><td>${pct(k.perfect, k.hits)}</td><td>${pct(k.double, k.hits)}</td>
        <td>${pct(k.frontal, k.hits)}</td><td>${pct(k.parry, k.hits)}</td><td>${k.multiHits ? fmtNum(k.multiHits) : "–"}</td>
        <td>${fmtShort(k.min)}</td><td>${k.hits ? fmtShort(k.dmg / k.hits) : "–"}</td><td>${fmtShort(k.max)}</td></tr>`,
    )
    .join("");
  const heals = p.heals?.length
    ? `<h4>Heilung</h4><div class="table-wrap"><table class="skilltab"><thead><tr><th>Skill</th><th>Menge</th><th>Ticks</th></tr></thead><tbody>${p.heals
        .map((h) => `<tr><td>${esc(h.name)}${h.hot ? ' <span class="badge">HoT</span>' : ""}</td><td>${fmtShort(h.amount)}</td><td>${fmtNum(h.ticks)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : "";
  const lane = d.timeline.lanes.find((l) => l.name === p.name);
  card.innerHTML = `
    <div class="card-head"><h3>Skill-Analyse</h3><span class="meta">${p.selfReport ? "eigene Messung" : `gemessen von ${esc(p.source)}`}</span></div>
    <div class="chips" role="group" aria-label="Spieler wählen">${chips}</div>
    <div class="stats">
      <div class="stat"><div class="k">${esc(job(p.job, p.jobId).name)}</div><div class="v">${esc(trunc(p.name, 16))}</div></div>
      <div class="stat"><div class="k">DPS</div><div class="v">${fmtShort(p.dps)}</div></div>
      <div class="stat"><div class="k">Schaden · Anteil</div><div class="v">${fmtShort(p.dmg)} · ${fmtPct(p.share)}</div></div>
      <div class="stat"><div class="k">Krit · Rücken</div><div class="v">${fmtPct(p.critRate)} · ${fmtPct(p.backRate)}</div></div>
      <div class="stat"><div class="k">Perfekt · Doppel</div><div class="v">${fmtPct(p.perfectRate)} · ${fmtPct(p.doubleRate)}</div></div>
    </div>
    <div class="table-wrap"><table class="skilltab big">
      <thead><tr><th>Skill</th><th>Schaden</th><th>Anteil</th><th>Treffer</th><th>Krit</th><th>Rücken</th><th>Perfekt</th><th>Doppel</th><th>Front</th><th>Parade</th><th>Multi</th><th>Min</th><th>Ø</th><th>Max</th></tr></thead>
      <tbody>${skillRows || '<tr><td colspan="14">Keine Skill-Daten</td></tr>'}</tbody></table></div>
    ${heals}
    ${lane ? `<h4>Skill-Zeitleiste</h4><p class="meta">Treffer je ${Math.round(lane.bucketMs / 1000)} s – je dunkler, desto mehr.</p><div class="lanes" id="lanes"></div>` : ""}`;
  $$(".chip", card).forEach((b) =>
    b.addEventListener("click", () => {
      ui.player = b.dataset.name;
      $$("tr.p", view).forEach((r) => r.classList.toggle("sel", r.dataset.name === ui.player));
      renderSkills();
    }),
  );
  if (lane) drawLanes($("#lanes"), lane, colorMap(d).get(p.name.toLowerCase()) || SERIES_COLORS[0]);
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
  if (!confirm(`Kampf „${s.boss}“ vom ${fmtDate(s.startMs)} für alle im Raum löschen? Bestenliste und Trends verlieren ihn ebenfalls.`)) return;
  try {
    await api(`/fights/${s.id}`, { method: "DELETE" });
    state.detail = null;
    if (state.fights) state.fights = state.fights.filter((f) => f.id !== s.id);
    location.hash = "#/fights";
  } catch {
    alert("Löschen hat nicht geklappt.");
  }
}
