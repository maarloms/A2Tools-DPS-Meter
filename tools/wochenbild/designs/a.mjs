// Entwurf A: "Gilden-Trophäe" – Podium in Nachtblau/Gold, Cinzel wie das Dashboard (Theme Atreia Gold).
import { h, img, svg, jobIcon } from "../lib.mjs";
import { jobOf } from "../lib.mjs";
import { fmtShort, fmtDuration, fmtPct, pct, fmt0, trunc } from "../format.mjs";

/** Daten des aktuellen Bilds (build() setzt sie; die Hilfsfunktionen lesen sie) */
let r;
let R;

export const size = { width: 1200, height: 675 };

const GOLD = "#d4af69";
const TEXT = "#e7e3d8";
const MUTED = "#9ea3bb";
const GOOD = "#6fd39a";
const BAD = "#e88a8f";
const MEDAL = [
  { ring: "#f3d78f", deep: "#a87a2c", glow: "rgba(243,215,143,0.55)", label: "I" },
  { ring: "#d9dde8", deep: "#7c8296", glow: "rgba(217,221,232,0.40)", label: "II" },
  { ring: "#e0a26a", deep: "#8a5426", glow: "rgba(224,162,106,0.40)", label: "III" },
];

const ornament = (w) =>
  svg(w, 14, `
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${GOLD}" stop-opacity="0"/><stop offset=".5" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></linearGradient></defs>
    <rect x="0" y="6.5" width="${w}" height="1" fill="url(#g)"/>
    <path d="M${w / 2} 0 L${w / 2 + 7} 7 L${w / 2} 14 L${w / 2 - 7} 7 Z" fill="${GOLD}"/>
    <path d="M${w / 2 - 22} 4 L${w / 2 - 19} 7 L${w / 2 - 22} 10 L${w / 2 - 25} 7 Z" fill="${GOLD}" opacity=".7"/>
    <path d="M${w / 2 + 22} 4 L${w / 2 + 25} 7 L${w / 2 + 22} 10 L${w / 2 + 19} 7 Z" fill="${GOLD}" opacity=".7"/>`);

const corner = (rot, pos) =>
  svg(46, 46, `<g transform="rotate(${rot} 23 23)" fill="none" stroke="${GOLD}" stroke-width="1.6">
    <path d="M3 30 L3 3 L30 3"/><path d="M9 22 L9 9 L22 9" opacity=".55"/><circle cx="3" cy="3" r="2.6" fill="${GOLD}"/></g>`, { position: "absolute", ...pos });

function podiumSlot(p, rank, pedestal) {
  const m = MEDAL[rank];
  const big = rank === 0;
  const ring = big ? 124 : 104;
  return h(
    { flexDirection: "column", alignItems: "center", width: big ? 250 : 220 },
    // Klassensymbol im Medaillenring
    h(
      {
        width: ring, height: ring, borderRadius: ring, alignItems: "center", justifyContent: "center",
        backgroundImage: `radial-gradient(circle at 50% 35%, #26304f, #0d1224)`,
        border: `4px solid ${m.ring}`, boxShadow: `0 0 28px ${m.glow}`,
      },
      img(jobIcon(p.job), big ? 66 : 54, big ? 69 : 57),
    ),
    h({ marginTop: 12, fontFamily: "Inter", fontWeight: 800, fontSize: big ? 34 : 28, color: TEXT }, p.name),
    h({ fontFamily: "Cinzel", fontWeight: 900, fontSize: big ? 50 : 40, color: m.ring, lineHeight: 1.05, textShadow: `0 0 18px ${m.glow}` }, fmtShort(p.dps)),
    h({ fontFamily: "Inter", fontWeight: 500, fontSize: 17, color: MUTED, marginTop: 2 }, `${jobOf(p.job).name} · DPS`),
    // Sockel
    h(
      {
        marginTop: 14, width: big ? 230 : 200, height: pedestal, alignItems: "flex-start", justifyContent: "center",
        borderTopLeftRadius: 10, borderTopRightRadius: 10,
        backgroundImage: `linear-gradient(180deg, ${m.deep}cc 0%, #151b33 70%)`,
        borderTop: `3px solid ${m.ring}`, paddingTop: big ? 14 : 10,
      },
      h({ fontFamily: "Cinzel", fontWeight: 900, fontSize: big ? 54 : rank === 1 ? 42 : 34, lineHeight: 1, color: "rgba(255,255,255,0.85)" }, m.label),
    ),
  );
}

