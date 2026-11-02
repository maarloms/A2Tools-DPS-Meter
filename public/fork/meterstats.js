// Fork: stats strip (total DPS, damage, boss HP and its stagger %) under the meter header and the
// companion figure and share beside each row's main figure. The main figure (.dpsNumber) is
// upstream's own: whatever the value menu has picked (DPS, damage, taken, HPS, healing, stagger),
// with the extra columns (.dpsExtra) after it. Here the row only adds the damage that goes with
// DPS (or the healing that goes with HPS) in front of it when no extra column is shown, and the
// share of the picked value after it. Only active with a fork theme (html.forkSkin); the upstream
// look is left alone. Hooked from core.js / meter.js via window.ForkMeter, so upstream files carry
// one-line "// fork" calls.
(() => {
  let app = null;
  let strip = null;
  let cells = null;
  let hp = { max: 0, pct: 0, stag: "" };
  // Sums over the rows, for the share of the value the rows show (rows()).
  let totals = { healAmount: 0, damageReceived: 0, stagger: 0 };

  const active = () => document.documentElement.classList.contains("forkSkin");
  const german = () => String(window.i18n?.getLanguage?.() || document.documentElement.lang || "").startsWith("de");
  const labels = () =>
    german()
      ? { dps: "DPS gesamt", dmg: "Schaden", hps: "HPS gesamt", heal: "Heilung", hp: "Boss-HP", players: "Spieler" }
      : { dps: "Total DPS", dmg: "Damage", hps: "Total HPS", heal: "Healing", hp: "Boss HP", players: "Players" };
  // Upstream's value menu: dps, totalDamage, damageReceived, hps, totalHeal, stagger.
  const healing = (core) => core?.displayMode === "hps" || core?.displayMode === "totalHeal";
  const sum = (rows, key) => rows.reduce((total, r) => total + (Number(r?.[key]) || 0), 0);
  // The boss HP bar is hidden under a fork theme, but upstream keeps filling its stagger label
  // ("STAG 42%", empty while the menu has it off): take the strip's from there.
  const staggerLabel = (core) => String(core?.elBossHpText?.querySelector?.(".bossHpStag")?.textContent ?? "").trim();
  // Upstream's footer menu "Party total" switch (showTotalDps) turns the strip's totals off.
  const totalsOn = (core) => core?.showTotalDps !== false;

  const ensureStrip = () => {
    if (strip) return strip;
    const anchor = document.querySelector(".meter .bossHpBar");
    if (!anchor) return null;
    strip = document.createElement("div");
    strip.className = "forkStats";
    strip.hidden = true;
    strip.innerHTML = ["dps", "dmg", "hp"]
      .map((k) => `<div class="forkStat" data-k="${k}"><b></b><small></small>${k === "hp" ? '<em class="forkStatStag"></em><i class="forkStatHp"><i></i></i>' : ""}</div>`)
      .join("");
    anchor.after(strip);
    cells = Object.fromEntries(
      [...strip.children].map((el) => [el.dataset.k, { value: el.querySelector("b"), label: el.querySelector("small"), el }])
    );
    return strip;
  };

  const set = (cell, value, label) => {
    if (cell.value.textContent !== value) cell.value.textContent = value;
    if (cell.label.textContent !== label) cell.label.textContent = label;
  };

  window.ForkMeter = {
    // Every dps-update: remember what the strip needs from the payload.
    payload(core, p) {
      app = core;
      const max = Number(p.targetMaxHp) || 0;
      if (max > 0) {
        const live = Number(p.targetCurrentHp);
        const remaining = Number.isFinite(live) && live >= 0
          ? Math.min(max, Math.max(0, live))
          : Math.max(0, max - Math.max(0, Number(p.targetTotalDamage) || 0));
        hp = { max, pct: (remaining / max) * 100, stag: staggerLabel(core) };
      } else {
        hp = { max: 0, pct: 0, stag: "" };
      }
    },

    // Every render of the row list.
    rows(core, rows) {
      app = core;
      // Before the strip check: rowText's shares need them either way.
      const list = Array.isArray(rows) ? rows : [];
      totals = { healAmount: sum(list, "healAmount"), damageReceived: sum(list, "damageReceived"), stagger: sum(list, "stagger") };
      if (!ensureStrip()) return;
      // Without the totals the strip is only worth showing for a boss's HP.
      const totalsShown = totalsOn(core);
      const show = active() && list.length > 0 && (totalsShown || hp.max > 0);
      if (strip.hidden === show) strip.hidden = !show;
      if (!show) return;
      strip.classList.toggle("noTotals", !totalsShown);
      const L = labels();
      if (healing(core)) {
        set(cells.dps, core.formatDpsThousands(sum(rows, "hps")), L.hps);
        set(cells.dmg, core.formatAbbreviatedNumber(totals.healAmount), L.heal);
      } else {
        set(cells.dps, core.formatDpsThousands(sum(rows, "dps")), L.dps);
        set(cells.dmg, core.formatAbbreviatedNumber(sum(rows, "totalDamage")), L.dmg);
      }
      if (hp.max > 0) {
        set(cells.hp, `${Math.round(hp.pct)} %`, L.hp);
        cells.hp.el.classList.add("hasHp");
        cells.hp.el.classList.toggle("isMid", hp.pct > 25 && hp.pct <= 50);
        cells.hp.el.classList.toggle("isLow", hp.pct <= 25);
        cells.hp.el.querySelector(".forkStatHp > i").style.width = `${hp.pct.toFixed(1)}%`;
        const stag = cells.hp.el.querySelector(".forkStatStag");
        if (stag.textContent !== hp.stag) stag.textContent = hp.stag;
      } else {
        set(cells.hp, String(rows.length), L.players);
        cells.hp.el.classList.remove("hasHp", "isMid", "isLow");
      }
    },

    // Per row: null outside the fork skin, so meter.js keeps upstream's text. Otherwise
    //   total: the figure in front of the main one (damage beside DPS, healing beside HPS),
    //          empty when an extra column is on or the main value has no such partner;
    //   share: the row's share of the picked value (of the damage for DPS and damage).
    // No `dps` key: the main figure stays upstream's (value menu, data-metric colour).
    rowText(row) {
      if (!app || !active()) return null;
      const mode = app.displayMode;
      const hasExtras = Array.isArray(app.extraMetrics) && app.extraMetrics.length > 0;
      const num = (key) => Number(row?.[key]) || 0;
      const abbr = (v) => app.formatAbbreviatedNumber(v);
      const pct = (v, all) => `${(all > 0 ? (v / all) * 100 : 0).toFixed(1)}%`;
      if (mode === "hps" || mode === "totalHeal") {
        return { total: mode === "hps" && !hasExtras ? abbr(num("healAmount")) : "", share: pct(num("healAmount"), totals.healAmount) };
      }
      if (mode === "damageReceived") return { total: "", share: pct(num("damageReceived"), totals.damageReceived) };
      if (mode === "stagger") return { total: "", share: pct(num("stagger"), totals.stagger) };
      const share = Number(row?.damageContribution);
      return {
        total: mode !== "totalDamage" && !hasExtras ? abbr(num("totalDamage")) : "",
        share: Number.isFinite(share) ? `${share.toFixed(1)}%` : undefined,
      };
    },
  };
})();
