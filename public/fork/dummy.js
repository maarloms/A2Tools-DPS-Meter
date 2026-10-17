// Fork: training-dummy test ("Puppen-Test") in the meter window.
// Header button (target icon) opens a popup: pick 60 s / 3 min / 5 min,
// "Starten" arms the backend recorder (src-tauri/src/fork/dummy.rs), the
// first own hit starts the countdown, the end comes by itself. The result
// (dummy = target with the most damage) is compared with the best and the
// previous run of the same character and duration and kept in localStorage
// (fork.dummy.v1, 50 runs per character and duration). Nothing goes online.
// Numbers and history: public/fork/dummy-logic.js.
(() => {
  if (window.ForkDummy || window.A2_VIEW !== "main") return;
  const L = window.ForkDummyLogic;
  const tauri = window.__TAURI__;
  if (!L || !tauri?.core?.invoke) return;
  const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
  const bridge = () => window.javaBridge;
  const DURATION_KEY = "fork.dummy.duration";
  const SEEN_KEY = "fork.dummy.seen"; // last result taken over; a deleted run does not come back
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();

  let durationS = Number(storage?.getItem(DURATION_KEY)) || 60;
  if (!L.DURATIONS.includes(durationS)) durationS = 60;
  let status = { phase: "idle" };
  let clockOffset = 0; // backend clock minus Date.now()
  let pollTimer = 0;
  let tickTimer = 0;
  let button = null;
  let buttonTime = null;
  let panel = null; // { root, body, actions, sub, close }
  let view = { kind: "home" }; // home | run (a stored run by key+id)
  let viewChar = null;
  let unlockedForPanel = false;

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  const backendNow = () => Date.now() + clockOffset;
  const active = () => status.phase === "armed" || status.phase === "running";

  // ---------------------------------------------------------- backend polling

  async function poll() {
    try {
      const s = await invoke("fork_dummy_status");
      if (s && typeof s === "object") {
        clockOffset = Number(s.now) - Date.now() || 0;
        const wasActive = active();
        status = s;
        if (s.phase === "done" && s.result) onResult(s.result, wasActive);
      }
    } catch (e) {
      console.warn("[Puppen-Test] status:", e);
    }
    schedule();
    // Rebuild only when something changed: a rebuilt button loses the click
    // that was just under way.
    const sig = `${status.phase}|${status.hasLocal}|${status.durationMs}|${status.result?.id ?? ""}|${!!panel}`;
    if (sig !== lastSig) render();
    else renderClock();
  }

  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = 0;
    if (active()) pollTimer = setTimeout(poll, 250);
    else if (panel) pollTimer = setTimeout(poll, 2000);
    clearInterval(tickTimer);
    tickTimer = status.phase === "running" ? setInterval(renderClock, 200) : 0;
  }

  function onResult(result, justFinished) {
    if (String(result.id) === storage?.getItem(SEEN_KEY)) return;
    storage?.setItem(SEEN_KEY, String(result.id));
    let store = L.load(storage);
    const run = L.summarize(result, { targetName: targetName(L.pickTarget(result)?.targetId) });
    if (!run) {
      if (justFinished) openPanel();
      return;
    }
    store = L.addRun(store, run);
    L.save(storage, store);
    view = { kind: "run", key: L.keyOf(run), id: run.id, fresh: true };
    viewChar = run.char;
    if (justFinished || panel) openPanel();
  }

  // The dummy's name from the meter's (cached) details context, if it has one.
  function targetName(id) {
    try {
      const raw = window.dpsData?.getDetailsContext?.();
      const ctx = typeof raw === "string" ? JSON.parse(raw) : raw;
      const t = (ctx?.targets || []).find((x) => Number(x.targetId) === Number(id));
      return t?.targetName || "";
    } catch {
      return "";
    }
  }

  async function start() {
    try {
      storage?.setItem(DURATION_KEY, String(durationS));
      await invoke("fork_dummy_start", { durationS });
      view = { kind: "home" };
    } catch (e) {
      console.warn("[Puppen-Test] start:", e);
    }
    poll();
  }

  async function cancel() {
    try { await invoke("fork_dummy_cancel"); } catch (e) { console.warn("[Puppen-Test] cancel:", e); }
    poll();
  }

  // ---------------------------------------------------------------- button

  function setupButton() {
    const header = document.querySelector(".headerBtns");
    if (!header) return;
    button = el("div", "headerBtn forkDummyBtn");
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("aria-label", "Puppen-Test öffnen");
    button.title = "Puppen-Test (Trainingspuppe)";
    button.innerHTML = '<i data-lucide="target"></i>';
    buttonTime = el("span", "forkDummyBtnTime");
    buttonTime.hidden = true;
    button.append(buttonTime);
    const timer = header.querySelector(".timerBtn");
    if (timer) timer.after(button);
    else header.prepend(button);
    const toggle = () => (panel ? panel.close() : openPanel());
    button.addEventListener("click", toggle);
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    window.lucide?.createIcons?.();
  }

  function renderButton() {
    if (!button) return;
    button.classList.toggle("isArmed", status.phase === "armed");
    button.classList.toggle("isRunning", status.phase === "running");
    let text = "";
    if (status.phase === "armed") text = "bereit";
    else if (status.phase === "running") text = L.fmtClock(Number(status.endTs) - backendNow());
    buttonTime.hidden = !text;
    if (buttonTime.textContent !== text) buttonTime.textContent = text;
  }

  // ---------------------------------------------------------------- panel

  const lockedOverlay = () => document.body.classList.contains("overlayLocked");

  function openPanel() {
    if (panel) { render(); return; }
    // Reuses the patch-notes frame: tauriBridge.js grows the window for it.
    const root = el("div", "forkPatchnotes forkDummy");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "forkDummyTitle");
    const card = el("div", "forkPatchnotesCard");
    const head = el("div", "forkPatchnotesHead");
    const titles = el("div", "forkPatchnotesTitles");
    const h = el("div", "forkPatchnotesTitle", "Puppen-Test");
    h.id = "forkDummyTitle";
    const sub = el("div", "forkPatchnotesSub");
    titles.append(h, sub);
    const x = el("button", "forkPatchnotesClose", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Schließen");
    head.append(titles, x);
    const body = el("div", "forkPatchnotesBody forkDummyBody");
    const actions = el("div", "forkPatchnotesActions");
    card.append(head, body, actions);
    root.append(card);

    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    function close() {
      if (panel?.root !== root) return;
      panel = null;
      root.remove();
      document.removeEventListener("keydown", onKey, true);
      if (unlockedForPanel && lockedOverlay()) invoke("set_overlay_locked", { locked: true }).catch(() => {});
      unlockedForPanel = false;
      bridge()?.updateOverlaySize?.();
      if (view.fresh) view = { kind: "home" };
      schedule();
    }
    x.addEventListener("click", close);
    document.body.appendChild(root);
    document.addEventListener("keydown", onKey, true);
    if (lockedOverlay()) {
      unlockedForPanel = true;
      invoke("set_overlay_locked", { locked: false }).catch(() => {});
    }
    panel = { root, body, actions, sub, close };
    bridge()?.updateOverlaySize?.();
    requestAnimationFrame(() => root.classList.add("isOpen"));
    render();
    poll();
  }

  function button_(label, primary, onClick) {
    const b = el("button", "forkPatchnotesButton" + (primary ? " isPrimary" : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  let clockEls = null;
  function renderClock() {
    renderButton();
    if (!clockEls || status.phase !== "running") return;
    const left = Number(status.endTs) - backendNow();
    clockEls.time.textContent = L.fmtClock(left);
    const total = Number(status.durationMs) || 1;
    clockEls.fill.style.width = `${Math.min(100, Math.max(0, (1 - left / total) * 100))}%`;
    const elapsed = Math.min(total, Math.max(1, backendNow() - Number(status.startTs)));
    clockEls.live.textContent = `${L.fmtCompact(status.damage)} Schaden · ${L.fmtInt((Number(status.damage) || 0) / (elapsed / 1000))} DPS`;
  }

  let lastSig = "";
  function render() {
    lastSig = `${status.phase}|${status.hasLocal}|${status.durationMs}|${status.result?.id ?? ""}|${!!panel}`;
    renderButton();
    if (!panel) return;
    const { body, actions, sub } = panel;
    body.replaceChildren();
    actions.replaceChildren();
    clockEls = null;

    if (status.phase === "armed" || status.phase === "running") {
      sub.textContent = `${L.fmtDuration(Math.round((Number(status.durationMs) || 0) / 1000))} · nur dein Charakter`;
      const box = el("div", "forkDummyLive");
      if (status.phase === "armed") {
        box.append(el("div", "forkDummyState", "Bereit – startet beim ersten Treffer"));
        box.append(el("p", "forkDummyHint", "Greif die Trainingspuppe an. Gezählt wird nur das Ziel, auf das du am meisten Schaden machst."));
      } else {
        const time = el("div", "forkDummyClock");
        const bar = el("div", "forkPatchnotesBar forkDummyBar");
        const fill = el("span");
        bar.append(fill);
        const live = el("div", "forkDummyLiveDmg");
        box.append(time, bar, live);
        clockEls = { time, fill, live };
      }
      if (status.hasLocal === false) {
        box.append(el("p", "forkDummyWarn", "Dein Charakter ist noch nicht erkannt – Treffer zählen erst, wenn der Meter weiß, wer du bist."));
      }
      body.append(box);
      actions.append(button_("Abbrechen", false, cancel));
      renderClock();
      return;
    }

    const store = L.load(storage);
    if (view.kind === "run") {
      const run = L.runsFor(store, view.key).find((r) => r.id === view.id);
      if (run) {
        renderRun(body, sub, store, run);
        actions.append(
          button_("Verlauf", false, () => { view = { kind: "home" }; render(); }),
          button_("Neuer Test", true, start),
        );
        return;
      }
      view = { kind: "home" };
    }
    renderHome(body, sub, store);
    actions.append(button_("Starten", true, start));
  }

  function durationPicker() {
    const row = el("div", "forkDummyDurations");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "Dauer");
    for (const d of L.DURATIONS) {
      const b = el("button", "forkDummyDuration" + (d === durationS ? " isActive" : ""), L.fmtDuration(d));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(d === durationS));
      b.addEventListener("click", () => {
        durationS = d;
        storage?.setItem(DURATION_KEY, String(d));
        render();
      });
      row.append(b);
    }
    return row;
  }

  // Characters with runs of the chosen duration, newest run first.
  function charsFor(store) {
    const latest = new Map();
    for (const [key, list] of Object.entries(store.runs)) {
      const last = list[list.length - 1];
      if (!last || Number(last.durationS) !== durationS) continue;
      const prev = latest.get(last.char);
      if (!prev || last.at > prev.at) latest.set(last.char, { at: last.at, key });
    }
    return [...latest.entries()].sort((a, b) => b[1].at - a[1].at).map(([char, v]) => ({ char, key: v.key }));
  }

  function renderHome(body, sub, store) {
    sub.textContent = "Nur dein Charakter · ein Ziel · erster Treffer bis Ende";
    if (status.phase === "idle" && status.hasLocal === false) {
      body.append(el("p", "forkDummyWarn", "Dein Charakter ist noch nicht erkannt. Einmal teleportieren hilft meist."));
    }
    body.append(el("div", "forkDummyLabel", "Dauer"), durationPicker());
    const chars = charsFor(store);
    if (!chars.length) {
      body.append(el("p", "forkDummyHint", "Noch keine Läufe mit dieser Dauer. Starten, dann die Trainingspuppe angreifen – der Countdown beginnt mit deinem ersten Treffer."));
      return;
    }
    let pick = chars.find((c) => c.char === viewChar) || chars[0];
    if (chars.length > 1) {
      const select = el("select", "forkDummySelect");
      select.setAttribute("aria-label", "Charakter");
      for (const c of chars) {
        const o = el("option", "", c.char || "Unbekannt");
        o.value = c.key;
        if (c === pick) o.selected = true;
        select.append(o);
      }
      select.addEventListener("change", () => {
        pick = chars.find((c) => c.key === select.value) || pick;
        viewChar = pick.char;
        render();
      });
      body.append(select);
    }
    renderHistory(body, store, pick.key, null);
  }

  function stat(label, value, extra) {
    const s = el("div", "forkDummyStat");
    s.append(el("b", "", value), el("small", "", label));
    if (extra) s.append(extra);
    return s;
  }

  function delta(text, v) {
    const d = el("span", "forkDummyDelta" + (v > 0.05 ? " isUp" : v < -0.05 ? " isDown" : ""), text);
    return d;
  }

  function renderRun(body, sub, store, run) {
    const date = new Date(run.at);
    const who = [run.char || "Unbekannt", L.className(run.class)].filter(Boolean).join(" · ");
    sub.textContent = `${who} · ${L.fmtDuration(run.durationS)} · ${date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`;
    const runs = L.runsFor(store, L.keyOf(run));
    const cmp = L.compare(runs, run);

    const top = el("div", "forkDummyHero");
    top.append(el("div", "forkDummyDps", L.fmtInt(run.dps)), el("div", "forkDummyDpsLabel", "DPS"));
    const cmpRow = el("div", "forkDummyCompare");
    if (cmp.best) {
      cmpRow.append(delta(cmp.isBest ? `Neuer Bestwert (${L.fmtDelta(cmp.best.deltaPct)})` : `${L.fmtDelta(cmp.best.deltaPct)} zum Bestwert`, cmp.best.deltaPct));
    } else {
      cmpRow.append(el("span", "forkDummyDelta", "Erster Lauf mit dieser Dauer"));
    }
    if (cmp.last) cmpRow.append(delta(`${L.fmtDelta(cmp.last.deltaPct)} zum letzten Lauf`, cmp.last.deltaPct));
    top.append(cmpRow);
    body.append(top);

    const grid = el("div", "forkDummyStats");
    grid.append(stat("Gesamtschaden", L.fmtCompact(run.dmg)), stat("Krit-Rate", L.fmtPct(run.critPct)));
    if (run.hasMulti) grid.append(stat("Mehrfachtreffer", L.fmtPct(run.multiPct)));
    grid.append(stat("Rückenangriff", L.fmtPct(run.backPct)), stat("Treffer", L.fmtInt(run.hits)));
    if (run.gearScore) grid.append(stat("Ausrüstung", L.fmtInt(run.gearScore)));
    if (run.combatPower) grid.append(stat("Kampfkraft", L.fmtInt(run.combatPower)));
    body.append(grid);
    const notes = [];
    if (run.targetName) notes.push(`Ziel: ${run.targetName}`);
    if (run.otherDmg > 0) notes.push(`${L.fmtCompact(run.otherDmg)} Schaden auf andere Ziele nicht gezählt`);
    if (notes.length) body.append(el("p", "forkDummyHint", notes.join(" · ")));

    body.append(el("div", "forkDummyLabel", "Skills"));
    const table = el("div", "forkDummySkills");
    for (const s of run.skills) {
      const row = el("div", "forkDummySkill" + (s.other ? " isOther" : ""));
      const bar = el("i", "forkDummySkillBar");
      bar.style.width = `${Math.min(100, Math.max(0, s.pct))}%`;
      row.append(bar, el("span", "forkDummySkillName", s.name), el("span", "forkDummySkillPct", L.fmtPct(s.pct)),
        el("span", "forkDummySkillHits", `${L.fmtInt(s.hits)}×`));
      row.title = `${L.fmtInt(s.dmg)} Schaden`;
      table.append(row);
    }
    body.append(table);
    renderHistory(body, store, L.keyOf(run), run.id);
  }

  function renderHistory(body, store, key, currentId) {
    const runs = L.runsFor(store, key);
    if (!runs.length) return;
    body.append(el("div", "forkDummyLabel", `Verlauf (${runs.length})`));
    if (runs.length > 1) {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "forkDummySpark");
      svg.setAttribute("viewBox", "0 0 300 40");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-label", "DPS-Verlauf");
      const line = document.createElementNS(NS, "polyline");
      line.setAttribute("points", L.sparkPoints(runs.map((r) => r.dps), 300, 40, 3));
      svg.append(line);
      body.append(svg);
    }
    const best = Math.max(...runs.map((r) => Number(r.dps) || 0));
    const list = el("div", "forkDummyHistory");
    for (const r of [...runs].reverse()) {
      const row = el("div", "forkDummyRun" + (r.id === currentId ? " isCurrent" : ""));
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      const when = new Date(r.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      row.append(el("span", "forkDummyRunWhen", when), el("b", "forkDummyRunDps", `${L.fmtInt(r.dps)} DPS`));
      row.append(el("span", "forkDummyRunMeta", r.dps === best ? "Bestwert" : r.gearScore ? `GS ${L.fmtInt(r.gearScore)}` : ""));
      const del = el("button", "forkDummyRunDel", "×");
      del.type = "button";
      del.title = "Lauf löschen";
      del.setAttribute("aria-label", `Lauf vom ${when} löschen`);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        L.save(storage, L.removeRun(L.load(storage), key, r.id));
        if (view.kind === "run" && view.id === r.id) view = { kind: "home" };
        render();
      });
      row.append(del);
      const show = () => { view = { kind: "run", key, id: r.id }; viewChar = r.char; render(); };
      row.addEventListener("click", show);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); }
      });
      list.append(row);
    }
    body.append(list);
  }

  window.ForkDummy = { open: openPanel, start, cancel, poll };

  function setup() {
    setupButton();
    poll(); // a test may be running from before a reload
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
