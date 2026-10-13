// Fork: release notes (GitHub release bodies, latest.json "notes") as safe
// HTML, and version numbers to pick which releases to show.
//
// Shared with the cloud dashboard: cloud/scripts/sync-shared.mjs copies this
// file into cloud/. So it stays a plain ES module without any app, DOM or
// Node dependency, usable in the browser and in node --test alike.
//
// Safety: every line is HTML-escaped before any formatting is applied, and
// the formatting only ever adds a fixed set of tags. Links are kept only for
// https: URLs; anything else stays plain text.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escapes a value (text and attribute safe). */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Placeholders for finished inline pieces (code, links), so later formatting
// cannot reach into them. \u0000 never survives in release text.
const HOLD = "\u0000";

// Inline formatting of one line that is ALREADY escaped.
function inline(escaped) {
  const held = [];
  const hold = (html) => `${HOLD}${held.push(html) - 1}${HOLD}`;
  let s = escaped.replace(new RegExp(HOLD, "g"), "");

  // `code` first: nothing inside is formatted.
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));

  // [text](https://…) – only https. The URL is escaped text already, so it
  // cannot contain a raw quote or angle bracket.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text, url) => {
    if (!/^https:\/\/[^\s]+$/i.test(url)) return text;
    return hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  });
  // Bare https://… links.
  // An escaped quote or bracket (&quot; &#39; &lt; &gt;) ends the URL.
  s = s.replace(/(^|[\s(])(https:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<])+?)(?=[.,;:!?)]*(?:$|[\s<]|&(?:quot|#39|lt|gt);))/gi, (_, lead, url) =>
    lead + hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));

  s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__(?=\S)(.+?)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/~~(?=\S)(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, "$1<em>$2</em>");

  return s.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (_, i) => held[Number(i)]);
}

// A heading line: "# Title" … "###### Title", or a line that is bold as a
// whole ("**Neu**", "**Installation (neu)**", "**Behoben:**").
function headingText(line) {
  const hash = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (hash) return hash[1];
  const bold = line.match(/^\s*(?:\*\*((?:(?!\*\*).)+)\*\*|__((?:(?!__).)+)__)\s*:?\s*$/);
  if (bold) return bold[1] ?? bold[2];
  return null;
}

const plain = (text) => String(text).replace(/[*_`~]/g, "").trim().toLowerCase();

/**
 * Markdown release notes as safe HTML.
 *
 * Supports headings (`#` or a whole bold line), `- `/`* `/`+ ` and `1.`
 * lists (nested by indentation), `**bold**`, `*italic*`, `~~struck~~`,
 * `` `code` ``, ``` fences, `---`, paragraphs and https links. CRLF is fine.
 *
 * `dropSections`: a section whose heading starts with one of these
 * (case-insensitive, e.g. "Installation" also drops "Installation (neu)")
 * is left out up to the next heading.
 */
export function renderNotes(md, { dropSections = [] } = {}) {
  const drop = dropSections.map(plain).filter(Boolean);
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  const lists = []; // open lists: { tag, indent }
  let dropping = false;
  let fence = null;

  const closePara = () => {
    if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
    para = [];
  };
  const closeLists = (toIndent = -1) => {
    while (lists.length && lists[lists.length - 1].indent > toIndent) {
      out.push(`</li></${lists.pop().tag}>`);
    }
  };
  const closeAll = () => { closePara(); closeLists(); };

  for (const raw of lines) {
    if (fence) {
      if (/^\s*```/.test(raw)) {
        out.push(`<pre><code>${fence.join("\n")}</code></pre>`);
        fence = null;
      } else {
        fence.push(escapeHtml(raw));
      }
      continue;
    }

    const heading = headingText(raw);
    if (heading !== null) {
      closeAll();
      const name = plain(heading);
      dropping = drop.some((d) => name.startsWith(d));
      if (!dropping) out.push(`<h4>${inline(escapeHtml(heading.trim()))}</h4>`);
      continue;
    }
    if (dropping) continue;

    if (/^\s*```/.test(raw)) { closeAll(); fence = []; continue; }
    if (!raw.trim()) { closeAll(); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) { closeAll(); out.push("<hr>"); continue; }

    const item = raw.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
    if (item) {
      closePara();
      const indent = item[1].replace(/\t/g, "    ").length;
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      closeLists(indent);
      const top = lists[lists.length - 1];
      if (top && top.indent === indent && top.tag !== tag) {
        out.push(`</li></${lists.pop().tag}>`);
      }
      const open = lists[lists.length - 1];
      if (open && open.indent === indent) {
        out.push("</li><li>");
      } else {
        out.push(`<${tag}><li>`);
        lists.push({ tag, indent });
      }
      out.push(inline(escapeHtml(item[3].trim())));
      continue;
    }

    const text = inline(escapeHtml(raw.trim()));
    if (lists.length && /^\s/.test(raw)) {
      // Continuation of the list item above.
      out.push(" " + text);
      continue;
    }
    closeLists();
    para.push(text);
  }
  if (fence) out.push(`<pre><code>${fence.join("\n")}</code></pre>`);
  closeAll();
  return out.join("");
}

/**
 * "v3.0.19", "3.0.19", "3.1.0-beta.2" → { major, minor, patch, pre }, where
 * `pre` lists the prerelease parts ([] for a release). Build metadata
 * ("+abc") is ignored. Anything else → null.
 */
export function parseVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
    pre: m[4] ? m[4].split(".") : [],
  };
}

/**
 * Semver order: < 0 when a is older than b, 0 when equal, > 0 when newer.
 * A prerelease is older than its release (3.1.0-beta < 3.1.0). Takes strings
 * or parseVersion results; a version that does not parse is older than any
 * that does.
 */
export function compareVersions(a, b) {
  const x = typeof a === "object" && a !== null ? a : parseVersion(a);
  const y = typeof b === "object" && b !== null ? b : parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (const k of ["major", "minor", "patch"]) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) + (y.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
