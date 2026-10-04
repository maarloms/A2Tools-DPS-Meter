// Bosse verwalten: welche zählen in Kampfliste, Statistik und Rekorden?
// Automatisch nach Max-HP (Quest-Minibosse fallen raus), je Boss fest ein- oder ausblendbar.

import { $$, ago, api, apiJson, esc, failed, fmtNum, fmtShort, loading, pageHead, state, view } from "./core.js";

let data = null;

export async function loadBossesPage() {
  view.innerHTML = loading("Bosse");
  try {
    data = await apiJson("/boss-settings");
    render();
  } catch (e) {
    failed(e, "Die Bossliste");
  }
}

const MODES = [
  ["auto", "Auto"],
  ["show", "Zeigen"],
  ["hide", "Aus"],
];

function render() {
  const row = (b) => {
    const mode = b.mode ?? "auto";
    return `<tr class="${b.hidden ? "dim" : ""}"><td><b>${esc(b.boss)}</b>${b.hidden ? ' <span class="badge">ausgeblendet</span>' : ""}</td>
      <td class="num">${fmtShort(b.maxHp)}</td><td class="num">${fmtNum(b.fights)}</td>
      <td class="num">${b.lastMs ? ago(b.lastMs) : "–"}</td>
      <td class="num"><div class="seg" role="group" aria-label="${esc(b.boss)}">${MODES.map(
        ([m, label]) => `<button type="button" data-mob="${b.mobCode}" data-mode="${m}" class="${m === mode ? "on" : ""}" aria-pressed="${m === mode}">${label}</button>`,
      ).join("")}</div></td></tr>`;
  };
  const list = data.bosses || [];
  view.innerHTML = `<div class="page">
    ${pageHead("Bosse", "Welche Bosse in Kämpfen, Übersicht, Vergleich und Rekorden zählen")}
    <section class="card">
      <p class="muted"><b>Auto</b>: Bosse ab ${fmtShort(data.minHp)} HP zählen (Dungeon-, Feld- und Event-Bosse), kleinere wie Quest-Minibosse
        werden ausgeblendet. Mit <b>Zeigen</b> oder <b>Aus</b> legst du einen Boss fest. Gelöscht wird nichts – in der Kampfliste
        zeigt „Alle Bosse“ auch die ausgeblendeten.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Boss</th><th class="num">Max-HP</th><th class="num">Kämpfe</th><th class="num">Zuletzt</th><th class="num">Zählt</th></tr></thead>
        <tbody>${list.map(row).join("") || '<tr><td colspan="5" class="muted">Noch keine Kämpfe.</td></tr>'}</tbody></table></div>
    </section></div>`;
  $$("button[data-mob]", view).forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (btn.classList.contains("on")) return;
      $$(`button[data-mob="${btn.dataset.mob}"]`, view).forEach((b) => (b.disabled = true));
      try {
        await api("/boss-settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mobCode: Number(btn.dataset.mob), mode: btn.dataset.mode }),
        });
        // Bossauswahl und Kampfliste hängen davon ab
        state.bosses = null;
        state.fights = null;
        data = await apiJson("/boss-settings");
      } catch {
        /* Anzeige bleibt beim alten Stand */
      }
      render();
    }),
  );
}
