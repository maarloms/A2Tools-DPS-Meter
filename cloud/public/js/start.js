// Startseite (nach dem Login): Was ist das Tool, Download, Installation, Einladungslink.

import { $, esc, fmtDay, state, view } from "./core.js";

const REPO = "maarloms/A2Tools-DPS-Meter";
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const CACHE_KEY = "a2dps.release";

/** Neueste Version über die GitHub-API (1 h im Browser gemerkt) */
async function latestRelease() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (c && Date.now() - c.at < 3_600_000) return c.data;
  } catch {
    /* egal */
  }
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  const msi = (j.assets || []).find((a) => /\.msi$/i.test(a.name));
  const data = {
    version: String(j.tag_name || j.name || "").replace(/^v/i, ""),
    date: j.published_at ? Date.parse(j.published_at) : 0,
    url: msi?.browser_download_url || RELEASES,
    size: msi?.size || 0,
    file: msi?.name || "",
  };
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* egal */
  }
  return data;
}

const FEATURES = [
  ["Overlay-Meter", "Schlankes DPS-Fenster über dem Spiel, immer im Vordergrund, auf Wunsch durchklickbar."],
  ["TARGET & GROUP", "TARGET zeigt den Schaden auf dein aktuelles Ziel, GROUP alles, was du und deine Gruppe gerade bekämpft."],
  ["Event-Timer mit Alarm", "Raumzeit-Risse, Belagerungen, Weltbosse – frei filterbar, mit Hinweiston kurz vorher."],
  ["Kampf-Historie", "Jeder Bosskampf wird gespeichert: Skills, Krit-, Rücken- und Frontal-Quoten, DPS-Verlauf."],
  ["Gruppen-Dashboard", "Live sehen, was die anderen machen, dazu Bestwerte, Vergleiche und Trends für uns drei."],
];

export function renderStart() {
  const invite = `${location.origin}/#/join/${state.room}/…`;
  view.innerHTML = `<div class="page start">
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">Für unsere Gruppe</p>
        <h1 class="hero-title">AION 2 DPS Meter</h1>
        <p class="intro">Ein Schadensmesser für AION 2 mit Overlay, Event-Timer und einem gemeinsamen Dashboard –
          damit wir sehen, wer was macht, und besser werden.</p>
        <div class="hero-actions">
          <a class="btn primary big" id="dl" href="${RELEASES}" rel="noopener">Download für Windows</a>
          <a class="btn big" href="#/overview">Zum Gruppen-Dashboard</a>
        </div>
        <p class="muted small" id="dlInfo">Neueste Version wird gesucht …</p>
      </div>
      <div class="safe card">
        <h2>Liest nur mit</h2>
        <p>Das Meter wertet den Netzwerkverkehr <b>passiv</b> über Npcap aus – genau die Daten, die ohnehin an deinen PC gehen.
          Es greift <b>nicht</b> ins Spiel ein, verändert keine Dateien und schickt nichts an den Spielserver.</p>
      </div>
    </section>

    <section>
      <h2 class="section-title">Was es kann</h2>
      <div class="features">${FEATURES.map(([t, d]) => `<div class="feature"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}</div>
    </section>

    <section class="card">
      <h2>Installation</h2>
      <ol class="steps">
        <li><b>MSI herunterladen und starten.</b> Windows SmartScreen meldet sich, weil die Datei nicht signiert ist:
          „Weitere Informationen“ → „Trotzdem ausführen“.</li>
        <li><b>Meter starten.</b> Fehlt Npcap, bietet das Meter an, es von npcap.com zu laden und zu installieren –
          Standardoptionen übernehmen, danach startet das Meter neu. Einmalig nötig.</li>
        <li><b>Im Spiel einloggen.</b> Sobald du kämpfst, erscheinen die Zahlen. Updates kommen automatisch.</li>
        <li><b>Gruppe verbinden.</b> In der App unter Einstellungen → „Gruppe teilen“ den Einladungslink einfügen.
          Ab dann teilst du live mit uns und deine Bosskämpfe landen hier im Dashboard.</li>
      </ol>
      <p class="muted small">Einladungslink: <code>${esc(invite)}</code> – den vollständigen Link bekommst du von Marlon (enthält das Passwort, nicht weitergeben).</p>
    </section>
  </div>`;

  latestRelease()
    .then((r) => {
      if (!$("#dl")) return;
      $("#dl").href = r.url;
      $("#dl").textContent = r.version ? `Download v${r.version}` : "Download für Windows";
      $("#dlInfo").textContent =
        [r.file, r.size ? `${(r.size / 1e6).toFixed(1)} MB` : "", r.date ? `veröffentlicht am ${fmtDay(r.date)}` : ""].filter(Boolean).join(" · ") ||
        "Windows-Installer (MSI)";
    })
    .catch(() => {
      if ($("#dlInfo")) $("#dlInfo").innerHTML = `Version gerade nicht abrufbar – der Button führt zur <a href="${RELEASES}" rel="noopener">Release-Seite auf GitHub</a>.`;
    });
}
