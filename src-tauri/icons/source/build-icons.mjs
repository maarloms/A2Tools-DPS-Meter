// Fork: builds every app icon from the two SVGs here.
//
//   node src-tauri/icons/source/build-icons.mjs      (from app/)
//
// icon.svg is the full design (gauge and "DPS"), icon-small.svg the one for
// 48 px and below, where the lettering would only blur. `tauri icon` makes
// all platform files from icon.svg; then icon.ico and the small PNGs are
// replaced so Windows shows the small design in the taskbar, title bars and
// Explorer lists. Rendering uses sharp from the cloud worker's dependencies
// (cd cloud && npm install).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const icons = join(here, "..");
const app = join(icons, "..", "..");
const sharp = createRequire(join(app, "cloud", "package.json"))("sharp");

const full = join(here, "icon.svg");
const small = join(here, "icon-small.svg");
const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

const tmp = mkdtempSync(join(tmpdir(), "a2-icons-"));
try {
  const master = join(tmp, "icon-1024.png");
  writeFileSync(master, await png(full, 1024));
  execSync(`npx tauri icon "${master}" -o "${icons}"`, { cwd: app, stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// The small PNGs Windows and the Store tiles use.
for (const [file, size] of [["32x32.png", 32], ["Square30x30Logo.png", 30], ["Square44x44Logo.png", 44]]) {
  writeFileSync(join(icons, file), await png(small, size));
}

// icon.ico: PNG entries, the small design up to 48 px.
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((s) => png(s <= 48 ? small : full, s)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s === 256 ? 0 : s, e);
  header.writeUInt8(s === 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(join(icons, "icon.ico"), Buffer.concat([header, ...images]));
console.log(`icon.ico: ${sizes.join(", ")} px`);
