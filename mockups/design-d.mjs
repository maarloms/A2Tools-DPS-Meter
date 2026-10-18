// Entwurf D: "Sammelkarten" – die Top 3 als Trading-Cards nebeneinander, Rahmen nach Rang (Holo-Gold,
// Silber, Bronze), Kartenbild = Klassensymbol (später Portrait), Gruppenwerte als Leiste darunter.
import { h, svg, avatar } from "./lib.mjs";
import { recap as R, JOBS, fmtShort, fmtDuration, fmtPct, pct, fmt0 } from "./data.mjs";

export const size = { width: 1200, height: 675 };

const TEXT = "#f5f2ff";
const MUTED = "#a9a3c9";
const GOOD = "#7cf0b0";
const BAD = "#ff8a9a";

// Rang → Rahmen, Seltenheit
const TIER = [
  {
    rarity: "LEGENDÄR", stars: 5,
    frame: "linear-gradient(135deg, #fff1b8 0%, #f2c14e 18%, #ff9ad5 36%, #9ad8ff 54%, #c6ffb0 70%, #f2c14e 86%, #fff1b8 100%)",
    inner: "linear-gradient(180deg, #3a2a10 0%, #1b1430 100%)", accent: "#ffd66b", art: ["#ff9ad5", "#7f6bff", "#3be0ff"],
  },
  {
    rarity: "EPISCH", stars: 4,
    frame: "linear-gradient(135deg, #ffffff 0%, #b9c2d6 30%, #eef2fb 50%, #8e97ad 75%, #e6ebf5 100%)",
    inner: "linear-gradient(180deg, #252b3d 0%, #151a2a 100%)", accent: "#dfe6f5", art: ["#8fb7ff", "#4c5d9c", "#a6f0ff"],
  },
  {
    rarity: "SELTEN", stars: 3,
    frame: "linear-gradient(135deg, #ffd2a8 0%, #c47a3c 35%, #f0b07a 55%, #8a4f22 80%, #e9a56b 100%)",
    inner: "linear-gradient(180deg, #33200f 0%, #1d1424 100%)", accent: "#f2b27a", art: ["#ffb27a", "#9c4b6b", "#ffd9a0"],
  },
];

/** Holo-Schimmer: schräge Regenbogen-Streifen über dem Kartenbild */
const holo = (w, hgt, strong) =>
  svg(w, hgt, `
    <defs>
      <linearGradient id="h" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff5ec4" stop-opacity="${strong ? 0.35 : 0.12}"/>
        <stop offset=".25" stop-color="#ffe45e" stop-opacity="${strong ? 0.3 : 0.1}"/>
        <stop offset=".5" stop-color="#5effc8" stop-opacity="${strong ? 0.3 : 0.1}"/>
        <stop offset=".75" stop-color="#5ec8ff" stop-opacity="${strong ? 0.35 : 0.12}"/>
        <stop offset="1" stop-color="#c45eff" stop-opacity="${strong ? 0.3 : 0.1}"/>
      </linearGradient>
      <pattern id="s" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="7" height="18" fill="#ffffff" fill-opacity="${strong ? 0.10 : 0.05}"/>
      </pattern>
    </defs>
    <clipPath id="c"><rect width="${w}" height="${hgt}" rx="7"/></clipPath>
    <g clip-path="url(#c)">
    <rect width="${w}" height="${hgt}" fill="url(#h)"/>
    <rect width="${w}" height="${hgt}" fill="url(#s)"/>
    <circle cx="${w * 0.78}" cy="${hgt * 0.2}" r="${hgt * 0.5}" fill="#ffffff" fill-opacity="${strong ? 0.10 : 0.05}"/></g>`,
  { position: "absolute", left: 0, top: 0 });

const star = (on, c) =>
  svg(18, 18, `<path d="M9 1 L11.3 6.4 L17 6.9 L12.6 10.6 L14 16.3 L9 13.3 L4 16.3 L5.4 10.6 L1 6.9 L6.7 6.4 Z" fill="${on ? c : "none"}" stroke="${c}" stroke-width="1.2"/>`);

