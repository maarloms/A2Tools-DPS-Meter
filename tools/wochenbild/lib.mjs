// Gemeinsame Helfer der Entwürfe: Element-Baum ohne JSX (satori), Fonts, Klassensymbole, Spielerbild.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
/** Klassensymbole der App (40×42 PNG) */
const ASSETS = join(here, "..", "..", "src", "assets");

// Klassen: ID (FightRecord.jobId, 11–19) → Name, Symbol-Datei in src/assets, Klassenfarbe
export const JOBS = {
  11: { name: "Gladiator", file: "검성", color: "#e8793a", female: false },
  12: { name: "Templer", file: "수호성", color: "#5b8fd9", female: false },
  13: { name: "Assassine", file: "살성", color: "#c45ad6", female: true },
  14: { name: "Waldläufer", file: "궁성", color: "#4fbf6a", female: false },
  15: { name: "Magier", file: "마도성", color: "#4aa3f0", female: false },
  16: { name: "Beschwörer", file: "정령성", color: "#2fc4b2", female: false },
  17: { name: "Kleriker", file: "치유성", color: "#f0d36b", female: false },
  18: { name: "Kantor", file: "호법성", color: "#9c8cf0", female: false },
  19: { name: "Faustkämpfer", file: "권성", color: "#e25656", female: false },
};
const UNKNOWN_JOB = { name: "Unbekannt", file: null, color: "#8a8f9e", female: false };
/** Klasse zu einer ID, unbekannte (0, neue Klassen) mit neutralem Symbol */
export const jobOf = (id) => JOBS[id] ?? UNKNOWN_JOB;

/** div mit display:flex (Satori verlangt flex bei mehreren Kindern) */
export function h(style, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
  return { type: "div", props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}
export const img = (src, w, hgt, style = {}) => ({ type: "img", props: { src, width: w, height: hgt, style: { width: w, height: hgt, ...style } } });
const svgDoc = (w, hgt, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">${body}</svg>`;
export const svg = (w, hgt, body, style = {}) => img(`data:image/svg+xml;base64,${Buffer.from(svgDoc(w, hgt, body)).toString("base64")}`, w, hgt, style);
/** SVG als CSS-Hintergrund – liegt sicher unter dem Inhalt (absolute Bilder malt satori ÜBER Text im Fluss) */
export const svgUrl = (w, hgt, body) => `url(data:image/svg+xml;base64,${Buffer.from(svgDoc(w, hgt, body)).toString("base64")})`;

const iconCache = new Map();
const UNKNOWN_ICON = `data:image/svg+xml;base64,${Buffer.from(svgDoc(40, 42,
  `<path d="M20 2 L37 9 L35 26 Q31 36 20 40 Q9 36 5 26 L3 9 Z" fill="none" stroke="#c9ccd6" stroke-width="2.5"/>` +
  `<text x="20" y="29" font-size="20" text-anchor="middle" fill="#c9ccd6" font-family="sans-serif">?</text>`)).toString("base64")}`;

/** Klassensymbol als data-URI (PNG aus der App), unbekannte Klasse → neutrales Schild */
export function jobIcon(id) {
  if (!iconCache.has(id)) {
    const file = jobOf(id).file;
    const path = file ? join(ASSETS, `${file}.png`) : null;
    iconCache.set(id, path && existsSync(path) ? `data:image/png;base64,${readFileSync(path).toString("base64")}` : UNKNOWN_ICON);
  }
  return iconCache.get(id);
}

/**
 * Bild eines Spielers: später ein hochgeladenes Portrait (p.portrait = data-URI), bis dahin das Klassensymbol mittig.
 * Rahmen/Hintergrund liefert der Entwurf.
 */
export function avatar(p, w, hgt, iconScale = 0.55) {
  if (p.portrait) return img(p.portrait, w, hgt, { objectFit: "cover" });
  const iw = Math.round(Math.min(w, hgt) * iconScale);
  return h({ width: w, height: hgt, alignItems: "center", justifyContent: "center" }, img(jobIcon(p.job), iw, Math.round(iw * 1.05)));
}

/** Fonts aus @fontsource (WOFF – satori kann kein WOFF2) */
export function fonts() {
  const dir = (pkg) => join(dirname(require.resolve(`@fontsource/${pkg}/package.json`)), "files");
  const f = (name, pkg, file, weight, style = "normal") => ({ name, data: readFileSync(join(dir(pkg), file)), weight, style });
  return [
    f("Cinzel", "cinzel", "cinzel-latin-700-normal.woff", 700),
    f("Cinzel", "cinzel", "cinzel-latin-900-normal.woff", 900),
    f("Inter", "inter", "inter-latin-400-normal.woff", 400),
    f("Inter", "inter", "inter-latin-500-normal.woff", 500),
    f("Inter", "inter", "inter-latin-600-normal.woff", 600),
    f("Inter", "inter", "inter-latin-700-normal.woff", 700),
    f("Inter", "inter", "inter-latin-800-normal.woff", 800),
    f("Inter", "inter", "inter-latin-900-normal.woff", 900),
    f("Inter", "inter", "inter-latin-800-italic.woff", 800, "italic"),
    f("Inter", "inter", "inter-latin-900-italic.woff", 900, "italic"),
    f("Fell", "im-fell-english", "im-fell-english-latin-400-normal.woff", 400),
    f("Fell", "im-fell-english", "im-fell-english-latin-400-italic.woff", 400, "italic"),
    f("Caveat", "caveat", "caveat-latin-600-normal.woff", 600),
    f("Caveat", "caveat", "caveat-latin-700-normal.woff", 700),
    f("Fraktur", "unifrakturmaguntia", "unifrakturmaguntia-latin-400-normal.woff", 400),
    f("Anton", "anton", "anton-latin-400-normal.woff", 400),
    f("Playfair", "playfair-display", "playfair-display-latin-700-normal.woff", 700),
    f("Playfair", "playfair-display", "playfair-display-latin-900-normal.woff", 900),
    f("Playfair", "playfair-display", "playfair-display-latin-700-italic.woff", 700, "italic"),
    f("Playfair", "playfair-display", "playfair-display-latin-900-italic.woff", 900, "italic"),
  ];
}
