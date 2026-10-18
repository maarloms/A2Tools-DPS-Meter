// node render.mjs [a b c] → wochenbild-<x>.png (1200 px) + vorschau/wochenbild-<x>-400.png (Discord-Vorschaugröße)
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fonts } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const which = process.argv.slice(2).length ? process.argv.slice(2) : ["a", "b", "c"];
const fontList = fonts();
mkdirSync(join(here, "vorschau"), { recursive: true });

for (const x of which) {
  const mod = await import(`./design-${x}.mjs`);
  const t0 = performance.now();
  const svgText = await satori(mod.build(), { ...mod.size, fonts: fontList });
  const t1 = performance.now();
  const png = new Resvg(svgText, { fitTo: { mode: "width", value: mod.size.width }, font: { loadSystemFonts: false } }).render().asPng();
  const t2 = performance.now();
  writeFileSync(join(here, `wochenbild-${x}.png`), png);
  const small = new Resvg(svgText, { fitTo: { mode: "width", value: 400 }, font: { loadSystemFonts: false } }).render().asPng();
  writeFileSync(join(here, "vorschau", `wochenbild-${x}-400.png`), small);
  console.log(`${x}: satori ${(t1 - t0).toFixed(0)} ms, resvg ${(t2 - t1).toFixed(0)} ms, SVG ${(svgText.length / 1024).toFixed(0)} KB, PNG ${(png.length / 1024).toFixed(0)} KB`);
}
