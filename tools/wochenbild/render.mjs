// Wochenbild rendern: Recap-Daten (pending-Format) → PNG.
//
//   node render.mjs --data recap.json [--design d] [--out wochenbild.png] [--room <code>] [--guild "Name"]
//
// --data: entweder ein Raum-Objekt (rooms[i] aus GET /api/weekly/pending) oder die ganze pending-Antwort
// (dann --room oder der erste Raum). Ohne --data: Beispieldaten (sample.json).
// Als Modul: renderPng(room, { design, guild }) → { png, width, height, design }.

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fonts } from "./lib.mjs";
import { viewModel } from "./format.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** Standard-Entwurf (Marlon, 18.10.2026: D "Sammelkarten") */
export const DEFAULT_DESIGN = "d";
export const DESIGNS = ["a", "b", "c", "d", "e", "f"];
/** Grenze des Workers (POST /api/weekly/:room/image) */
export const MAX_IMAGE_BYTES = 1_048_576;

const PLACEHOLDER_BEST = { fightId: "", boss: "–", groupDps: 0, durationMs: 0, killed: false };
let fontCache = null;

/**
 * Ein Bild rendern. Ist das PNG größer als MAX_IMAGE_BYTES, wird es schrittweise kleiner gerechnet
 * (Breite × 0,85, mindestens 600 px) – detailreiche Entwürfe (E: Pergament-Struktur) brauchen das.
 */
export async function renderPng(room, { design = DEFAULT_DESIGN, guild, maxBytes = MAX_IMAGE_BYTES } = {}) {
  const d = String(design).toLowerCase();
  if (!DESIGNS.includes(d)) throw new Error(`Unbekannter Entwurf "${design}" (erlaubt: ${DESIGNS.join(", ")})`);
  if (!room || !Array.isArray(room.players)) throw new Error("Recap-Daten ohne players – erwartet ein Raum-Objekt aus /api/weekly/pending");
  const mod = await import(pathToFileURL(join(here, "designs", `${d}.mjs`)).href);
  const vm = viewModel(room, { guild });
  if (d !== "d" && !vm.best) vm.best = PLACEHOLDER_BEST; // ältere Entwürfe setzen einen besten Kampf voraus
  fontCache ??= fonts();
  const svgText = await satori(mod.build(vm), { ...mod.size, fonts: fontCache });
  let width = mod.size.width;
  for (;;) {
    const png = new Resvg(svgText, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
    if (png.length <= maxBytes || width <= 600) {
      return { png, width, height: Math.round((mod.size.height * width) / mod.size.width), design: d, tooLarge: png.length > maxBytes };
    }
    width = Math.max(600, Math.round(width * 0.85));
  }
}

/** --name wert / --flag aus argv */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.data ? resolve(String(args.data)) : join(here, "sample.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  const rooms = Array.isArray(data.rooms) ? data.rooms : [data];
  const room = args.room ? rooms.find((r) => r.room === args.room) : rooms[0];
  if (!room) throw new Error(args.room ? `Raum "${args.room}" nicht in den Daten` : "Keine Räume in den Daten");
  const t0 = performance.now();
  const res = await renderPng(room, { design: args.design ?? DEFAULT_DESIGN, guild: typeof args.guild === "string" ? args.guild : undefined });
  const out = resolve(String(args.out ?? `wochenbild-${res.design}.png`));
  writeFileSync(out, res.png);
  console.log(`${out}: Entwurf ${res.design}, ${res.width}×${res.height}, ${(res.png.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms` +
    (res.tooLarge ? " – ACHTUNG: größer als 1 MB, der Worker nimmt es nicht an" : ""));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Fehler: ${e.message}`);
    process.exit(1);
  });
}
