// Release-Verlauf von GitHub (Patchnotes-Seite). Ohne DOM: läuft im Browser und
// in node --test (test/releases.test.mjs). Markdown → HTML macht das gemeinsame
// Modul der App (shared/markdown.js, kopiert von scripts/sync-shared.mjs).

import { compareVersions, parseVersion } from "../shared/markdown.js";

export const REPO = "maarloms/A2Tools-DPS-Meter";
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases`;
const PER_PAGE = 100;
const MAX_PAGES = 5;

/** GitHub-Release → nur das, was die Seite braucht (klein genug für sessionStorage). */
export function slimRelease(r) {
  const tag = String(r?.tag_name || "").trim();
  const version = tag.replace(/^v/i, "") || String(r?.name || "").trim();
  const name = String(r?.name || "").trim();
  // „AION 2 DPS Meter 3.0.19“ trägt außer der Version nichts – nur echte Zusätze zeigen
  const extra = name
    .replace(/AION\s*2\s*DPS\s*Meter/i, "")
    .replace(tag, "")
    .replace(version, "")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim();
  const url = String(r?.html_url || "");
  return {
    version,
    extra,
    date: r?.published_at ? Date.parse(r.published_at) : 0,
    body: String(r?.body || ""),
    pre: Boolean(r?.prerelease),
    url: /^https:\/\/github\.com\//.test(url) ? url : RELEASES_PAGE,
  };
}

/** Entwürfe raus, neueste Version oben (Versionen, die nicht parsen, nach Datum ans Ende). */
export function sortReleases(list) {
  return list
    .filter((r) => r && !r.draft)
    .map(slimRelease)
    .filter((r) => r.version)
    .sort((a, b) => {
      const pa = parseVersion(a.version);
      const pb = parseVersion(b.version);
      if (pa || pb) {
        const c = compareVersions(pb, pa);
        if (c) return c;
      }
      return b.date - a.date;
    });
}

/** Fehlertext für die Seite: Limit freundlich mit Uhrzeit, sonst allgemein. */
export function errorText(err, now = Date.now()) {
  if (err?.rateLimited) {
    const reset = err.reset ? new Date(err.reset * 1000) : null;
    const at = reset && reset.getTime() > now ? ` ab ca. ${reset.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr` : " in etwa einer Stunde";
    return `GitHub lässt pro Stunde nur eine begrenzte Zahl Abrufe zu, und die ist gerade aufgebraucht. Versuch es${at} noch einmal.`;
  }
  if (err?.status) return `GitHub hat mit Fehler ${err.status} geantwortet. Bitte später noch einmal versuchen.`;
  return "GitHub ist gerade nicht erreichbar (keine Verbindung?). Bitte später noch einmal versuchen.";
}

/** Alle Releases holen (bis MAX_PAGES Seiten à 100). Wirft ein Error mit status/rateLimited/reset. */
export async function fetchReleases(fetchFn = fetch) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let r;
    try {
      r = await fetchFn(`${API}?per_page=${PER_PAGE}&page=${page}`, { headers: { accept: "application/vnd.github+json" } });
    } catch {
      throw Object.assign(new Error("offline"), { status: 0 });
    }
    if (!r.ok) {
      const remaining = r.headers.get("x-ratelimit-remaining");
      const err = new Error(`GitHub ${r.status}`);
      err.status = r.status;
      err.rateLimited = (r.status === 403 || r.status === 429) && (remaining === "0" || r.status === 429);
      err.reset = Number(r.headers.get("x-ratelimit-reset")) || 0;
      throw err;
    }
    const chunk = await r.json();
    if (!Array.isArray(chunk)) break;
    all.push(...chunk);
    if (chunk.length < PER_PAGE) break;
  }
  return sortReleases(all);
}