function stat(label, value, delta, sub) {
  return h(
    { flexDirection: "column", paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(212,175,105,0.18)" },
    h({ fontFamily: "Inter", fontWeight: 600, fontSize: 16, letterSpacing: 2.5, color: MUTED, textTransform: "uppercase" }, label),
    h(
      { alignItems: "flex-end", marginTop: 2 },
      h({ fontFamily: "Cinzel", fontWeight: 900, fontSize: 44, color: TEXT, lineHeight: 1 }, value),
      delta !== null
        ? h({ marginLeft: 14, marginBottom: 4, fontFamily: "Inter", fontWeight: 800, fontSize: 22, color: delta >= 0 ? GOOD : BAD }, `${delta >= 0 ? "↑" : "↓"} ${fmtPct(delta)}`)
        : null,
    ),
    sub ? h({ fontFamily: "Inter", fontSize: 16, color: MUTED, marginTop: 4 }, sub) : null,
  );
}

export function build(data) {
  r = R = data;
  const [p1, p2, p3] = r.players;
  return h(
    {
      width: 1200, height: 675, position: "relative", flexDirection: "column",
      backgroundImage: "radial-gradient(ellipse 70% 55% at 38% 0%, rgba(212,175,105,0.22), rgba(11,15,29,0) 70%), linear-gradient(180deg, #0b0f1d 0%, #10162b 100%)",
      backgroundColor: "#0b0f1d",
    },
    // Rahmen
    h({ position: "absolute", left: 16, top: 16, width: 1168, height: 643, border: "1px solid rgba(212,175,105,0.35)", borderRadius: 14 }),
    corner(0, { left: 10, top: 10 }), corner(90, { right: 10, top: 10 }), corner(270, { left: 10, bottom: 10 }), corner(180, { right: 10, bottom: 10 }),

    // Kopf
    h(
      { flexDirection: "column", alignItems: "center", marginTop: 30 },
      h({ fontFamily: "Cinzel", fontWeight: 700, fontSize: 20, letterSpacing: 8, color: GOLD }, `GILDE ${r.guild.toUpperCase()}`),
      h(
        {
          fontFamily: "Cinzel", fontWeight: 900, fontSize: 62, letterSpacing: 4, lineHeight: 1.1,
          backgroundImage: "linear-gradient(180deg, #fbefc8 10%, #d4af69 55%, #9c7434 100%)", backgroundClip: "text", color: "transparent",
        },
        "WOCHENRÜCKBLICK",
      ),
      h({ marginTop: 2 }, ornament(520)),
      h({ fontFamily: "Inter", fontWeight: 500, fontSize: 20, color: MUTED, marginTop: 6, letterSpacing: 1 }, `${r.week.label}  ·  Reset zu Reset`),
    ),

    // Hauptteil: Podium links, Kennzahlen rechts
    h(
      { height: 478, paddingLeft: 48, paddingRight: 56, marginTop: 4 },
      h(
        { width: 700, alignItems: "flex-end", justifyContent: "center", paddingBottom: 0 },
        p2 ? podiumSlot(p2, 1, 88) : h({ width: 220 }), podiumSlot(p1, 0, 120), p3 ? podiumSlot(p3, 2, 64) : h({ width: 220 }),
      ),
      h(
        { flexDirection: "column", flex: 1, marginLeft: 36, justifyContent: "center", paddingBottom: 10 },
        stat("Boss-Kills", fmt0(r.kills), pct(r.kills, r.prevKills), `aus ${fmt0(r.fights)} Bosskämpfen · Vorwoche ${fmt0(r.prevKills)}`),
        stat("Ø DPS je Boss", fmtPct(r.dpsChange), null, "gegenüber der Vorwoche"),
        h(
          { flexDirection: "column", paddingTop: 14 },
          h({ fontFamily: "Inter", fontWeight: 600, fontSize: 16, letterSpacing: 2.5, color: MUTED }, "BESTER KAMPF"),
          h({ fontFamily: "Cinzel", fontWeight: 700, fontSize: 25, color: GOLD, marginTop: 4 }, r.best.boss),
          h({ fontFamily: "Inter", fontWeight: 600, fontSize: 19, color: TEXT, marginTop: 2 }, `${fmtShort(r.best.groupDps)} Gruppen-DPS · ${fmtDuration(r.best.durationMs)} · besiegt`),
        ),
        h({ marginTop: 22, fontFamily: "Inter", fontSize: 14, color: "rgba(158,163,187,0.7)" }, "AION2 DPS Meter · nur Mitglieder · ohne Feldbosse"),
      ),
    ),
  );
}
