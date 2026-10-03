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
console.log("sync-shared: events.json, schedule.js, dungeons.json kopiert");
