// Fork themes (maarloms/A2Tools-DPS-Meter). Styles live in fork/themes.css
// and fork/skin.css. Loaded before core.js: core.js appends the ids to its
// theme list and calls ForkThemes.renderSettings() from its dropdown setup.
window.FORK_THEMES = [
  { id: "atreia", label: "Atreia Gold" },
  { id: "glass", label: "Glas" },
  { id: "neon", label: "Neon" },
  { id: "abyss", label: "Abyss" },
];

(() => {
  const root = document.documentElement;
  const ids = new Set(window.FORK_THEMES.map((t) => t.id));
  const LAST_UPSTREAM_KEY = "fork.lastUpstreamTheme";

  // The mockup skin (fork/skin.css) only applies to fork themes; upstream
  // themes keep upstream's look. core.js sets data-theme, this mirrors it.
  const sync = () => root.classList.toggle("forkSkin", ids.has(root.dataset.theme));
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  sync();

  const isGerman = () => (root.lang || "").toLowerCase().startsWith("de");
  const text = (de, en) => (isGerman() ? de : en);

  // Own row under upstream's "Theme" row, so fork themes are not mixed into
  // upstream's list. Built here instead of in index.html to keep merges clean.
  function ensureRow(themeBtn) {
    let row = document.querySelector(".forkThemeRow");
    if (row) return row;
    const themeRow = themeBtn?.closest(".settingsRow");
    if (!themeRow) return null;
    row = document.createElement("div");
    row.className = "settingsRow settingsRowSelect forkThemeRow";
    row.innerHTML = `
      <div class="settingsInfo"><div class="settingsLabel forkThemeLabel"></div></div>
      <div class="settingsDropdownWrapper themeDropdownWrapper">
        <button class="settingsDropdownBtn themeDropdownBtn forkThemeDropdownBtn" type="button">
          <span class="settingsDropdownText">-</span>
          <span class="settingsDropdownCaret" aria-hidden="true">▾</span>
        </button>
        <div class="settingsDropdownMenu themeDropdownMenu forkThemeDropdownMenu" role="menu"></div>
      </div>`;
    themeRow.after(row);
    return row;
  }

  const paint = (el, colors) => {
    el.style.background = colors.rowFill;
    el.style.opacity = "1";
    el.style.color = colors.textColor;
    el.style.textShadow = colors.nameShadow;
  };

  function renderSettings(app, setupDropdown, previewThemeVars) {
    const row = ensureRow(app.themeDropdownBtn);
    if (!row) return;
    row.querySelector(".forkThemeLabel").textContent = text("Eigene Themes", "Custom themes");

    const current = app.theme;
    const forkActive = ids.has(current);
    if (!forkActive && current) app.safeSetSetting?.(LAST_UPSTREAM_KEY, current);

    const options = [
      { value: "off", label: text("Aus", "Off") },
      ...window.FORK_THEMES.map((t) => ({ value: t.id, label: t.label })),
    ];

    setupDropdown(
      row.querySelector(".forkThemeDropdownBtn"),
      row.querySelector(".forkThemeDropdownMenu"),
      options,
      forkActive ? current : "off",
      (value) => {
        const next = value === "off" ? app.safeGetSetting?.(LAST_UPSTREAM_KEY) || "aion2" : value;
        app.settingsSelections.theme = next;
        app.applyTheme(next, { persist: true });
      },
      {
        decorateItem: (item, value) => {
          if (value !== "off") paint(item, previewThemeVars(value));
        },
        decorateButton: (button, value) => {
          if (value !== "off") paint(button, previewThemeVars(value));
          else button.style.textShadow = "";
        },
      }
    );

    // With a fork theme active, upstream's dropdown would fall back to showing
    // (and painting) its first entry; show it as unselected instead.
    if (forkActive && app.themeDropdownBtn) {
      const btn = app.themeDropdownBtn;
      btn.style.background = "";
      btn.style.color = "";
      btn.style.textShadow = "";
      const label = btn.querySelector(".settingsDropdownText");
      if (label) {
        label.textContent = "–";
        label.style.textShadow = "";
      }
      app.themeDropdownMenu?.querySelectorAll(".isActive").forEach((el) => el.classList.remove("isActive"));
    }
  }

  window.ForkThemes = { renderSettings };
})();
