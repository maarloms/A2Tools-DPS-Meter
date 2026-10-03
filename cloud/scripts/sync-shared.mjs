// Kopiert den Event-Plan der App unveraendert ins Dashboard (laeuft automatisch
// vor `wrangler dev` / `wrangler deploy`, siehe build.command in wrangler.jsonc).
// Quelle bleibt app/public/fork/ – hier nichts von Hand aendern.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "..", "public", "fork");
const dst = join(root, "public", "shared");
mkdirSync(dst, { recursive: true });
for (const f of ["events.json", "schedule.js"]) copyFileSync(join(src, f), join(dst, f));
// Dungeon-Namen aus den Spieldaten des Meters (statt „Instanz 600072“)
copyFileSync(join(root, "..", "src", "data", "i18n", "dungeons", "en.json"), join(dst, "dungeons.json"));
// Klassensymbole des Meters, nach Klassen-ID benannt (ASCII-Pfade)
const JOB_ICONS = { 11: "검성", 12: "수호성", 13: "살성", 14: "궁성", 15: "마도성", 16: "정령성", 17: "치유성", 18: "호법성" };
mkdirSync(join(dst, "jobs"), { recursive: true });
for (const [id, name] of Object.entries(JOB_ICONS))
  copyFileSync(join(root, "..", "public", "src", "assets", `${name}.png`), join(dst, "jobs", `${id}.png`));
console.log("sync-shared: events.json, schedule.js, dungeons.json, Klassensymbole kopiert");
