// Probe: alle Entwürfe mit den Beispieldaten und Randfällen rendern (1–2 Spieler, unbekannte Klasse,
// lange Namen, keine Bosse/kein Kill/kein Vergleich). Prüft, dass nichts abstürzt und jedes PNG ≤ 1 MB ist.
//
//   node samples.mjs [--out-dir <ordner>] [--design d]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DESIGNS, MAX_IMAGE_BYTES, parseArgs, renderPng } from "./render.mjs";

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args["out-dir"] ?? join(tmpdir(), "wochenbild-proben")));
mkdirSync(outDir, { recursive: true });
const base = JSON.parse(readFileSync(join(import.meta.dirname, "sample.json"), "utf8")).rooms[0];

const cases = {
  beispiel: base,
  "ein-spieler": { ...base, players: base.players.slice(0, 1) },
  "zwei-spieler": { ...base, players: base.players.slice(0, 2) },
  randfaelle: {
    ...base,
    room: "sehr-langer-raumname-mit-vielen-woertern",
    dpsChange: null,
    prevKills: 0,
    prevFights: 0,
    fastest: null,
    best: { ...base.best, killed: false, boss: "Ein außergewöhnlich langer Bossname [Elite]" },
    bosses: base.bosses.map((b) => ({ ...b, change: null })),
    players: [
      { name: "Überlangername_mit_Zusatz", job: 0, dps: 12_345_678, boss: "Ein außergewöhnlich langer Bossname [Elite]" },
      { name: "Neu", job: 23, dps: 9_999, boss: "Boss" },
      ...base.players.slice(2, 4),
    ],
  },
  "ohne-bosse": { ...base, bosses: [] },
};

const designs = args.design ? [String(args.design)] : DESIGNS;
let fail = 0;
for (const d of designs) {
  for (const [name, room] of Object.entries(cases)) {
    try {
      const r = await renderPng(room, { design: d });
      const file = join(outDir, `${d}-${name}.png`);
      writeFileSync(file, r.png);
      const ok = r.png.length <= MAX_IMAGE_BYTES;
      if (!ok) fail++;
      console.log(`${ok ? "OK    " : "FEHLER"} ${d}/${name}: ${r.width}×${r.height}, ${(r.png.length / 1024).toFixed(0)} KB`);
    } catch (e) {
      fail++;
      console.log(`FEHLER ${d}/${name}: ${e.message}`);
    }
  }
}
console.log(`\n${outDir}\n${fail ? `${fail} Fehler` : "alles gerendert"}`);
process.exit(fail ? 1 : 0);