function card(p, rank, scale) {
  const t = TIER[rank];
  const W = Math.round(300 * scale);
  const H = Math.round(432 * scale);
  const pad = Math.round(10 * scale);
  const iw = W - 2 * pad;
  const artH = Math.round(208 * scale);
  const f = (n) => Math.round(n * scale);
  return h(
    // Rahmen = Verlauf, Inhalt mit Abstand darauf
    {
      width: W - 2 * pad, height: H - 2 * pad, padding: pad, borderRadius: f(20), backgroundImage: t.frame, flexDirection: "column",
      boxShadow: rank === 0 ? "0 0 40px rgba(255,214,107,0.45)" : "0 10px 30px rgba(0,0,0,0.5)",
    },
    h(
      { width: iw, height: H - 2 * pad, borderRadius: f(13), backgroundImage: t.inner, flexDirection: "column" },
      // Kopfzeile: Name + Rang
      h(
        { width: iw - f(28), height: f(52), padding: `0 ${f(14)}px`, alignItems: "center", justifyContent: "space-between" },
        h({ fontFamily: "Inter", fontWeight: 900, fontSize: f(27), color: TEXT, letterSpacing: 0.5 }, p.name),
        h(
          { width: f(42), height: f(42), borderRadius: f(42), alignItems: "center", justifyContent: "center", backgroundImage: t.frame },
          h({ fontFamily: "Inter", fontWeight: 900, fontSize: f(20), color: "#1a1424" }, `#${rank + 1}`),
        ),
      ),
      // Kartenbild (Platz für späteres Portrait)
      h(
        {
          width: iw - f(20), height: artH, marginLeft: f(10), borderRadius: f(8), position: "relative",
          backgroundImage: `radial-gradient(circle at 50% 40%, ${t.art[0]}cc 0%, ${t.art[1]}aa 45%, #0d0a18 100%)`,
          border: `2px solid ${t.accent}`,
        },
        holo(iw - f(20), artH, rank === 0),
        avatar(p, iw - f(20), artH, 0.5),
      ),
      // Typzeile
      h(
        { width: iw - f(20), marginLeft: f(10), marginTop: f(8), height: f(30), alignItems: "center", justifyContent: "space-between",
          borderTop: `1px solid ${t.accent}55`, borderBottom: `1px solid ${t.accent}55` },
        h({ fontFamily: "Inter", fontWeight: 700, fontSize: f(15), color: t.accent, letterSpacing: 1.5 }, JOBS[p.job].name.toUpperCase()),
        h({}, [0, 1, 2, 3, 4].map((i) => star(i < t.stars, t.accent))),
      ),
      // Wert
      h(
        { flexDirection: "column", alignItems: "center", marginTop: f(8) },
        h({ fontFamily: "Inter", fontWeight: 900, fontSize: f(56), color: TEXT, lineHeight: 1 }, fmtShort(p.dps)),
        h({ fontFamily: "Inter", fontWeight: 700, fontSize: f(14), color: MUTED, letterSpacing: 3, marginTop: f(2) }, "DPS · BESTER KAMPF"),
        h({ fontFamily: "Inter", fontWeight: 600, fontSize: f(15), color: TEXT, marginTop: f(6), opacity: 0.85 }, p.boss),
      ),
      // Fuß
      h(
        { width: iw - f(28), padding: `0 ${f(14)}px`, marginTop: "auto", marginBottom: f(10), justifyContent: "space-between" },
        h({ fontFamily: "Inter", fontWeight: 800, fontSize: f(12), color: t.accent, letterSpacing: 2 }, t.rarity),
        h({ fontFamily: "Inter", fontWeight: 600, fontSize: f(12), color: MUTED }, `${String(rank + 1).padStart(3, "0")}/${String(R.players.length).padStart(3, "0")} · KW ${R.week.kw}`),
      ),
    ),
  );
}

