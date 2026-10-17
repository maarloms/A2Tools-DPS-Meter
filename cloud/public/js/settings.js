// Raum-Einstellungen: Wochenrückblick per Discord-Webhook (Opt-in).
// Die Webhook-URL ist ein Geheimnis: der Server gibt sie nie zurück, nur „…abcd“.
// Ändern, Testen und Entfernen verlangen das Admin-Passwort (fragt api() bei Bedarf ab).

import { $, AuthError, api, apiJson, esc, failed, fmtDate, loading, pageHead, state, view } from "./core.js";

let hook = null;
let msg = null; // { kind: "ok" | "bad", text }

/** Gleiche Regel wie der Server (src/weekly-core.ts), nur für eine schnelle Rückmeldung */
const URL_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/(?:v\d{1,2}\/)?webhooks\/\d{15,22}\/[A-Za-z0-9_-]{40,100}$/;

const ERRORS = {
  bad_url: "Das ist keine Discord-Webhook-Adresse. Sie beginnt mit https://discord.com/api/webhooks/…",
  no_webhook: "Erst eine Webhook-Adresse hinterlegen.",
  too_soon: "Bitte etwa eine halbe Minute warten, bevor du noch einen Test sendest.",
  admin_required: "Dafür ist das Admin-Passwort nötig.",
};
const OUTCOME = {
  ok: "Test-Post gesendet – schau in den Discord-Kanal.",
  invalid: "Discord kennt diesen Webhook nicht (gelöscht oder Token falsch). Bitte neu anlegen und hinterlegen.",
  rate_limited: "Discord bremst gerade (Rate-Limit). Bitte später noch einmal versuchen.",
  retry: "Discord ist gerade nicht erreichbar. Bitte später noch einmal versuchen.",
  rejected: "Discord hat die Nachricht abgelehnt.",
};

export async function loadSettings() {
  if (!hook) view.innerHTML = loading("Einstellungen");
  try {
    hook = await apiJson("/webhook");
    render();
  } catch (e) {
    failed(e, "Die Einstellungen");
  }
}

/** PATCH/DELETE/POST; Fehler mit Text vom Server statt nur „HTTP 400“ */
async function send(method, path, body) {
  try {
    const r = await api(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      softFail: true,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { error: data.error || `HTTP ${r.status}` };
    return data;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return { error: e.message === "admin_required" ? "admin_required" : "network" };
  }
}

function statusLine(h) {
  if (!h.configured) return `<span class="muted">Kein Webhook hinterlegt.</span>`;
  const parts = [`<b>Webhook gesetzt ✓</b> <span class="muted">(${esc(h.hint)})</span>`];
  if (h.status === "invalid") parts.push(`<span class="badge bad">ungültig</span>`);
  else if (h.status === "error") parts.push(`<span class="badge warn">Fehler beim letzten Versuch</span>`);
  return parts.join(" ");
}

function render() {
  const h = hook || { configured: false, enabled: false };
  const note = msg ? `<p class="${msg.kind === "ok" ? "good" : "bad"}" role="status">${esc(msg.text)}</p>` : "";
  view.innerHTML = `<div class="page">
    ${pageHead("Einstellungen", `Raum ${esc(state.room)}`)}
    <section class="card">
      <h2>Wochenrückblick in Discord</h2>
      <p class="muted">Nach dem wöchentlichen Reset (mittwochs ${resetText()}) postet der Server eine Karte mit Kämpfen, Boss-Kills,
        bestem Kampf, Top-3-DPS und dem Vergleich zur Vorwoche in euren Discord-Kanal. Es zählen nur Mitglieder und Bosse, die auch hier
        zählen. Wochen ohne Kämpfe werden nicht gepostet.</p>
      <p class="muted small">So kommst du an die Adresse: Discord → Kanal bearbeiten → Integrationen → Webhooks → Neuer Webhook → „Webhook-URL kopieren“.
        Die Adresse ist wie ein Passwort: Wer sie kennt, kann in den Kanal schreiben. Sie wird hier nie wieder angezeigt.</p>
      <p>${statusLine(h)}</p>
      ${h.lastError && h.status !== "ok" ? `<p class="muted small">${esc(h.lastError)}${h.lastCode ? ` (HTTP ${h.lastCode})` : ""}</p>` : ""}
      ${h.lastPostMs ? `<p class="muted small">Zuletzt gepostet: ${fmtDate(h.lastPostMs)}</p>` : ""}
      <form id="hookForm" class="field" autocomplete="off">
        <span>${h.configured ? "Neue Webhook-Adresse (ersetzt die alte)" : "Webhook-Adresse"}</span>
        <div class="toolbar">
          <input class="input" id="hookUrl" type="password" inputmode="url" spellcheck="false" autocomplete="off"
            placeholder="https://discord.com/api/webhooks/…" aria-label="Discord-Webhook-Adresse">
          <button class="btn primary" type="submit">Speichern</button>
        </div>
      </form>
      <label class="switch"><input type="checkbox" id="hookOn" ${h.enabled ? "checked" : ""} ${h.configured ? "" : "disabled"}>
        <span>Wochenrückblick automatisch posten</span></label>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn" type="button" id="hookTest" ${h.configured ? "" : "disabled"}>Test-Post senden</button>
        <button class="btn danger" type="button" id="hookDel" ${h.configured ? "" : "disabled"}>Webhook entfernen</button>
      </div>
      ${note}
    </section></div>`;

  $("#hookForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("#hookUrl").value.trim();
    if (!URL_RE.test(url)) return show("bad", ERRORS.bad_url);
    const r = await send("PATCH", "/webhook", { url, enabled: true });
    if (r.error) return show("bad", ERRORS[r.error] || "Speichern hat nicht geklappt.");
    hook = r;
    show("ok", "Gespeichert. Der Wochenrückblick ist eingeschaltet – mit „Test-Post senden“ prüfen.");
  });
  $("#hookOn").addEventListener("change", async (e) => {
    const r = await send("PATCH", "/webhook", { enabled: e.target.checked });
    if (r.error) {
      e.target.checked = !e.target.checked;
      return show("bad", ERRORS[r.error] || "Das hat nicht geklappt.");
    }
    hook = r;
    show("ok", r.enabled ? "Eingeschaltet." : "Ausgeschaltet – es wird nichts mehr gepostet.");
  });
  $("#hookTest").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const r = await send("POST", "/webhook/test");
    if (r.error) return show("bad", ERRORS[r.error] || "Der Test hat nicht geklappt.");
    hook = r;
    show(r.ok ? "ok" : "bad", OUTCOME[r.outcome] || "Der Test hat nicht geklappt.");
  });
  $("#hookDel").addEventListener("click", async () => {
    if (!window.confirm("Webhook entfernen? Es wird dann nichts mehr in Discord gepostet.")) return;
    const r = await send("DELETE", "/webhook");
    if (r.error) return show("bad", ERRORS[r.error] || "Entfernen hat nicht geklappt.");
    hook = r;
    show("ok", "Webhook entfernt.");
  });
}

function show(kind, text) {
  msg = { kind, text };
  render();
  msg = null;
}

/** „09:00 Uhr“ bzw. „08:00 Uhr“ – Reset 07:00 UTC in deutscher Zeit */
function resetText() {
  const d = new Date();
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7);
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(t) + " Uhr";
}
