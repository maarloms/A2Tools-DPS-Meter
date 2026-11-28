// Charakter-Suche: Region/Server/Name → Trefferliste → Ausrüstung, Stats, Würfe, Magiesteine, Seelenbindung.
// Daten kommen über den Worker-Proxy /api/character/* aus den öffentlichen NCSOFT-Diensten (docs/ncsoft-character-api.md).
// Hash: #/character  oder  #/character/<region>/<serverId>/<characterId>

import { $, $$, empty, esc, fmtNum, loading, pageHead, view } from "./core.js";

const REGIONS = [
  ["eu", "Europa"],
  ["naw", "Nordamerika West"],
  ["nae", "Nordamerika Ost"],
  ["la", "Südamerika"],
  ["as", "Asien"],
];
const RACE = { 1: "Elyos", 2: "Asmodier" };
const KEY = "a2-character";
const ERRORS = {
  bad_name: "Der Name muss 2–24 Buchstaben oder Ziffern haben (keine Leerzeichen).",
  bad_region: "Unbekannte Region.",
  bad_server: "Unbekannter Server.",
  rate_limited: "Zu viele Abfragen – bitte kurz warten.",
  not_found: "Dazu gibt es keine Daten (Suche nur ab Stufe 45).",
  upstream: "Der NCSOFT-Dienst antwortet gerade nicht. Bitte später noch einmal versuchen.",
};
const GRADE_CLASS = { Common: "", Rare: "g-rare", Legend: "g-legend", Unique: "g-unique", Epic: "g-epic", Ultimate: "g-ultimate" };

const store = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  },
  set(v) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...store.get(), ...v }));
    } catch {
      /* egal */
    }
  },
};

/** Die Suche liefert die ID evtl. schon URL-kodiert ("…%3D"): einmal dekodieren, damit nicht doppelt kodiert wird */
const rawId = (id) => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};
const servers = {}; // region → Liste
let cur = null; // { region, serverId, id, data }

async function call(path, params) {
  const q = new URLSearchParams({ lang: "de", ...params });
  const r = await fetch(`/api/character/${path}?${q}`, { credentials: "same-origin" });
  if (r.status === 401) {
    location.replace("/");
    throw new Error("unauthorized");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(ERRORS[j.error] || (r.status === 404 && !j.error ? "Die Charakter-Abfrage ist auf diesem Server ausgeschaltet." : "Das hat nicht geklappt."));
    e.status = r.status;
    throw e;
  }
  return j;
}

async function loadServers(region) {
  if (!servers[region]) servers[region] = (await call("servers", { region })).servers;
  return servers[region];
}

const serverOptions = (list, sel) =>
  `<option value="">Alle Server</option>` +
  list.map((s) => `<option value="${s.id}" ${String(s.id) === String(sel) ? "selected" : ""}>${esc(s.name)} (${RACE[s.race] || "?"})</option>`).join("");