function stat(label, value, delta) {
  return h(
    { flexDirection: "column", alignItems: "center", flex: 1 },
    h({ fontFamily: "Inter", fontWeight: 900, fontSize: 34, color: TEXT, lineHeight: 1 }, value),
    h(
      { alignItems: "center", marginTop: 4 },
      h({ fontFamily: "Inter", fontWeight: 600, fontSize: 15, color: MUTED, letterSpacing: 1.5 }, label.toUpperCase()),
      delta !== null && delta !== undefined
        ? h({ marginLeft: 8, fontFamily: "Inter", fontWeight: 800, fontSize: 15, color: delta >= 0 ? GOOD : BAD }, `${delta >= 0 ? "↑" : "↓"} ${fmtPct(delta)}`)
        : null,
    ),
  );
}

export function build(r = R) {
  const [p1, p2, p3] = r.players;
  return h(
    {
      width: 1200, height: 675, flexDirection: "column", alignItems: "center", position: "relative",
      backgroundColor: "#120d22",
      backgroundImage: "radial-gradient(ellipse 60% 50% at 50% 38%, rgba(140,90,255,0.35), rgba(18,13,34,0) 70%), linear-gradient(180deg, #160f2b 0%, #0b0816 100%)",
    },
    // Glitzer im Hintergrund
    svg(1200, 675, Array.from({ length: 70 }, (_, i) => {
      const x = (i * 397) % 1200, y = (i * 211) % 675, s = (i % 3) + 1;
      return `<circle cx="${x}" cy="${y}" r="${s * 0.8}" fill="#ffffff" fill-opacity="${0.08 + (i % 5) * 0.05}"/>`;
    }).join(""), { position: "absolute", left: 0, top: 0 }),
    // Kopf
    h(
      { width: 1200 - 96, padding: "26px 48px 0", justifyContent: "space-between", alignItems: "flex-end" },
      h(
        { flexDirection: "column" },
        h({ fontFamily: "Inter", fontWeight: 800, fontSize: 16, letterSpacing: 6, color: "#c9b6ff" }, `GILDE ${r.guild.toUpperCase()} · SAMMLUNG KW ${r.week.kw}`),
        h({ fontFamily: "Inter", fontWeight: 900, fontStyle: "italic", fontSize: 46, color: TEXT, lineHeight: 1.05 }, "Die Karten der Woche"),
      ),
      h({ fontFamily: "Inter", fontWeight: 600, fontSize: 19, color: MUTED, marginBottom: 6 }, r.week.label),
    ),
    // Karten: Mitte groß und vorn, Seiten leicht gedreht
    h(
      { width: 1200, height: 452, alignItems: "center", justifyContent: "center", marginTop: 6 },
      h({ transform: "rotate(-5deg)", marginRight: 26, marginTop: 30 }, card(p2, 1, 0.9)),
      h({ marginTop: -6 }, card(p1, 0, 1)),
      h({ transform: "rotate(5deg)", marginLeft: 26, marginTop: 30 }, card(p3, 2, 0.9)),
    ),
    // Gruppenleiste
    h(
      {
        width: 1104 - 48, height: 82, padding: "0 24px", marginTop: 10, borderRadius: 16, alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(201,182,255,0.25)",
      },
      stat("Bosskämpfe", fmt0(r.fights), pct(r.fights, r.prevFights)),
      stat("Kills", fmt0(r.kills), pct(r.kills, r.prevKills)),
      stat("Ø DPS je Boss", fmtPct(r.dpsChange), null),
      h(
        { flexDirection: "column", alignItems: "center", flex: 1.6 },
        h({ fontFamily: "Inter", fontWeight: 800, fontSize: 21, color: "#ffd66b" }, `${fmtShort(r.best.groupDps)} Gruppen-DPS`),
        h({ fontFamily: "Inter", fontWeight: 600, fontSize: 15, color: MUTED, marginTop: 4 }, `${r.best.boss} · ${fmtDuration(r.best.durationMs)}`),
      ),
    ),
  );
}
