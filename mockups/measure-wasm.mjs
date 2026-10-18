// Misst den Worker-nahen Weg: satori (Standalone, Yoga als WASM) + @resvg/resvg-wasm.
// Zeiten sind Node-CPU auf dem Entwicklungsrechner – im Worker eher langsamer.
// node measure-wasm.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori, { init } from "satori/standalone";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { fonts } from "./lib.mjs";

const require = createRequire(import.meta.url);
await init(readFileSync(require.resolve("satori/layout.wasm")));
await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
const fontList = fonts();

for (const x of ["a", "b", "c"]) {
  const mod = await import(`./design-${x}.mjs`);
  const runs = [];
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    const s = await satori(mod.build(), { ...mod.size, fonts: fontList });
    const t1 = performance.now();
    const png = new Resvg(s, { fitTo: { mode: "width", value: mod.size.width } }).render().asPng();
    const t2 = performance.now();
    runs.push([t1 - t0, t2 - t1, png.length]);
  }
  const warm = runs.slice(1);
  const avg = (k) => (warm.reduce((a, r) => a + r[k], 0) / warm.length).toFixed(0);
  console.log(`${x}: kalt satori ${runs[0][0].toFixed(0)} ms + resvg ${runs[0][1].toFixed(0)} ms | warm satori ${avg(0)} ms + resvg-wasm ${avg(1)} ms | PNG ${(runs[0][2] / 1024).toFixed(0)} KB`);
}
