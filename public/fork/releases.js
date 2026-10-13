// Fork: which releases the patch-notes popup (patchnotes.js) shows, as HTML.
// Plain ES module without DOM access, so node --test can check it
// (tests/patchnotes.test.mjs).
import { renderNotes, escapeHtml, compareVersions, parseVersion } from "./markdown.js";

export { renderNotes, escapeHtml, compareVersions, parseVersion };

export const REPO = "maarloms/A2Tools-DPS-Meter";
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
export const releasePage = (tag) => `https://github.com/${REPO}/releases${tag ? "/tag/" + encodeURIComponent(tag) : ""}`;

// "Installation" is how to install the first time: noise in an update.
export const DROP_SECTIONS = ["Installation"];

const tagOf = (r) => String(r?.tag_name ?? r?.name ?? "").trim();
const asTag = (v) => {
  const s = String(v ?? "").trim();
  return s && !/^v/i.test(s) ? "v" + s : s;
};

/**
 * Releases newer than `after` up to and including `upTo`, newest first.
 * Without `after`, only the release for `upTo` itself. Drafts never;
 * prereleases only when `upTo` is exactly that prerelease.
 */
export function selectReleases(list, { after = null, upTo } = {}) {
  if (!Array.isArray(list) || !parseVersion(upTo)) return [];
  return list
    .filter((r) => r && !r.draft && parseVersion(tagOf(r)))
    .filter((r) => compareVersions(tagOf(r), upTo) <= 0)
    .filter((r) => (after && parseVersion(after) ? compareVersions(tagOf(r), after) > 0 : compareVersions(tagOf(r), upTo) === 0))
    .filter((r) => !r.prerelease || compareVersions(tagOf(r), upTo) === 0)
    .sort((a, b) => compareVersions(tagOf(b), tagOf(a)));
}

/**
 * What "Was ist neu" should cover after a start with version `installed`,
 * when `seen` was the last version whose notes were shown: null for nothing,
 * else the range for selectReleases. Never shown before (no `seen`): just
 * the installed version, once.
 */
export function whatsNewRange(installed, seen) {
  if (!parseVersion(installed)) return null;
  if (!parseVersion(seen)) return { after: null, upTo: installed };
  return compareVersions(installed, seen) > 0 ? { after: seen, upTo: installed } : null;
}

/** latest.json's own notes, when the release list cannot be had. */
export function fallbackReleases(version, notes) {
  return String(notes ?? "").trim() ? [{ tag_name: asTag(version), body: String(notes) }] : [];
}

const dateFormat = (() => {
  try {
    return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return null;
  }
})();

/** Each release as a section: version and date, then its rendered notes. */
export function releasesHtml(releases) {
  return releases
    .map((r) => {
      const tag = asTag(tagOf(r));
      const when = r.published_at && dateFormat ? dateFormat.format(new Date(r.published_at)) : "";
      const notes = renderNotes(r.body, { dropSections: DROP_SECTIONS }) || "<p>–</p>";
      return (
        `<section class="forkPatchnotesRelease">` +
        `<h3>${escapeHtml(tag)}${when ? ` <small>${escapeHtml(when)}</small>` : ""}</h3>` +
        notes +
        `</section>`
      );
    })
    .join("");
}

/** The GitHub API answer as a release list; null when it is not one (rate limit, error page). */
export function parseReleaseList(text) {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
