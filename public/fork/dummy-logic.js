// Fork: the training-dummy test's numbers and history ("Puppen-Test").
// Pure functions, no DOM: public/fork/dummy.js shows them, the backend
// (src-tauri/src/fork/dummy.rs) records the hits. Tested in
// tests/dummy-logic.test.mjs.
(() => {
  const root = typeof window !== "undefined" ? window : globalThis;
  if (root.ForkDummyLogic) return;

  const STORE_KEY = "fork.dummy.v1";
  const MAX_RUNS = 50;
  const TOP_SKILLS = 8;
  const DURATIONS = [60, 180, 300];

  const CLASS_DE = {
    Gladiator: "Gladiator", Templar: "Templer", Ranger: "Jäger", Assassin: "Assassine",
    Sorcerer: "Zauberer", Cleric: "Kleriker", Elementalist: "Beschwörer", Chanter: "Kantor",
    Fighter: "Faustkämpfer",
  };

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

  // The dummy is the target you did the most damage to; the rest is ignored.
  function pickTarget(result) {
    const targets = Array.isArray(result?.targets) ? result.targets : [];
    let best = null;
    for (const t of targets) {
      if (num(t?.dmg) <= 0) continue;
      if (!best || num(t.dmg) > num(best.dmg) || (num(t.dmg) === num(best.dmg) && num(t.targetId) < num(best.targetId))) best = t;
    }
    return best;
  }

  // One finished run as the history keeps it.
  function summarize(result, { targetName = "" } = {}) {
    const target = pickTarget(result);
    if (!target) return null;
    const durationMs = num(result.durationMs);
    const skills = Array.isArray(target.skills) ? target.skills : [];
    const direct = skills.filter((s) => !s?.dot);
    const hitsDirect = direct.reduce((a, s) => a + num(s.hits), 0);
    const sum = (key) => direct.reduce((a, s) => a + num(s[key]), 0);
    const dmg = num(target.dmg);
    const others = (result.targets || []).filter((t) => t !== target).reduce((a, t) => a + num(t?.dmg), 0);
    const sorted = [...skills].sort((a, b) => num(b.dmg) - num(a.dmg));
    const top = sorted.slice(0, TOP_SKILLS).map((s) => ({
      name: String(s.name || `#${s.code}`),
      code: num(s.code),
      dot: !!s.dot,
      dmg: num(s.dmg),
      hits: num(s.hits),
      pct: Math.round(pct(num(s.dmg), dmg) * 10) / 10,
    }));
    const rest = sorted.slice(TOP_SKILLS);
    if (rest.length) {
      const restDmg = rest.reduce((a, s) => a + num(s.dmg), 0);
      top.push({ name: "Sonstige", code: 0, dot: false, dmg: restDmg, hits: rest.reduce((a, s) => a + num(s.hits), 0),
        pct: Math.round(pct(restDmg, dmg) * 10) / 10, other: true });
    }
    const p = result.profile || {};
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      id: num(result.id || result.startTs),
      at: num(result.startTs),
      durationS: Math.round(durationMs / 1000),
      char: String(p.name || "").trim(),
      serverId: num(p.serverId),
      class: p.class || null,
      level: p.level ?? null,
      gearScore: p.gearScore ?? null,
      combatPower: p.combatPower ?? null,
      targetId: num(target.targetId),
      targetName: String(targetName || ""),
      dmg,
      dps: durationMs > 0 ? Math.round(dmg / (durationMs / 1000)) : 0,
      hits: num(target.hits),
      critPct: r1(pct(sum("crit"), hitsDirect)),
      multiPct: r1(pct(sum("multi"), hitsDirect)),
      backPct: r1(pct(sum("back"), hitsDirect)),
      hasMulti: sum("multi") > 0,
      otherDmg: others,
      skills: top,
    };
  }

  // Runs are kept per character (and server) and duration.
  const historyKey = (char, serverId, durationS) =>
    `${String(char || "").trim() || "?"}@${num(serverId)}|${num(durationS)}`;
  const keyOf = (run) => historyKey(run?.char, run?.serverId, run?.durationS);

  function emptyStore() {
    return { v: 1, runs: {} };
  }

  function load(storage) {
    try {
      const raw = storage?.getItem?.(STORE_KEY);
      if (!raw) return emptyStore();
      const s = JSON.parse(raw);
      if (s?.v !== 1 || typeof s.runs !== "object" || !s.runs) return emptyStore();
      for (const k of Object.keys(s.runs)) if (!Array.isArray(s.runs[k])) delete s.runs[k];
      return s;
    } catch {
      return emptyStore();
    }
  }

  function save(storage, store) {
    try {
      storage?.setItem?.(STORE_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }

  // Adds a run (once, by id), oldest first; keeps the newest `max`.
  function addRun(store, run, max = MAX_RUNS) {
    const next = { v: 1, runs: { ...(store?.runs || {}) } };
    if (!run) return next;
    const key = keyOf(run);
    const list = (next.runs[key] || []).filter((r) => r.id !== run.id);
    list.push(run);
    list.sort((a, b) => num(a.at) - num(b.at));
    next.runs[key] = list.slice(-max);
    return next;
  }

  function removeRun(store, key, id) {
    const next = { v: 1, runs: { ...(store?.runs || {}) } };
    const list = (next.runs[key] || []).filter((r) => r.id !== id);
    if (list.length) next.runs[key] = list;
    else delete next.runs[key];
    return next;
  }

  const runsFor = (store, key) => (store?.runs?.[key] || []).slice();

  // Against the best and the previous run of the same key, without `run` itself.
  function compare(runs, run) {
    const others = (runs || []).filter((r) => r && r.id !== run?.id);
    const delta = (ref) => (ref && num(ref.dps) > 0 ? ((num(run.dps) - num(ref.dps)) / num(ref.dps)) * 100 : null);
    const earlier = others.filter((r) => num(r.at) < num(run?.at));
    const last = earlier.length ? earlier[earlier.length - 1] : null;
    let best = null;
    for (const r of others) if (!best || num(r.dps) > num(best.dps)) best = r;
    return {
      best: best ? { dps: num(best.dps), at: best.at, deltaPct: delta(best) } : null,
      last: last ? { dps: num(last.dps), at: last.at, deltaPct: delta(last) } : null,
      isBest: !best || num(run?.dps) > num(best.dps),
    };
  }

  // German number formats.
  const fmtInt = (v) => Math.round(num(v)).toLocaleString("de-DE");
  const fmtPct = (v) => `${num(v).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  function fmtDelta(v) {
    if (v == null || !Number.isFinite(v)) return "";
    const r = Math.round(v * 10) / 10;
    const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
    return `${sign}${Math.abs(r).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  }
  function fmtCompact(v) {
    const n = num(v);
    const a = Math.abs(n);
    const f = (x, d) => x.toLocaleString("de-DE", { maximumFractionDigits: d });
    if (a >= 1e9) return `${f(n / 1e9, 2)} Mrd.`;
    if (a >= 1e6) return `${f(n / 1e6, 2)} Mio.`;
    if (a >= 1e4) return `${f(n / 1e3, 1)} Tsd.`;
    return fmtInt(n);
  }
  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(num(ms) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  const fmtDuration = (s) => (num(s) > 60 && num(s) % 60 === 0 ? `${num(s) / 60} min` : `${num(s)} s`);
  const className = (c) => CLASS_DE[c] || "";

  // Polyline points for a sparkline of `values` in a w×h box.
  function sparkPoints(values, w, h, pad = 2) {
    const v = (values || []).map(num);
    if (!v.length) return "";
    const min = Math.min(...v);
    const max = Math.max(...v);
    const span = max - min || 1;
    const step = v.length > 1 ? (w - 2 * pad) / (v.length - 1) : 0;
    return v
      .map((x, i) => {
        const px = v.length > 1 ? pad + i * step : w / 2;
        const py = max === min ? h / 2 : pad + (1 - (x - min) / span) * (h - 2 * pad);
        return `${Math.round(px * 10) / 10},${Math.round(py * 10) / 10}`;
      })
      .join(" ");
  }

  root.ForkDummyLogic = {
    STORE_KEY, MAX_RUNS, DURATIONS,
    pickTarget, summarize, historyKey, keyOf, emptyStore, load, save, addRun, removeRun, runsFor, compare,
    fmtInt, fmtPct, fmtDelta, fmtCompact, fmtClock, fmtDuration, className, sparkPoints,
  };
})();
