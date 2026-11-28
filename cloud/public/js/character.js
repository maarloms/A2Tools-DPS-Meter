// Charakter-Seite: Suche → Trefferliste → Kopfbereich, Werte, Ausrüstung (Item-Karten mit Aufklappen), Optimizer.
// Daten kommen über den Worker-Proxy /api/character/* aus den öffentlichen NCSOFT-Diensten (docs/ncsoft-character-api.md).
// Eigenes Design nur für diesen Reiter: /character.css, alles unter .char-page.
// Hash: #/character  oder  #/character/<region>/<serverId>/<characterId>

import { SLOT_DE, mountOptimizer, rollInfo } from "./optimizer.js";
import { $, $$, empty, esc, fmtNum, nf1, view } from "./core.js";

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
const GRADE = { Common: "common", Rare: "rare", Legend: "legend", Unique: "unique", Epic: "epic", Ultimate: "ultimate", Special: "special" };
const GRADE_DE = { Common: "Gewöhnlich", Rare: "Selten", Legend: "Legendär", Unique: "Einzigartig", Epic: "Episch", Ultimate: "Ultimativ", Special: "Besonders" };
const GROUPS = [
  ["Waffen", (s) => /^(MainHand|SubHand)$/.test(s)],
  ["Rüstung", (s) => /^(Helmet|Shoulder|Torso|Pants|Gloves|Boots|Cape)$/.test(s)],
  ["Schmuck", (s) => /^(Belt|Necklace|Earring|Ring|Bracelet|Amulet)/.test(s)],
  ["Runen", (s) => /^Rune/.test(s)],
  ["Arkana", (s) => /^Arcana/.test(s)],
];
const ATTRS = ["STR", "DEX", "CON", "AGI", "WIS"];

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
let cur = null; // { region, serverId, id, data, cache: Map<slotPos, Promise<Item>>, loaded: Map<slotPos, Item> }
let cssP = null;

function ensureCss() {
  cssP ??= new Promise((res) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "/character.css";
    l.onload = l.onerror = () => res();
    document.head.append(l);
  });
  return cssP;
}

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

const ICO = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
};

const skeleton = () => `<div class="cp-skel" aria-busy="true" aria-label="Charakter wird geladen">
  <div class="cp-hero"><div class="sk sk-portrait"></div><div class="sk-col"><div class="sk sk-line w60"></div><div class="sk sk-line w40"></div></div>
    <div class="sk sk-kpi"></div><div class="sk sk-kpi"></div><div class="sk sk-kpi"></div></div>
  <div class="cp-cols"><div class="sk sk-panel tall"></div><div class="sk-col"><div class="sk sk-panel"></div><div class="sk sk-panel"></div></div></div></div>`;

const placeholder = () => `<div class="cp-empty">${ICO.user}<b>Noch kein Charakter gewählt</b>
  <p>Wähle oben Region und Server, gib den Namen ein und starte die Suche. Gefunden werden Charaktere ab Stufe 45.</p></div>`;

const errorBox = (msg, retry) => `<div class="cp-empty err" role="alert"><b>Das hat nicht geklappt</b><p>${esc(msg)}</p>${retry ? '<button type="button" class="cp-btn" data-retry>Noch einmal versuchen</button>' : ""}</div>`;

