// Mitglieder verwalten: wer zählt zur Gruppe? (Testnamen/Tippfehler ausblenden)

import { $$, ago, api, apiJson, esc, failed, fmtNum, loadMembers, loading, pageHead, state, view } from "./core.js";

let diags = [];

export async function loadMembersPage() {
  view.innerHTML = loading("Mitglieder");
  try {
    const [, d] = await Promise.all([loadMembers(true), apiJson("/diagnostics").catch(() => ({ diagnostics: [] }))]);
    diags = d.diagnostics || [];
    render();
  } catch (e) {
    failed(e, "Die Mitgliederliste");
  }
}

function render() {
  const fixed = state.fixedMembers;
  const rows = (state.members || [])
    .map(
      (m) => `<tr class="${m.active ? "" : "dim"}"><td><b>${esc(m.name)}</b></td><td class="num">${fmtNum(m.fights)}</td>
        <td class="num">${m.lastSeen ? ago(m.lastSeen) : "–"}</td>
        <td class="num">${
          fixed
            ? m.active
              ? "Mitglied"
              : "–"
            : `<label class="switch"><input type="checkbox" data-name="${esc(m.name)}" ${m.active ? "checked" : ""}><span>${m.active ? "zählt" : "ausgeblendet"}</span></label>`
        }</td></tr>`,
    )
    .join("");
  view.innerHTML = `<div class="page">
    ${pageHead("Mitglieder", "Nur Mitglieder erscheinen in Übersicht, Vergleich, Live und Kampftabellen.")}
    <section class="card">
      <p class="muted">${
        fixed
          ? "Die Mitglieder sind fest im Server eingestellt (<code>ROOM_MEMBERS</code>) und können hier nicht geändert werden."
          : "Jeder Name, der sich mit der App verbindet oder einen Kampf hochlädt, wird automatisch Mitglied. Testnamen oder Tippfehler hier ausblenden – ihre Daten bleiben erhalten und lassen sich wieder einblenden."
      }</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th class="num">Kämpfe</th><th class="num">Zuletzt</th><th class="num">Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">Noch niemand.</td></tr>'}</tbody></table></div>
    </section>
    ${diagCard()}</div>`;
  $$("input[data-name]", view).forEach((c) =>
    c.addEventListener("change", async () => {
      c.disabled = true;
      try {
        await api("/members", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: c.dataset.name, active: c.checked }),
        });
        state.bosses = null;
        state.fights = null;
        await loadMembers(true);
        render();
      } catch {
        c.checked = !c.checked;
        c.disabled = false;
      }
    }),
  );
}

/** Diagnose-Pakete aus der App (Einstellungen → Gruppe teilen → Diagnose senden) */
function diagCard() {
  if (!diags.length) return "";
  const base = `/api/rooms/${encodeURIComponent(state.room)}/diagnostics/`;
  const rows = diags
    .map(
      (d) => `<tr><td><b>${esc(d.uploader)}</b>${d.note ? `<div class="muted small">${esc(d.note)}</div>` : ""}</td>
        <td class="num">${ago(d.createdMs)}</td><td class="num">${fmtNum(d.bytes / 1024)} KB</td>
        <td class="num"><a class="btn ghost" href="${base}${d.id}" download>Laden</a></td></tr>`,
    )
    .join("");
  return `<section class="card"><h3>Diagnosen</h3>
    <p class="muted">Von der App gesendet: Logs, Einstellungen ohne Passwörter und die letzten Kämpfe. Die neuesten 20 bleiben erhalten.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Von</th><th class="num">Wann</th><th class="num">Größe</th><th class="num"></th></tr></thead>
      <tbody>${rows}</tbody></table></div></section>`;
}
