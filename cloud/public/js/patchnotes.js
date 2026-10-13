// Patchnotes: kompletter Versionsverlauf des Meters (GitHub-Releases), neueste oben.
// Quelle ist die öffentliche GitHub-API direkt aus dem Browser (CSP connect-src erlaubt
// api.github.com); 1 h in sessionStorage gemerkt wie der Download-Button auf „Start“.

import { $, $$, empty, esc, fmtDay, loading, pageHead, view } from "./core.js";
import { renderNotes } from "../shared/markdown.js";
import { RELEASES_PAGE, errorText, fetchReleases } from "./releases.js";

const CACHE_KEY = "a2dps.releases";
const CACHE_MS = 3_600_000;
const OPEN_FIRST = 3; // so viele neueste Versionen sind aufgeklappt

function readCache() {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
  } catch {
    return null;
  }
}
function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* voll oder gesperrt – dann eben ohne Cache */
  }
}

export async function loadPatchnotes() {
  const cached = readCache();
  if (cached?.data && Date.now() - cached.at < CACHE_MS) return render(cached.data);
  view.innerHTML = loading("Patchnotes");
  try {
    const data = await fetchReleases();
    writeCache(data);
    render(data);
  } catch (e) {
    // Lieber einen älteren Stand zeigen als gar nichts
    if (cached?.data?.length) render(cached.data, errorText(e));
    else renderError(errorText(e));
  }
}

const ghLink = `<a class="btn" href="${RELEASES_PAGE}" target="_blank" rel="noopener noreferrer">Auf GitHub</a>`;

function renderError(text) {
  view.innerHTML = `<div class="page">${pageHead("Patchnotes", "Was sich in welcher Version des Meters geändert hat.", ghLink)}
    ${empty("Patchnotes gerade nicht abrufbar", `${esc(text)}<br><a href="${RELEASES_PAGE}" target="_blank" rel="noopener noreferrer">Alle Versionen auf GitHub</a>`)}
    <p class="center"><button class="btn" type="button" id="pnRetry">Nochmal versuchen</button></p></div>`;
  $("#pnRetry")?.addEventListener("click", loadPatchnotes);
}

function entry(r, i) {
  const notes = renderNotes(r.body, { dropSections: ["Installation"] });
  const badges = [i === 0 && !r.pre ? `<span class="badge new">Neueste</span>` : "", r.pre ? `<span class="badge">Vorabversion</span>` : ""].join("");
  return `<details class="card rel"${i < OPEN_FIRST ? " open" : ""}>
    <summary>
      <span class="rel-title"><b>v${esc(r.version)}</b>${r.extra ? ` <span class="rel-extra">${esc(r.extra)}</span>` : ""}${badges}</span>
      <span class="meta">${r.date ? fmtDay(r.date) : ""}</span>
    </summary>
    <div class="notes">${notes || '<p class="muted">Keine Notizen zu dieser Version.</p>'}</div>
    <p class="rel-foot"><a class="link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Release auf GitHub →</a></p>
  </details>`;
}

function render(list, warning = "") {
  if (!list.length) {
    view.innerHTML = `<div class="page">${pageHead("Patchnotes", "", ghLink)}${empty("Noch keine Versionen", "Auf GitHub ist noch kein Release veröffentlicht.")}</div>`;
    return;
  }
  const toggle = `<button class="btn" type="button" id="pnToggle">Alle aufklappen</button>`;
  view.innerHTML = `<div class="page patchnotes">
    ${pageHead("Patchnotes", `${list.length} ${list.length === 1 ? "Version" : "Versionen"} · neueste oben`, `${toggle}${ghLink}`)}
    ${warning ? `<p class="pn-warn" role="status">Älterer Stand – ${esc(warning)}</p>` : ""}
    ${list.map(entry).join("")}
  </div>`;
  const btn = $("#pnToggle");
  const all = () => $$("details.rel", view);
  const sync = () => (btn.textContent = all().every((d) => d.open) ? "Alle zuklappen" : "Alle aufklappen");
  btn.addEventListener("click", () => {
    const open = !all().every((d) => d.open);
    all().forEach((d) => (d.open = open));
    sync();
  });
  all().forEach((d) => d.addEventListener("toggle", sync));
  sync();
}
