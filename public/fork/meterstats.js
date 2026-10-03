// Fork: stats strip (total DPS, damage, boss HP) under the meter header and the damage · DPS · share
// readout on each row. Only active with a fork theme (html.forkSkin); the
// upstream look is left alone. Hooked from core.js / meter.js via
// window.ForkMeter, so upstream files carry one-line "// fork" calls.
(() => {
  let app = null;
  let strip = null;
  let cells = null;
  let hp = { max: 0, pct: 0 };

  const active = () => document.documentElement.classList.contains("forkSkin");
  const german = () => String(window.i18n?.getLanguage?.() || document.documentElement.lang || "").startsWith("de");
  const labels = () =>
    german()
      ? { dps: "DPS gesamt", dmg: "Schaden", hp: "Boss-HP", players: "Spieler" }
      : { dps: "Total DPS", dmg: "Damage", hp: "Boss HP", players: "Players" };


  const ensureStrip = () => {
    if (strip) return strip;
    const anchor = document.querySelector(".meter .bossHpBar");
    if (!anchor) return null;
    strip = document.createElement("div");
    strip.className = "forkStats";
    strip.hidden = true;
    strip.innerHTML = ["dps", "dmg", "hp"]
      .map((k) => `<div class="forkStat" data-k="${k}"><b></b><small></small>${k === "hp" ? '<i class="forkStatHp"><i></i></i>' : ""}</div>`)
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
        hp = { max, pct: (remaining / max) * 100 };
      } else {
        hp = { max: 0, pct: 0 };
      }
    },

    // Every render of the row list.
    rows(core, rows) {
      app = core;
      if (!ensureStrip()) return;
      const show = active() && Array.isArray(rows) && rows.length > 0;
      if (strip.hidden === show) strip.hidden = !show;
      if (!show) return;
      const L = labels();
      const totalDps = rows.reduce((sum, r) => sum + (Number(r?.dps) || 0), 0);
      const totalDmg = rows.reduce((sum, r) => sum + (Number(r?.totalDamage) || 0), 0);
      set(cells.dps, core.formatDpsThousands(totalDps), L.dps);
      set(cells.dmg, core.formatAbbreviatedNumber(totalDmg), L.dmg);
      if (hp.max > 0) {
        set(cells.hp, `${Math.round(hp.pct)} %`, L.hp);
        cells.hp.el.classList.add("hasHp");
        cells.hp.el.classList.toggle("isMid", hp.pct > 25 && hp.pct <= 50);
        cells.hp.el.classList.toggle("isLow", hp.pct <= 25);
        cells.hp.el.querySelector(".forkStatHp > i").style.width = `${hp.pct.toFixed(1)}%`;
      } else {
        set(cells.hp, String(rows.length), L.players);
        cells.hp.el.classList.remove("hasHp", "isMid", "isLow");
      }
    },

    // Per row: null outside the fork skin, so meter.js keeps upstream's text.
    rowText(row) {
      if (!app || !active()) return null;
      const share = Number(row?.damageContribution);
      return {
        total: app.formatAbbreviatedNumber(Number(row?.totalDamage) || 0),
        dps: `${app.formatDpsThousands(Number(row?.dps) || 0)}${window.i18n?.t?.("meter.dpsSuffix", "/s") ?? "/s"}`,
        share: Number.isFinite(share) ? `${share.toFixed(1)}%` : undefined,
      };
    },
  };
})();
