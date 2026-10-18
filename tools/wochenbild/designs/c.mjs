// Entwurf C: "Infografik" – alle Mitglieder als Balken in Klassenfarben, Klassen-Ring, Bosse mit Trend, drei Highlights.
import { h, img, svg, jobIcon } from "../lib.mjs";
import { jobOf } from "../lib.mjs";
import { fmtShort, fmtDuration, fmtPct, pct, fmt0, trunc } from "../format.mjs";

/** Daten des aktuellen Bilds (build() setzt sie; die Hilfsfunktionen lesen sie) */
let r;
let R;

export const size = { width: 1200, height: 760 };

const BG = "#0d1120";
const PANEL = "rgba(255,255,255,0.035)";
const LINE = "rgba(255,255,255,0.08)";
const GOLD = "#d4af69";
const TEXT = "#ecebe6";
const MUTED = "#9ea3bb";
const GOOD = "#6fd39a";
const BAD = "#e88a8f";

const title = (t, extra) =>
  h(
    { alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
    h({ fontFamily: "Cinzel", fontWeight: 700, fontSize: 21, color: GOLD, letterSpacing: 2 }, t),
    extra ? h({ fontFamily: "Inter", fontSize: 14, color: MUTED }, extra) : null,
  );

const panel = (style, ...kids) => h({ flexDirection: "column", backgroundColor: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: "18px 22px", ...style }, ...kids);

function bars() {
  const max = r.players[0].dps;
  return r.players.slice(0, 9).map((p, i) => {
    const col = jobOf(p.job).color;
    const w = Math.max(40, Math.round((p.dps / max) * 300));
    return h(
      { alignItems: "center", height: 44, marginBottom: 4 },
      h({ width: 26, fontFamily: "Inter", fontWeight: 700, fontSize: 16, color: i < 3 ? GOLD : MUTED }, String(i + 1)),
      img(jobIcon(p.job), 30, 32),
      h({ width: 130, marginLeft: 10, fontFamily: "Inter", fontWeight: 700, fontSize: 21, color: TEXT }, p.name),
      h(
        { flex: 1, alignItems: "center" },
        h({ width: w, height: 26, borderRadius: 6, backgroundImage: `linear-gradient(90deg, ${col}55, ${col})` }),
        h({ marginLeft: 12, fontFamily: "Inter", fontWeight: 800, fontSize: 20, color: TEXT }, fmtShort(p.dps)),
      ),
    );
  });
}

/** Klassen-Ring (Anteil am Schaden der Bestwerte) als SVG */
function donut() {
  const by = new Map();
  for (const p of r.players) by.set(p.job, (by.get(p.job) || 0) + p.dps);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([job, v]) => {
    const len = (v / total) * C;
    const s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${jobOf(job).color}" stroke-width="20" stroke-dasharray="${Math.max(0, len - 2.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;
    off += len;
    return s;
  });
  return { svg: svg(140, 140, arcs.join("")), entries: [...by.entries()].sort((a, b) => b[1] - a[1]), total };
}

function bossRow(b) {
  const up = b.change >= 0;
  return h(
    { alignItems: "center", height: 44, borderTop: `1px solid ${LINE}` },
    h(
      { flexDirection: "column", flex: 1, minWidth: 0 },
      h({ fontFamily: "Inter", fontWeight: 700, fontSize: 18, color: TEXT }, b.boss),
      h({ fontFamily: "Inter", fontSize: 13, color: MUTED }, `${b.kills}/${b.tries} besiegt · Ø ${fmtShort(b.avgDps)} DPS`),
    ),
    h(
      { padding: "4px 10px", borderRadius: 8, backgroundColor: up ? "rgba(111,211,154,0.14)" : "rgba(232,138,143,0.14)", fontFamily: "Inter", fontWeight: 800, fontSize: 17, color: up ? GOOD : BAD },
      `${up ? "↑" : "↓"} ${fmtPct(b.change)}`,
    ),
  );
}

function highlight(kicker, main, sub, color) {
  return h(
    { flexDirection: "column", flex: 1, marginRight: 16, padding: "14px 20px", borderRadius: 14, border: `1px solid ${LINE}`,
      backgroundImage: `linear-gradient(135deg, ${color}26, rgba(255,255,255,0.02) 65%)` },
    h({ fontFamily: "Inter", fontWeight: 700, fontSize: 14, letterSpacing: 2.5, color }, kicker.toUpperCase()),
    h({ fontFamily: "Inter", fontWeight: 800, fontSize: 30, color: TEXT, marginTop: 2 }, main),
    h({ fontFamily: "Inter", fontSize: 16, color: MUTED, marginTop: 2 }, sub),
  );
}

export function build(data) {
  r = R = data;
  const d = donut();
  const bestBoss = r.bosses.filter((b) => b.change !== null).sort((a, b) => b.change - a.change)[0];
  return h(
    // Satori rechnet hier Padding zur Breite dazu → Innenmaß angeben
    { width: 1200 - 72, height: 760 - 60, flexDirection: "column", backgroundColor: BG, padding: "30px 36px",
      backgroundImage: "radial-gradient(ellipse 60% 40% at 100% 0%, rgba(212,175,105,0.13), rgba(13,17,32,0) 70%)" },
    // Kopf: Titel links, Zahlen-Chips rechts
    h(
      { alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
      h(
        { flexDirection: "column" },
        h({ fontFamily: "Cinzel", fontWeight: 900, fontSize: 44, color: TEXT, letterSpacing: 2, lineHeight: 1.05 }, "Die Woche in Zahlen"),
        h({ fontFamily: "Inter", fontWeight: 500, fontSize: 19, color: MUTED, marginTop: 4 }, `Gilde ${r.guild}  ·  ${r.week.label}`),
      ),
      h(
        {},
        [
          ["Bosskämpfe", fmt0(r.fights), pct(r.fights, r.prevFights)],
          ["Kills", fmt0(r.kills), pct(r.kills, r.prevKills)],
          ["Ø DPS/Boss", fmtPct(r.dpsChange), null],
        ].map(([k, v, dl]) =>
          h(
            { flexDirection: "column", alignItems: "flex-end", marginLeft: 40 },
            h({ fontFamily: "Inter", fontWeight: 900, fontSize: 40, color: TEXT, lineHeight: 1 }, v),
            h({ fontFamily: "Inter", fontWeight: 600, fontSize: 15, color: MUTED, marginTop: 4 }, k),
            dl !== null ? h({ fontFamily: "Inter", fontWeight: 800, fontSize: 15, color: dl >= 0 ? GOOD : BAD }, `${dl >= 0 ? "↑" : "↓"} ${fmtPct(dl)}`) : h({ fontFamily: "Inter", fontSize: 15, color: MUTED }, "zur Vorwoche"),
          ),
        ),
      ),
    ),
    // Mitte
    h(
      { height: 480 },
      panel({ width: 640, marginRight: 20 }, title("Bestwerte der Mitglieder", "DPS im besten Kampf"), bars()),
      h(
        { flexDirection: "column", width: 468 },
        panel(
          { marginBottom: 14, height: 178 },
          title("Klassen"),
          h(
            { alignItems: "center", marginTop: -6 },
            d.svg,
            h(
              { flexDirection: "column", flexWrap: "wrap", height: 140, marginLeft: 22, width: 250 },
              d.entries.map(([job, v]) =>
                h(
                  { alignItems: "center", height: 28, width: 125 },
                  h({ width: 12, height: 12, borderRadius: 3, backgroundColor: jobOf(job).color, marginRight: 8 }),
                  h({ fontFamily: "Inter", fontWeight: 600, fontSize: 14, color: TEXT }, jobOf(job).name),
                ),
              ),
            ),
          ),
        ),
        panel({ flex: 1, paddingBottom: 8 }, title("Bosse", "gegen Vorwoche"), r.bosses.slice(0, 4).map(bossRow)),
      ),
    ),
    // Highlights
    h(
      { marginTop: 18, marginRight: -16 },
      highlight("Bester Kampf", `${fmtShort(r.best.groupDps)} DPS`, `${r.best.boss} · ${fmtDuration(r.best.durationMs)}`, GOLD),
      r.fastest ? highlight("Schnellster Kill", fmtDuration(r.fastest.durationMs), r.fastest.boss, "#4aa3f0") : highlight("Schnellster Kill", "–", "kein Kill", "#4aa3f0"),
      bestBoss ? highlight("Größter Sprung", fmtPct(bestBoss.change), `Ø DPS · ${bestBoss.boss}`, GOOD) : highlight("Größter Sprung", "–", "kein Vergleich zur Vorwoche", GOOD),
    ),
  );
}
