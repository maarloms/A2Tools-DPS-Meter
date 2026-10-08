// Reset-Checkliste: tägliche und wöchentliche Aufgaben je Spieler und Charakter (Main + Twinks).
// Vorlage: Wakayashis Checkliste (wakayashi.gg/aion2#checklist, Video „Mach DAS vor dem Reset!“).
// Gespeichert wird im Raum (GET/PATCH /checklist), damit Handy und PC denselben Stand zeigen.
// Ein Stand zählt nur im Zeitraum, in dem er gesetzt wurde – nach dem Reset steht wieder 0 da.

import { $, $$, activeMembers, api, apiJson, avatar, currentRoute, empty, esc, failed, getMe, loading, loadMembers, notify, pageHead, view } from "./core.js";

// ---------- Aufgaben ----------
// max = Anzahl je Zeitraum; maxTwink, falls Twinks weniger bekommen; twink:false = nur auf dem Main.

const SECTIONS = [
  {
    id: "daily",
    title: "Täglich",
    tasks: [
      { id: "pflicht", name: "Pflicht-Quests", max: 5, twink: false,
        hint: "Ab Stufe 45 unter J → Missionen. Belohnungen weiter links im Loot-Pool sind wahrscheinlicher – Energie, Schlüssel und Tickets nehmen. Neu würfeln kostet Kinah und wird teurer." },
      { id: "feldboss", name: "Wichtiger Feldboss", max: 2, twink: false, link: "#/timer",
        hint: "Der Feldboss mit dem besten Loot erscheint alle 12 Stunden – 5 Minuten vorher da sein, er stirbt in Sekunden. Für die Beitragskiste reicht ein Treffer." },
    ],
  },
  {
    id: "weekly",
    title: "Wöchentlich",
    tasks: [
      { id: "dungeon", name: "Täglicher Dungeon", max: 14, twink: false,
        hint: "14 Tickets zum Wochen-Reset. Möglichst spät in der Woche laufen: höherer Gear Score bringt mehr Verstärkungssteine. Der Kinah-Dungeon lohnt nicht." },
      { id: "aszension", name: "Aszensionsritus", max: 3, twink: true,
        hint: "3 Tickets, auch auf Twinks – die Belohnung lässt sich über das Server-Lager zum Main schieben. Bei Extrem gibt es Zeit- und Todeslimit; scheitert der Lauf, ist das Ticket weg." },
      { id: "schlachtfeld", name: "Schlachtfeld-Siege", max: 3, twink: true,
        hint: "3 Siege pro Woche für Abyss-Punkte und Medaillen. Ausrüstung ist ausgeglichen, eine Runde dauert 10–15 Minuten." },
      { id: "weihstaette", name: "Weihstätte (Raid)", max: 1, twink: true,
        hint: "1× pro Woche. Mit Mitgliedschaft wird die Kiste zweimal gelootet." },
      { id: "pve-auftrag", name: "PvE-Händleraufträge", max: 12, twink: false,
        hint: "Schriftrollenhändler in der Stadt: 12 Aufträge für 15.000 Kinah, einmal pro Server. Gleich erledigen statt horten." },
      { id: "pvp-auftrag", name: "PvP-Händleraufträge", max: 20, twink: false,
        hint: "Schriftrollenhändler im Abyss: je 5 weiße, grüne, blaue und gelbe. Meist nur Monster töten – auch für PvE-Spieler." },
      { id: "konvertierung", name: "Energie: Konvertierung", max: 20, maxTwink: 4, twink: true,
        hint: "Esc → Konvertierung → Spezial. 16 je Server (Main) plus 4 je Charakter, je 40 Energie. Kostet Kinah und Odil-Energie." },
      { id: "pass-shop", name: "Energie: Mitgliedschafts-Shop", max: 20, maxTwink: 4, twink: true,
        hint: "Shop → Handelsgilde Spezial (nur mit Mitgliedschaft). 16 je Server plus 4 je Charakter." },
      { id: "pass-xp", name: "Pass-XP (15.000)", max: 1, twink: true,
        hint: "Wöchentliches XP-Limit der Deva-Pässe. Auf wenig gespielten Twinks schnell verpasst." },
    ],
  },
  {
    id: "abyss",
    title: "Abyss-Artefakte",
    tasks: [
      { id: "abyss-artefakt", name: "Artefakt-Portale", max: 3, twink: true,
        hint: "Nach der Artefakt-Belagerung (Mo, Do, Sa 21 Uhr): Karte → Abyss, jedes eigene Portal betreten und rund 2 Minuten Monster töten. Ab Stufe 45 und 1000 Gear Score." },
    ],
  },
];

