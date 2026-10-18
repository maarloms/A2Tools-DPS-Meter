// Gemeinsame Helfer: Element-Baum ohne JSX (wie später im Worker), Fonts, Klassensymbole.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JOBS } from "./data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fontDir = (pkg) => join(here, "node_modules", "@fontsource", pkg, "files");

/** div mit display:flex (Satori verlangt flex bei mehreren Kindern) */
export function h(style, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
  return { type: "div", props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}
export const img = (src, w, hgt, style = {}) => ({ type: "img", props: { src, width: w, height: hgt, style: { width: w, height: hgt, ...style } } });
export const svg = (w, hgt, body, style = {}) =>
  img(`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">${body}</svg>`).toString("base64")}`, w, hgt, style);

const iconCache = new Map();
/** Klassensymbol als data-URI (40×42 PNG aus der App) */
export function jobIcon(id) {
  if (!iconCache.has(id)) {
    const buf = readFileSync(join(here, "..", "src", "assets", `${JOBS[id].file}.png`));
    iconCache.set(id, `data:image/png;base64,${buf.toString("base64")}`);
  }
  return iconCache.get(id);
}

export function fonts() {
  const f = (name, pkg, file, weight, style = "normal") => ({ name, data: readFileSync(join(fontDir(pkg), file)), weight, style });
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
  ];
}
