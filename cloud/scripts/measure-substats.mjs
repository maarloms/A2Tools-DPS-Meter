// Lokales Messskript (NICHT im Worker): sammelt beobachtete Zufallswerte (subStats) von Ausrüstung über die
// öffentlichen NCSOFT-Endpunkte (docs/ncsoft-character-api.md) und leitet Min/Max + Häufigkeiten ab.
//   node scripts/measure-substats.mjs [--region eu] [--max 400] [--out public/data/substat-observed.json]
// Regeln: nur GET, keine Anmeldung, höchstens 1 Anfrage/s, hartes Limit (--max, Standard 400), Abbruch bei 429
// oder 5 Fehlern in Folge. Ergebnis ist BEOBACHTET (Stichprobe), keine offiziellen Spielwerte.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const REGION = arg("region", "eu");
const MAX = Math.min(Number(arg("max", "400")), 400);
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", arg("out", "public/data/substat-observed.json"));
const LANG = "en-US";
const GAME = "https://aion2.plaync.com";
const SEARCH = "https://api-search.plaync.com/aion2global/search/v2/character";
const MIN_GRADES = new Set(["Legend", "Unique", "Epic", "Ultimate"]); // niedrige Qualität hat meist keine Zufallswerte
const KEYWORDS = ["an", "el", "ar", "ia"]; // wenige Suchen, jeweils nach Stufe sortiert

let used = 0;
let errStreak = 0;
let last = 0;
async function get(url, params) {
  if (used >= MAX) throw new Error("limit");
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  used++;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { accept: "application/json", "user-agent": "a2dps-measure/1 (einmalige Stichprobe)" }, redirect: "manual" });
  if (r.status === 429) throw new Error("429 – Abbruch");
  if (!r.ok) {
    if (++errStreak >= 5) throw new Error("5 Fehler in Folge – Abbruch");
    return null;
  }
  errStreak = 0;
  return r.json();
}

const chars = new Map();
const stats = new Map(); // key → { slot, itemLevel, grade, id, name, values: {v: n} }
let items = 0;

try {
  for (const kw of KEYWORDS) {
    const j = await get(SEARCH, { keyword: kw, region: REGION, localeInfo: LANG, page: 1, size: 40, sort: "level" });
    for (const c of j?.list ?? []) if (c.level >= 45 && !chars.has(c.characterId)) chars.set(c.characterId, c);
  }
  console.log(`Kandidaten: ${chars.size}, Anfragen bisher: ${used}`);
  for (const c of chars.values()) {
    if (used >= MAX - 2) break;
    const id = decodeURIComponent(c.characterId);
    const base = { lang: LANG, region: REGION, characterId: id, serverId: c.serverId };
    const eq = await get(`${GAME}/api/character/equipment`, base);
    for (const it of eq?.equipment?.equipmentList ?? []) {
      if (used >= MAX) break;
      if (!MIN_GRADES.has(it.grade) || it.slotPos === 1 || it.slotPos === 2) continue; // Waffen/Schild: andere Würfe, hier ausgelassen
      const d = await get(`${GAME}/api/character/equipment/item`, { ...base, id: it.id, enchantLevel: it.enchantLevel, slotPos: it.slotPos });
      if (!d) continue;
      items++;
      for (const s of d.subStats ?? []) {
        const key = `${it.slotPosName}|${d.level}|${d.grade}|${s.id}`;
        const e = stats.get(key) ?? { slot: it.slotPosName, itemLevel: d.level, grade: d.grade, stat: s.id, name: s.name, values: {} };
        const v = String(s.value);
        e.values[v] = (e.values[v] ?? 0) + 1;
        stats.set(key, e);
      }
    }
  }
} catch (e) {
  console.error(`Stopp: ${e.message}`);
}

const entries = [...stats.values()]
  .map((e) => {
    const nums = Object.entries(e.values).flatMap(([v, n]) => Array(n).fill(Number(v))).filter(Number.isFinite);
    return {
      slot: e.slot,
      itemLevel: e.itemLevel,
      grade: e.grade,
      stat: e.stat,
      name: e.name,
      samples: nums.length,
      min: Math.min(...nums),
      max: Math.max(...nums),
      mean: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100,
      histogram: Object.fromEntries(Object.entries(e.values).sort((a, b) => Number(a[0]) - Number(b[0]))),
    };
  })
  .sort((a, b) => a.slot.localeCompare(b.slot) || a.itemLevel - b.itemLevel || a.stat.localeCompare(b.stat));

const out = {
  kind: "observed",
  note: "BEOBACHTET: Stichprobe echter Charaktere über öffentliche NCSOFT-Abfragen, keine offiziellen Spielwerte. Min/Max sind nur die gesehenen Extreme und können bei kleiner Stichprobe zu eng sein.",
  generated: new Date().toISOString().slice(0, 10),
  region: REGION,
  requests: used,
  characterCandidates: chars.size,
  itemsRead: items,
  entries,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`Anfragen: ${used}, Items: ${items}, Einträge: ${entries.length} → ${OUT}`);