const RECHARGE = [
  ["Expedition / Transzendenz", "15 Energie alle 3 Std.", "Main + Twinks", "Voll bei 840 (mit Mitgliedschaft, ~7 Tage) bzw. 560 (~4½ Tage) – vorher abbauen."],
  ["Albtraum", "2 Tickets pro Tag", "Main + Twinks", "Stufen 1–10, für die nächste Stufe die vorigen Bosse auf 10 abschließen."],
  ["Shugo", "3 Schlüssel pro Tag", "nur Main", "Jede volle Stunde, Symbol neben der Minikarte. Höchstens 21 je Woche."],
  ["Beritra", "1 Schlüssel pro Tag", "nur Main", "Luftangriff zur halben Stunde (nicht jede). Etwas Schaden reicht."],
];

// ---------- Reset-Zeiten ----------
// Täglich 07:00 UTC (9 Uhr Sommerzeit, 8 Uhr Winterzeit), wöchentlich Mittwoch.
// Abyss-Artefakte: nach der Belagerung Mo/Do/Sa 21:00 deutscher Zeit.

const RESET_UTC_HOUR = 7;
const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function dailyStart(now) {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RESET_UTC_HOUR);
  return t > now ? t - DAY : t;
}
function weeklyStart(now) {
  let t = dailyStart(now);
  while (new Date(t).getUTCDay() !== 3) t -= DAY;
  return t;
}

const berlin = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});
function berlinParts(ms) {
  const p = Object.fromEntries(berlin.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: p.weekday };
}
/** Zeitpunkt „y-m-d h:00 in Berlin“ als ms */
function berlinMs(y, m, d, h) {
  const guess = Date.UTC(y, m - 1, d, h);
  const p = berlinParts(guess);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  return guess - offset;
}
const ABYSS_DAYS = new Set(["Mon", "Thu", "Sat"]);
function abyssStart(now) {
  for (let i = 0; i < 8; i++) {
    const p = berlinParts(now - i * DAY);
    if (!ABYSS_DAYS.has(p.wd)) continue;
    const t = berlinMs(p.y, p.m, p.d, 21);
    if (t <= now) return t;
  }
  return now;
}
function nextAbyss(now) {
  for (let i = 0; i < 8; i++) {
    const p = berlinParts(now + i * DAY);
    if (!ABYSS_DAYS.has(p.wd)) continue;
    const t = berlinMs(p.y, p.m, p.d, 21);
    if (t > now) return t;
  }
  return now;
}