/** Einstieg: Hash auswerten */
export async function loadCharacter() {
  const m = /^#\/character\/([a-z]+)\/(\d{4,5})\/([^/]+)$/.exec(location.hash);
  const saved = store.get();
  const region = m ? m[1] : saved.region || "eu";
  view.innerHTML = loading("Charakter-Suche");
  let list = [];
  try {
    list = await loadServers(region);
  } catch {
    /* Suche geht auch ohne Serverliste */
  }
  view.innerHTML = `<div class="page">
    ${pageHead("Charakter", "Spieler nachschlagen: Ausrüstung, Würfe, Magiesteine und Seelenbindung aus den öffentlichen NCSOFT-Daten.")}
    <section class="card"><form id="chSearch" class="toolbar" autocomplete="off">
      <select class="select" id="chRegion" aria-label="Region">${REGIONS.map(([v, l]) => `<option value="${v}" ${v === region ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="select" id="chServer" aria-label="Server">${serverOptions(list, saved.region === region ? saved.serverId : "")}</select>
      <input class="input" id="chName" type="search" placeholder="Charaktername" minlength="2" maxlength="24" required value="${esc(saved.name || "")}" aria-label="Charaktername">
      <button class="btn" type="submit">Suchen</button>
    </form>
    <p class="muted small">Gefunden werden nur Charaktere ab Stufe 45. Die Daten liefert NCSOFT; sie können bis zu 10 Minuten alt sein.</p>
    <div id="chResults"></div></section>
    <div id="chDetail"></div></div>`;
  $("#chRegion").addEventListener("change", async (e) => {
    store.set({ region: e.target.value, serverId: "" });
    $("#chServer").innerHTML = serverOptions([], "");
    try {
      $("#chServer").innerHTML = serverOptions(await loadServers(e.target.value), "");
    } catch {
      /* Alle Server bleibt */
    }
  });
  $("#chSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    search(1);
  });
  if (m) {
    if (saved.name) search(1);
    openCharacter(m[1], Number(m[2]), decodeURIComponent(m[3]));
  } else if (saved.name && saved.region === region && location.hash === "#/character") $("#chName").focus();
}

async function search(page) {
  const region = $("#chRegion").value;
  const serverId = $("#chServer").value;
  const name = $("#chName").value.trim();
  const box = $("#chResults");
  store.set({ region, serverId, name });
  box.innerHTML = `<p class="muted">Suche …</p>`;
  try {
    const r = await call("search", { q: name, region, ...(serverId ? { server: serverId } : {}), page });
    if (!r.list.length) {
      box.innerHTML = empty("Nichts gefunden", "Prüfe den Namen und den Server. Gesucht wird nur ab Stufe 45.");
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Server</th><th>Volk</th><th class="num">Stufe</th></tr></thead><tbody>${r.list
      .map(
        (c) => `<tr><td><a class="link" href="#/character/${esc(region)}/${c.serverId}/${encodeURIComponent(rawId(c.id))}"><b>${esc(c.name)}</b></a></td>
        <td>${esc(c.serverName)}</td><td>${RACE[c.race] || "?"}</td><td class="num">${c.level}</td></tr>`,
      )
      .join("")}</tbody></table></div>
      <div class="toolbar" style="margin-top:12px"><span class="muted small">${fmtNum(r.total)} Treffer</span>
        ${page > 1 ? '<button type="button" class="btn ghost" data-page="-1">Zurück</button>' : ""}
        ${page < r.endPage ? '<button type="button" class="btn ghost" data-page="1">Weiter</button>' : ""}</div>`;
    $$("button[data-page]", box).forEach((b) => b.addEventListener("click", () => search(page + Number(b.dataset.page))));
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function openCharacter(region, serverId, id) {
  const box = $("#chDetail");
  box.innerHTML = loading("Charakter");
  try {
    const data = await call(`${serverId}/${encodeURIComponent(id)}`, { region });
    cur = { region, serverId, id, data };
    renderDetail();
    box.scrollIntoView({ block: "start" });
  } catch (e) {
    box.innerHTML = `<section class="card"><p class="muted">${esc(e.message)}</p></section>`;
  }
}

const icon = (url, cls = "") => (url ? `<img class="ch-icon ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ch-icon ${cls}"></span>`);
const gradeClass = (g) => GRADE_CLASS[g] ?? "";

function renderDetail() {
  const d = cur.data;
  const stats = d.stats
    .map((s) => `<tr><td>${esc(s.type === "ItemLevel" ? "Gegenstandsstufe" : s.name)}</td><td class="num">${fmtNum(s.value)}</td></tr>`)
    .join("");
  const slots = [...d.items].sort((a, b) => a.slotPos - b.slotPos);
  $("#chDetail").innerHTML = `<section class="card">
    <div class="ch-head">${d.image ? `<img class="ch-avatar" src="${esc(d.image)}" alt="" referrerpolicy="no-referrer">` : ""}
      <div><h2>${esc(d.name)}</h2>
      <p class="muted">${esc(d.className)} · Stufe ${d.level} · ${esc(d.race)} · ${esc(d.serverName)}${d.title ? ` · ${esc(d.title)}` : ""}</p></div>
      <div class="head-right"><div class="kpi"><div class="kpi-label">Kampfkraft</div><div class="kpi-value">${fmtNum(d.combatPower)}</div></div></div></div>
    <div class="grid-2">
      <div><h3>Ausrüstung</h3>
        <div class="ch-slots">${slots
          .map(
            (it) => `<button type="button" class="ch-slot ${gradeClass(it.grade)}" data-slot="${it.slotPos}" title="${esc(it.name)}">${icon(it.icon)}
              <span class="ch-slot-name">${esc(it.name)}</span><span class="ch-slot-lvl">${it.enchant ? `+${it.enchant}` : ""}${it.exceed ? ` (+${it.exceed})` : ""}</span></button>`,
          )
          .join("")}${d.wing ? `<div class="ch-slot ${gradeClass(d.wing.grade)}" title="${esc(d.wing.name)}">${icon(d.wing.icon)}<span class="ch-slot-name">${esc(d.wing.name)}</span><span class="ch-slot-lvl">${d.wing.enchant ? `+${d.wing.enchant}` : ""}</span></div>` : ""}</div></div>
      <div><h3>Werte</h3><div class="table-wrap"><table class="tbl"><tbody>${stats || '<tr><td class="muted">Keine Werte.</td></tr>'}</tbody></table></div>
        <div id="chItem" class="ch-item"><p class="muted small">Ein Ausrüstungsteil anklicken: Würfe, Magiesteine und Seelenbindung erscheinen hier.</p></div></div>
    </div></section>`;
  $$("button[data-slot]", $("#chDetail")).forEach((b) => b.addEventListener("click", () => showItem(Number(b.dataset.slot), b)));
}

async function showItem(slotPos, btn) {
  const it = cur.data.items.find((x) => x.slotPos === slotPos);
  const box = $("#chItem");
  $$(".ch-slot.on", $("#chDetail")).forEach((b) => b.classList.remove("on"));
  btn.classList.add("on");
  box.innerHTML = `<p class="muted small">Lade ${esc(it.name)} …</p>`;
  try {
    const r = await call(`${cur.serverId}/${encodeURIComponent(cur.id)}/item`, { region: cur.region, item: it.id, enchant: it.enchant, slot: it.slotPos });
    const stat = (s) => `<tr><td>${esc(s.name)}</td><td class="num">${esc(s.value)}${s.extra && s.extra !== "0" ? ` <span class="muted">(+${esc(s.extra)})</span>` : ""}</td></tr>`;
    box.innerHTML = `<h3>${esc(r.name)} ${r.enchant ? `<span class="badge">+${r.enchant}${r.maxEnchant ? ` / ${r.maxEnchant}` : ""}</span>` : ""}</h3>
      <p class="muted small">${esc(r.grade)} · ${esc(r.category)}${r.equipLevel ? ` · ab Stufe ${r.equipLevel}` : ""}${r.soulBind ? ` · Seelenbindung ${esc(r.soulBind)} %` : ""}</p>
      ${r.mainStats.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th colspan="2">Grundwerte</th></tr></thead><tbody>${r.mainStats.map(stat).join("")}</tbody></table></div>` : ""}
      ${r.subStats.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th colspan="2">Zufallswerte (Würfe)</th></tr></thead><tbody>${r.subStats.map(stat).join("")}</tbody></table></div>` : ""}
      ${r.subSkills.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th colspan="2">Zusatzfertigkeiten</th></tr></thead><tbody>${r.subSkills.map((s) => `<tr><td>${icon(s.icon, "sm")} ${esc(s.name)}</td><td class="num">Stufe ${s.level}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${r.stoneSlots ? `<div class="table-wrap"><table class="tbl"><thead><tr><th colspan="2">Magiesteine (${r.stones.length} / ${r.stoneSlots})</th></tr></thead><tbody>${
        r.stones.map((s) => `<tr><td>${icon(s.icon, "sm")} ${esc(s.name)} <span class="badge">${esc(s.grade)}</span></td><td class="num">${esc(s.value)}</td></tr>`).join("") ||
        '<tr><td colspan="2" class="muted">Keine eingesetzt.</td></tr>'
      }</tbody></table></div>` : ""}`;
  } catch (e) {
    box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`;
  }
}