/** Einstieg: Hash auswerten */
export async function loadCharacter() {
  const m = /^#\/character\/([a-z]+)\/(\d{4,5})\/([^/]+)$/.exec(location.hash);
  const saved = store.get();
  const region = m ? m[1] : saved.region || "eu";
  await ensureCss();
  view.innerHTML = `<div class="char-page">${skeleton()}</div>`;
  let list = [];
  try {
    list = await loadServers(region);
  } catch {
    /* Suche geht auch ohne Serverliste */
  }
  view.innerHTML = `<div class="char-page">
    <header class="cp-top"><h1>Charakter</h1><p>Ausrüstung, Würfe, Magiesteine und Seelenbindung aus den öffentlichen NCSOFT-Daten.</p></header>
    <form id="chSearch" class="cp-search" autocomplete="off" role="search">
      <label class="cp-f"><span>Region</span><select id="chRegion">${REGIONS.map(([v, l]) => `<option value="${v}" ${v === region ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="cp-f"><span>Server</span><select id="chServer">${serverOptions(list, saved.region === region ? saved.serverId : "")}</select></label>
      <label class="cp-f grow"><span>Charaktername</span><input id="chName" type="search" placeholder="z. B. Akira" minlength="2" maxlength="24" required value="${esc(saved.name || "")}"></label>
      <button class="cp-btn primary" type="submit">${ICO.search}<span>Suchen</span></button>
    </form>
    <details class="cp-hits" id="chHits" hidden><summary><span id="chHitsTitle">Treffer</span>${ICO.chev}</summary><div id="chResults"></div></details>
    <div id="chDetail">${placeholder()}</div>
    <p class="cp-note">Die Daten liefert NCSOFT und können bis zu 10 Minuten alt sein.</p></div>`;
  // Bilder, die nicht laden (z. B. Porträt-Weiterleitung auf einen nicht erlaubten Host): Platzhalter statt kaputtem Bild
  view.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img.tagName !== "IMG" || !img.closest(".char-page")) return;
      const holder = img.closest(".cp-portrait, .cp-hit-av");
      if (holder) holder.innerHTML = ICO.user;
      else img.style.visibility = "hidden";
    },
    true,
  );
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
    if (saved.name) search(1, true);
    openCharacter(m[1], Number(m[2]), decodeURIComponent(m[3]));
  }
}

async function search(page, quiet = false) {
  const region = $("#chRegion").value;
  const serverId = $("#chServer").value;
  const name = $("#chName").value.trim();
  const wrap = $("#chHits");
  const box = $("#chResults");
  store.set({ region, serverId, name });
  wrap.hidden = false;
  wrap.open = !quiet;
  $("#chHitsTitle").textContent = "Suche …";
  box.innerHTML = `<div class="cp-hit-grid">${'<div class="sk sk-hit"></div>'.repeat(3)}</div>`;
  try {
    const r = await call("search", { q: name, region, ...(serverId ? { server: serverId } : {}), page });
    $("#chHitsTitle").textContent = `${fmtNum(r.total)} ${r.total === 1 ? "Treffer" : "Treffer"} für „${name}“`;
    if (!r.list.length) {
      box.innerHTML = empty("Nichts gefunden", "Prüfe den Namen und den Server. Gesucht wird nur ab Stufe 45.");
      return;
    }
    box.innerHTML = `<div class="cp-hit-grid">${r.list
      .map(
        (c) => `<a class="cp-hit" href="#/character/${esc(region)}/${c.serverId}/${encodeURIComponent(rawId(c.id))}">
          <span class="cp-hit-av">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ICO.user}</span>
          <span class="cp-hit-main"><b>${esc(c.name)}</b><small>${esc(c.serverName)} · ${RACE[c.race] || "?"}</small></span>
          <span class="cp-lvl">Stufe ${c.level}</span></a>`,
      )
      .join("")}</div>
      ${r.endPage > 1 ? `<div class="cp-pager"><button type="button" class="cp-btn ghost" data-page="-1" ${page > 1 ? "" : "disabled"}>Zurück</button><span>Seite ${page} / ${r.endPage}</span>
        <button type="button" class="cp-btn ghost" data-page="1" ${page < r.endPage ? "" : "disabled"}>Weiter</button></div>` : ""}`;
    $$("button[data-page]", box).forEach((b) => b.addEventListener("click", () => search(page + Number(b.dataset.page))));
  } catch (e) {
    $("#chHitsTitle").textContent = "Suche fehlgeschlagen";
    box.innerHTML = errorBox(e.message);
  }
}

async function openCharacter(region, serverId, id) {
  const box = $("#chDetail");
  box.innerHTML = skeleton();
  try {
    const data = await call(`${serverId}/${encodeURIComponent(id)}`, { region });
    cur = { region, serverId, id, data, cache: new Map(), loaded: new Map() };
    $("#chHits")?.removeAttribute("open");
    renderDetail();
    box.scrollIntoView({ block: "start" });
  } catch (e) {
    box.innerHTML = errorBox(e.message, true);
    $("[data-retry]", box)?.addEventListener("click", () => openCharacter(region, serverId, id));
  }
}

// ---------- Teile laden (mit Cache, gemeinsam für Karten, Summen und Optimizer) ----------

function fetchItem(it) {
  const c = cur;
  if (!c.cache.has(it.slotPos)) {
    const p = call(`${c.serverId}/${encodeURIComponent(c.id)}/item`, { region: c.region, item: it.id, enchant: it.enchant, slot: it.slotPos }).then(
      (r) => {
        c.loaded.set(it.slotPos, r);
        return r;
      },
      (e) => {
        c.cache.delete(it.slotPos);
        throw e;
      },
    );
    c.cache.set(it.slotPos, p);
  }
  return c.cache.get(it.slotPos);
}

// ---------- Darstellung ----------

const grade = (g) => GRADE[g] || "common";
const icon = (url, cls = "") => (url ? `<img class="cp-ico-img ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cp-ico-img ${cls}"></span>`);
const tier = (q) => (q >= 2 / 3 ? "hi" : q >= 1 / 3 ? "mid" : "lo");
const pct0 = (q) => `${Math.round(q * 100)} %`;

/** Wurfqualität als kleiner Balken (0–1); null = keine Vergleichsdaten */
const qbar = (q, title = "") =>
  q === null || q === undefined
    ? `<span class="cp-q none" title="Keine Vergleichsdaten">–</span>`
    : `<span class="cp-q ${tier(q)}" title="${esc(title)}"><span class="cp-q-bar"><i style="width:${Math.max(3, Math.round(q * 100))}%"></i></span><b>${pct0(q)}</b></span>`;

function parseVal(v) {
  const m = /^\+?(-?[\d.,]+)\s*(%?)$/.exec(String(v ?? "").trim());
  return m ? { n: Number(m[1].replace(",", ".")), unit: m[2] } : null;
}
const ATTACK = /Damage$|Accuracy|Critical$|CombatSpeed|Pierce|HitRate|Perfect|Amplify|Attack(?!Defense)/;
const DEFENSE = /Defen[cs]e|Resist|Block|Evasion|Reduce|Decrease/;
const sumGroup = (id) => (/^(FrontAttackDefense|ArmorDefense|CriticalDamageDefense|CriticalResist|Block|Evasion|ArmorEvasion|PvEDecreaseDamage)$/.test(id) || (DEFENSE.test(id) && !ATTACK.test(id)) ? "Verteidigung" : ATTACK.test(id) ? "Angriff" : "Sonstiges");

function renderDetail() {
  const d = cur.data;
  const levelStat = d.stats.find((s) => s.type === "ItemLevel");
  const attrs = ATTRS.map((t) => d.stats.find((s) => s.type === t)).filter(Boolean);
  const powers = d.stats.filter((s) => s.type !== "ItemLevel" && !ATTRS.includes(s.type));
  const gear = d.items.filter((i) => i.slotPos <= 19);
  const avgEnh = gear.length ? gear.reduce((a, i) => a + (i.enchant || 0), 0) / gear.length : 0;
  const bar = (s, max) => `<li><span class="cp-stat-n">${esc(s.name.replace(/\s*\[.*\]$/, ""))}${/\[(.*)\]$/.exec(s.name) ? `<small>${esc(/\[(.*)\]$/.exec(s.name)[1])}</small>` : ""}</span>
    <span class="cp-stat-bar"><i style="width:${Math.min(100, Math.round((s.value / max) * 100))}%"></i></span><b>${fmtNum(s.value)}</b></li>`;
  const maxP = Math.max(50, ...powers.map((s) => s.value));
  const maxA = Math.max(30, ...attrs.map((s) => s.value));
  const slots = [...d.items].sort((a, b) => a.slotPos - b.slotPos);
  $("#chDetail").innerHTML = `
    <section class="cp-hero" aria-label="Charakter">
      <div class="cp-portrait">${d.image ? `<img src="${esc(d.image)}" alt="Porträt von ${esc(d.name)}" referrerpolicy="no-referrer">` : ICO.user}</div>
      <div class="cp-id"><h2>${esc(d.name)}</h2>
        <div class="cp-tags"><span class="cp-tag strong">${esc(d.className)}</span><span class="cp-tag">Stufe ${d.level}</span><span class="cp-tag">${esc(d.race)}</span><span class="cp-tag">${esc(d.serverName)}</span>${d.gender ? `<span class="cp-tag">${esc(d.gender)}</span>` : ""}</div>
        ${d.title ? `<p class="cp-title">„${esc(d.title)}“</p>` : ""}</div>
      <dl class="cp-kpis">
        <div class="cp-kpi main"><dt>Kampfkraft</dt><dd>${fmtNum(d.combatPower)}</dd></div>
        <div class="cp-kpi"><dt>Gegenstandsstufe</dt><dd>${levelStat ? fmtNum(levelStat.value) : "–"}</dd></div>
        <div class="cp-kpi"><dt>Ø Verbesserung</dt><dd>+${nf1.format(avgEnh)}</dd></div>
      </dl>
    </section>
    <div class="cp-cols">
      <aside class="cp-side">
        <section class="cp-panel"><h3>Attribute</h3><ul class="cp-stats">${attrs.map((s) => bar(s, maxA)).join("") || '<li class="cp-none">Keine Werte.</li>'}</ul></section>
        <section class="cp-panel"><h3>Göttliche Kräfte</h3><ul class="cp-stats">${powers.map((s) => bar(s, maxP)).join("") || '<li class="cp-none">Keine Werte.</li>'}</ul></section>
        <section class="cp-panel" id="chSums"><h3>Ausrüstungssummen</h3>
          <p class="cp-hint">Summe aller Grund-, Zufalls- und Steinwerte (ohne Verbesserungsbonus), gruppiert nach Angriff, Verteidigung und Sonstiges.</p>
          <button type="button" class="cp-btn" id="chLoadAll">Details aller Teile laden</button></section>
      </aside>
      <div class="cp-main">
        <section class="cp-panel"><div class="cp-panel-head"><h3>Ausrüstung</h3>
          <span class="cp-hint">Karte anklicken: Werte, Würfe, Magiesteine, Seelenbindung</span></div>
          ${GROUPS.map(([title, test]) => {
            const list = slots.filter((i) => test(i.slot));
            return list.length ? `<h4 class="cp-group">${title}</h4><div class="cp-items">${list.map(itemCard).join("")}</div>` : "";
          }).join("")}
          ${d.wing ? `<h4 class="cp-group">Flügel</h4><div class="cp-items"><article class="cp-item g-${grade(d.wing.grade)} static"><div class="cp-item-btn">
            <span class="cp-ico">${icon(d.wing.icon)}</span><span class="cp-item-main"><span class="cp-item-name">${esc(d.wing.name)}</span><span class="cp-item-meta">${GRADE_DE[d.wing.grade] || ""}</span></span>
            <span class="cp-item-badges">${d.wing.enchant ? `<span class="cp-enh">+${d.wing.enchant}</span>` : ""}</span></div></article></div>` : ""}</section>
        <div id="chOpt"></div>
      </div>
    </div>`;
  $$(".cp-item-btn[data-slot]", $("#chDetail")).forEach((b) => b.addEventListener("click", () => toggleItem(Number(b.dataset.slot))));
  $("#chLoadAll").addEventListener("click", loadAll);
  mountOptimizer($("#chOpt"), cur, (it) => fetchItem(it));
}

function itemCard(it) {
  return `<article class="cp-item g-${grade(it.grade)}" id="cpi-${it.slotPos}">
    <button type="button" class="cp-item-btn" data-slot="${it.slotPos}" aria-expanded="false" aria-controls="cpb-${it.slotPos}">
      <span class="cp-ico">${icon(it.icon)}</span>
      <span class="cp-item-main"><span class="cp-item-name">${esc(it.name)}</span><span class="cp-item-meta">${esc(SLOT_DE[it.slot] || it.slot)}<span class="lv"></span></span></span>
      <span class="cp-item-badges">${it.enchant ? `<span class="cp-enh" title="Verbesserungsstufe">+${it.enchant}</span>` : ""}${it.exceed ? `<span class="cp-exc" title="Überschreitung">+${it.exceed}</span>` : ""}<span class="cp-chev">${ICO.chev}</span></span>
    </button>
    <div class="cp-item-q"></div>
    <div class="cp-item-body" id="cpb-${it.slotPos}" hidden></div></article>`;
}

/** Karte nach dem Laden mit Stufe und mittlerer Wurfqualität ergänzen */
async function decorate(slotPos, r) {
  const card = $(`#cpi-${slotPos}`);
  if (!card || card.dataset.done) return;
  card.dataset.done = "1";
  $(".lv", card).textContent = r.level ? ` · Gegenstandsstufe ${r.level}` : "";
  const info = await rollInfo(cur.data.items.find((x) => x.slotPos === slotPos)?.slot, r.level, r.subStats).catch(() => null);
  const known = (info || []).filter((x) => x && x.quality !== null);
  $(".cp-item-q", card).innerHTML = known.length ? `<span class="cp-q-label">Würfe</span>${qbar(known.reduce((a, x) => a + x.quality, 0) / known.length, "Mittlere Wurfqualität (0 % = schlechtester, 100 % = bester beobachteter Wert)")}` : "";
}

async function toggleItem(slotPos) {
  const card = $(`#cpi-${slotPos}`);
  const btn = $(".cp-item-btn", card);
  const body = $(".cp-item-body", card);
  const open = btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", String(open));
  card.classList.toggle("open", open);
  body.hidden = !open;
  if (!open || body.dataset.ready) return;
  const it = cur.data.items.find((x) => x.slotPos === slotPos);
  body.innerHTML = `<div class="cp-load"><span class="spin"></span>Lade ${esc(it.name)} …</div>`;
  try {
    const r = await fetchItem(it);
    const info = await rollInfo(it.slot, r.level, r.subStats).catch(() => null);
    body.innerHTML = itemBody(r, info);
    body.dataset.ready = "1";
    decorate(slotPos, r);
  } catch (e) {
    body.innerHTML = errorBox(e.message, true);
    $("[data-retry]", body).addEventListener("click", () => {
      body.dataset.ready = "";
      card.classList.remove("open");
      toggleItem(slotPos).then(() => toggleItem(slotPos));
    });
  }
}

function itemBody(r, info) {
  const row = (s, q) => `<li><span>${esc(s.name)}</span><span class="v"><b>${esc(s.value)}</b>${s.extra && s.extra !== "0" && s.extra !== "0%" ? `<small class="plus">+${esc(s.extra)}</small>` : ""}${q === undefined ? "" : qbar(q?.quality ?? null, q ? `Beobachtet: ${fmtNum(q.min)}–${fmtNum(q.max)}, Ø ${nf1.format(q.mean)}, n=${q.samples}${q.pooled ? " (alle Stufen des Slots)" : ""}` : "")}</span></li>`;
  const bind = r.soulBind ? Math.min(100, Number(String(r.soulBind).replace(",", ".")) || 0) : null;
  const slotsN = r.stoneSlots || 0;
  const stones = [...r.stones].sort((a, b) => a.slotPos - b.slotPos);
  const empties = Math.max(0, slotsN - stones.length);
  return `<div class="cp-detail">
    <div class="cp-detail-head">
      <span class="cp-tag g">${esc(GRADE_DE[r.grade] || r.grade)}</span><span class="cp-tag">${esc(r.category)}</span>
      ${r.level ? `<span class="cp-tag">Gegenstandsstufe ${r.level}</span>` : ""}${r.equipLevel ? `<span class="cp-tag">ab Stufe ${r.equipLevel}</span>` : ""}
    </div>
    <div class="cp-meters">
      ${r.maxEnchant ? `<div class="cp-meter"><span>Verbesserung</span><span class="cp-pips" role="img" aria-label="Verbesserung +${r.enchant} von ${r.maxEnchant}">${Array.from({ length: r.maxEnchant }, (_, i) => `<i class="${i < r.enchant ? "on" : ""}"></i>`).join("")}</span><b>+${r.enchant} / ${r.maxEnchant}</b></div>` : ""}
      ${bind !== null ? `<div class="cp-meter"><span>Seelenbindung</span><span class="cp-prog"><i style="width:${bind}%"></i></span><b>${esc(r.soulBind)} %</b></div>` : ""}
    </div>
    <div class="cp-detail-cols">
      ${r.mainStats.length ? `<section><h5>Grundwerte</h5><ul class="cp-rows">${r.mainStats.map((s) => row(s)).join("")}</ul></section>` : ""}
      ${r.subStats.length ? `<section class="rolls"><h5>Zufallswerte <small>Würfe</small></h5><ul class="cp-rows">${r.subStats.map((s, i) => row(s, info ? info[i] ?? null : undefined)).join("")}</ul>${
        info ? '<p class="cp-hint">Balken: Lage im beobachteten Wertebereich (Stichprobe, kein offizielles Spielwissen).</p>' : ""
      }</section>` : ""}
      ${slotsN ? `<section><h5>Magiesteine <small>${stones.length} / ${slotsN}</small></h5><ul class="cp-stones">${stones
        .map((s) => `<li class="g-${grade(s.grade)}">${icon(s.icon, "sm")}<span class="n">${esc(s.name)}<small>${esc(GRADE_DE[s.grade] || s.grade)}</small></span><b>${esc(s.value)}</b></li>`)
        .join("")}${'<li class="empty">frei</li>'.repeat(empties)}</ul></section>` : ""}
      ${r.subSkills.length ? `<section><h5>Zusatzfertigkeiten</h5><ul class="cp-rows">${r.subSkills.map((s) => `<li><span class="sk-n">${icon(s.icon, "sm")}${esc(s.name)}</span><span class="v"><b>Stufe ${s.level}</b></span></li>`).join("")}</ul></section>` : ""}
    </div>
    ${r.sources?.length ? `<p class="cp-hint">Herkunft: ${r.sources.map(esc).join(" · ")}</p>` : ""}
  </div>`;
}

/** Alle Teile laden → Karten ergänzen, Summen berechnen */
async function loadAll() {
  const btn = $("#chLoadAll");
  const todo = cur.data.items;
  let done = 0;
  let failed = 0;
  btn.disabled = true;
  const prog = () => (btn.textContent = `Lade … ${done} / ${todo.length}`);
  prog();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const it = todo[next++];
      try {
        decorate(it.slotPos, await fetchItem(it));
      } catch {
        failed++;
      }
      done++;
      prog();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  renderSums(failed);
}

function renderSums(failed) {
  const agg = {};
  for (const r of cur.loaded.values()) {
    for (const s of [...(r.mainStats || []), ...(r.subStats || []), ...(r.stones || [])]) {
      const v = parseVal(s.value);
      if (!v) continue;
      const k = `${s.id}|${v.unit}`;
      agg[k] ??= { id: s.id, name: s.name, unit: v.unit, n: 0 };
      agg[k].n += v.n;
    }
  }
  const groups = { Angriff: [], Verteidigung: [], Sonstiges: [] };
  for (const a of Object.values(agg)) groups[sumGroup(a.id)].push(a);
  const fmt = (a) => (a.unit ? `${nf1.format(a.n)} %` : fmtNum(a.n));
  $("#chSums").innerHTML = `<h3>Ausrüstungssummen</h3>
    <p class="cp-hint">${cur.loaded.size} Teile ausgewertet${failed ? `, ${failed} nicht ladbar` : ""}. Ohne Verbesserungsbonus.</p>
    ${Object.entries(groups)
      .filter(([, l]) => l.length)
      .map(([t, l]) => `<h4 class="cp-group">${t}</h4><ul class="cp-sums">${l.sort((a, b) => a.name.localeCompare(b.name, "de")).map((a) => `<li><span>${esc(a.name)}</span><b>${fmt(a)}</b></li>`).join("")}</ul>`)
      .join("")}`;
}