/** Zeitraum-Kennung je Abschnitt (passt zum Server-Format /^[a-z]\d{4}-\d{2}-\d{2}$/) */
function periods(now) {
  const p = berlinParts(abyssStart(now));
  return {
    daily: "d" + isoDay(dailyStart(now)),
    weekly: "w" + isoDay(weeklyStart(now)),
    abyss: `a${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
  };
}
const nextReset = (now) => ({ daily: dailyStart(now) + DAY, weekly: weeklyStart(now) + 7 * DAY, abyss: nextAbyss(now) });

const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
function left(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d} T ${h} Std` : h ? `${h} Std ${m % 60} min` : `${m % 60} min`;
}

// ---------- Zustand ----------

let data = null; // { maxChars, players: [{ player, chars, items }] }
let player = "";
let editChars = false;
let col = "main"; // Handy: welcher Charakter gezeigt wird (eine Spalte)
const narrow = matchMedia("(max-width: 860px)");
narrow.addEventListener("change", () => currentRoute().name === "checklist" && data && render());
let tick = null;
let lastPeriods = "";
let loadedAt = 0;
const pending = new Map(); // "char|task" → Timer (Schreiben gebündelt)

const maxFor = (task, char) => (char === "main" ? task.max : task.twink ? (task.maxTwink ?? task.max) : 0);
const sectionOf = (taskId) => SECTIONS.find((s) => s.tasks.some((t) => t.id === taskId));

function countOf(p, char, taskId, per) {
  const it = p.items.find((i) => i.char === char && i.task === taskId);
  return it && it.period === per[sectionOf(taskId).id] ? it.count : 0;
}
function progress(p, section, per) {
  let done = 0;
  let total = 0;
  for (const t of section.tasks)
    for (const c of p.chars) {
      const max = maxFor(t, c.id);
      total += max;
      done += Math.min(max, countOf(p, c.id, t.id, per));
    }
  return { done, total };
}

/** Stand je Spieler und Abschnitt, für die Live-Seite: [{ player, sections: [{ id, title, done, total }] }] */
export function checklistSummary(list, now = Date.now()) {
  const per = periods(now);
  return (list?.players ?? []).map((p) => ({
    player: p.player,
    sections: SECTIONS.map((s) => ({ id: s.id, title: s.title, ...progress(p, s, per) })),
  }));
}
/** Nächster Tagesreset als „in 3 Std 12 min“ */
export const dailyResetIn = (now = Date.now()) => left(nextReset(now).daily - now);

// ---------- Laden ----------

export async function loadChecklist() {
  view.innerHTML = loading("Checkliste");
  try {
    await loadMembers();
    await refresh();
    const names = data.players.map((p) => p.player);
    if (!names.some((n) => n.toLowerCase() === player.toLowerCase())) player = getMe() || "";
    render();
    clearInterval(tick);
    tick = setInterval(onTick, 1000);
  } catch (e) {
    failed(e, "Die Checkliste");
  }
}

async function refresh() {
  data = await apiJson("/checklist");
  loadedAt = Date.now();
}

function onTick() {
  if (currentRoute().name !== "checklist") return clearInterval(tick);
  const now = Date.now();
  const per = JSON.stringify(periods(now));
  if (lastPeriods && per !== lastPeriods) return render(); // Reset: alles wieder auf 0
  // Stand anderer Geräte alle 60 s nachladen (nicht, während hier noch geschrieben wird)
  if (now - loadedAt > 60_000 && !pending.size && !editChars) {
    loadedAt = now;
    refresh().then(() => currentRoute().name === "checklist" && !pending.size && render()).catch(() => null);
  }
  renderClock(now);
}

// ---------- Anzeige ----------

function renderClock(now) {
  const next = nextReset(now);
  const set = (id, t) => {
    const el = $(`#${id}`);
    if (el) el.textContent = `${left(t - now)} · ${timeFmt.format(t).replace(".", "")}`;
  };
  set("rDaily", next.daily);
  set("rWeekly", next.weekly);
  set("rAbyss", next.abyss);
}

function render() {
  if (currentRoute().name !== "checklist") return;
  const now = Date.now();
  const per = periods(now);
  lastPeriods = JSON.stringify(per);
  const members = activeMembers();
  if (!members.length) {
    view.innerHTML = `<div class="page">${pageHead("Checkliste")}${empty("Noch keine Mitglieder", "Sobald jemand die App verbindet, gibt es hier eine Checkliste je Spieler.")}</div>`;
    return;
  }
  const me = getMe();
  const p = data.players.find((x) => x.player.toLowerCase() === player.toLowerCase());
  const chips = data.players
    .map((x) => `<button type="button" class="chip ${p && x.player === p.player ? "on" : ""}" data-player="${esc(x.player)}">${esc(x.player)}${
      x.player.toLowerCase() === me.toLowerCase() ? " (du)" : ""}</button>`)
    .join("");
  const reset = `${clockFmt.format(dailyStart(now) + DAY)} Uhr`;

  view.innerHTML = `<div class="page checklist">
    ${pageHead("Checkliste", `Vor dem Reset erledigen: täglich ${reset}, wöchentlich mittwochs ${reset}. Stand für die ganze Gruppe gespeichert.`)}
    <div class="resets">
      <div class="reset"><span>Täglicher Reset</span><b id="rDaily" class="num"></b></div>
      <div class="reset"><span>Wöchentlicher Reset</span><b id="rWeekly" class="num"></b></div>
      <div class="reset"><span>Nächste Artefakt-Belagerung</span><b id="rAbyss" class="num"></b></div>
    </div>
    <div class="chips">${chips}</div>
    ${p ? playerView(p, per) : `<div class="empty"><b>Wessen Checkliste?</b><p>Oben einen Namen wählen.</p></div>`}
    ${rechargeCard()}
    ${groupCard(per)}
  </div>`;
  renderClock(now);
  bind(p, per);
}

function playerView(p, per) {
  // Auf dem Handy passt nur eine Charakter-Spalte – umschalten statt seitlich scrollen
  const one = narrow.matches && p.chars.length > 1;
  if (!p.chars.some((c) => c.id === col)) col = "main";
  const cols = one ? p.chars.filter((c) => c.id === col) : p.chars;
  const head = `<tr><th>Aufgabe</th>${cols.map((c) => `<th class="cc">${esc(c.name)}</th>`).join("")}</tr>`;
  const sections = SECTIONS.map((s) => {
    const pr = progress(p, s, per);
    const rows = s.tasks
      .map((t) => {
        const name = `${esc(t.name)}${t.twink ? "" : ' <span class="meta">nur Main</span>'}`;
        return `<tr><td class="task"><details><summary>${name}</summary><p class="meta">${esc(t.hint)}${
          t.link ? ` <a href="${t.link}">Event-Timer →</a>` : ""}</p></details></td>${cols.map((c) => cell(p, c, t, per)).join("")}</tr>`;
      })
      .join("");
    const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
    return `<section class="card clsec ${pr.done >= pr.total ? "done" : ""}">
      <div class="card-head"><h2>${esc(s.title)}</h2><span class="clprog"><span class="bar"><i style="width:${pct}%"></i></span><b class="num">${pr.done}/${pr.total}</b></span></div>
      <div class="table-wrap"><table class="tbl cltbl"><thead>${head}</thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  return `<div class="cltools">
      <span class="muted small">Charaktere: ${p.chars.map((c) => esc(c.name)).join(", ")}</span>
      <button type="button" class="btn small" id="clChars" aria-expanded="${editChars}">${editChars ? "Fertig" : "Twinks verwalten"}</button>
    </div>
    ${editChars ? charEditor(p) : ""}
    ${one ? `<div class="seg clcol" role="group" aria-label="Charakter">${p.chars.map((c) => `<button type="button" data-col="${esc(c.id)}" class="${c.id === col ? "on" : ""}" aria-pressed="${c.id === col}">${esc(c.name)}</button>`).join("")}</div>` : ""}
    ${sections}`;
}

function cell(p, c, t, per) {
  const max = maxFor(t, c.id);
  if (!max) return `<td class="cc na" title="nur auf dem Main">–</td>`;
  const n = Math.min(max, countOf(p, c.id, t.id, per));
  const full = n >= max;
  const key = `data-char="${esc(c.id)}" data-task="${esc(t.id)}" data-max="${max}"`;
  if (max === 1)
    return `<td class="cc"><button type="button" class="tick ${full ? "on" : ""}" ${key} data-set="${full ? 0 : 1}" aria-pressed="${full}"
      aria-label="${esc(t.name)} – ${esc(c.name)}">${full ? "✓" : ""}</button></td>`;
  return `<td class="cc"><div class="stepper ${full ? "on" : ""}">
      <button type="button" ${key} data-set="${n - 1}" ${n ? "" : "disabled"} aria-label="eins weniger">−</button>
      <button type="button" class="val num" ${key} data-set="${full ? 0 : max}" title="${full ? "zurücksetzen" : "alle erledigt"}">${n}/${max}</button>
      <button type="button" ${key} data-set="${n + 1}" ${full ? "disabled" : ""} aria-label="eins mehr">+</button></div></td>`;
}

function charEditor(p) {
  const rows = p.chars
    .map((c, i) => `<div class="charrow"><input class="input" maxlength="24" data-cid="${esc(c.id)}" value="${esc(c.name)}" aria-label="Name ${i ? "Twink" : "Main"}">
      ${i ? `<button type="button" class="btn small danger" data-remove="${esc(c.id)}">Entfernen</button>` : '<span class="meta">Main</span>'}</div>`)
    .join("");
  return `<section class="card chared">
    <p class="muted small">Twinks bekommen eigene Spalten. Aufgaben, die es nur einmal pro Server gibt, zählen nur auf dem Main.
      Beim Entfernen gehen die Haken dieses Twinks verloren.</p>
    <div id="charRows">${rows}</div>
    <p>${p.chars.length < data.maxChars ? '<button type="button" class="btn small" id="clAdd">+ Twink</button> ' : ""}
      <button type="button" class="btn small primary" id="clSave">Speichern</button></p></section>`;
}

function rechargeCard() {
  return `<section class="card"><h2>Aufladungen</h2>
    <p class="muted small">Laden sich von selbst auf und laufen voll – rechtzeitig abbauen.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Was</th><th>Aufladung</th><th>Für</th><th>Hinweis</th></tr></thead><tbody>${RECHARGE.map(
      ([a, b, c, d]) => `<tr><td class="lead">${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td><td class="muted">${esc(d)}</td></tr>`,
    ).join("")}</tbody></table></div></section>`;
}

function groupCard(per) {
  const rows = data.players
    .map((x) => {
      const cells = SECTIONS.map((s) => {
        const pr = progress(x, s, per);
        const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
        return `<td class="bar"><span class="fill ${pct >= 100 ? "" : "grey"}" style="width:${pct}%"></span><span>${pr.done}/${pr.total}</span></td>`;
      }).join("");
      return `<tr class="p" data-player="${esc(x.player)}"><td class="lead">${avatar(x.player)}${esc(x.player)}</td><td class="num">${x.chars.length}</td>${cells}</tr>`;
    })
    .join("");
  return `<section class="card"><h2>Gruppe</h2>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Spieler</th><th class="num">Chars</th>${SECTIONS.map((s) => `<th>${esc(s.title)}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
}

// ---------- Bedienung ----------

function bind(p, per) {
  $$("[data-player]", view).forEach((el) =>
    el.addEventListener("click", () => {
      player = el.dataset.player;
      editChars = false;
      col = "main";
      render();
      window.scrollTo(0, 0);
    }),
  );
  if (!p) return;
  $("#clChars")?.addEventListener("click", async () => {
    // „Fertig“ ohne Speichern verwirft lokale Änderungen an den Charakteren
    if (editChars) await refresh().catch(() => null);
    editChars = !editChars;
    render();
  });
  $$("button[data-col]", view).forEach((b) =>
    b.addEventListener("click", () => {
      col = b.dataset.col;
      render();
    }),
  );
  $$("button[data-set]", view).forEach((b) => b.addEventListener("click", () => setCount(p, b.dataset.char, b.dataset.task, Number(b.dataset.set), Number(b.dataset.max), per)));
  if (editChars) bindEditor(p);
}

function setCount(p, char, task, value, max, per) {
  const count = Math.max(0, Math.min(max, value));
  const period = per[sectionOf(task).id];
  const it = p.items.find((i) => i.char === char && i.task === task);
  const before = it ? { ...it } : null;
  if (it) Object.assign(it, { count, period });
  else p.items.push({ char, task, count, period, updated: Date.now() });
  render();
  // Mehrere schnelle Klicks → nur der letzte Stand geht raus
  const key = `${p.player}|${char}|${task}`;
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(async () => {
      try {
        await api("/checklist", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player: p.player, char, task, count, period }),
        });
      } catch {
        if (before) Object.assign(it, before);
        else p.items = p.items.filter((i) => !(i.char === char && i.task === task));
        notify("<b>Nicht gespeichert</b><div>Der Haken konnte nicht gespeichert werden. Bitte nochmal versuchen.</div>");
        render();
      } finally {
        pending.delete(key);
      }
    }, 400),
  );
}

function bindEditor(p) {
  let chars = p.chars.map((c) => ({ ...c }));
  const sync = () =>
    $$("#charRows input", view).forEach((inp) => {
      const c = chars.find((x) => x.id === inp.dataset.cid);
      if (c) c.name = inp.value;
    });
  $("#clAdd")?.addEventListener("click", () => {
    sync();
    const id = "t" + Math.random().toString(36).slice(2, 9);
    chars.push({ id, name: `Twink ${chars.length}` });
    p.chars = chars;
    render();
    $(`#charRows input[data-cid="${id}"]`)?.select();
  });
  $$("[data-remove]", view).forEach((b) =>
    b.addEventListener("click", () => {
      sync();
      chars = chars.filter((c) => c.id !== b.dataset.remove);
      p.chars = chars;
      render();
    }),
  );
  $("#clSave")?.addEventListener("click", async (e) => {
    sync();
    const list = chars.map((c, i) => ({ id: c.id, name: c.name.trim() || (i ? `Twink ${i}` : "Main") }));
    e.target.disabled = true;
    try {
      await api("/checklist", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ player: p.player, chars: list }) });
      editChars = false;
      await refresh();
    } catch {
      notify("<b>Nicht gespeichert</b><div>Die Charaktere konnten nicht gespeichert werden.</div>");
      await refresh().catch(() => null);
    }
    render();
  });
}
