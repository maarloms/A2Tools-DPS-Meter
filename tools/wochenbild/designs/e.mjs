// Entwurf E: "Kriegschronik" – Pergament mit Fraktur-Titel, Fließtext wie von Hand, Strichlisten je Boss,
// rotes Wachssiegel mit der Kalenderwoche. Helden = Top 3 mit Klassensymbol im Medaillon (später Portrait).
import { h, svg, avatar, svgUrl } from "../lib.mjs";
import { jobOf } from "../lib.mjs";
import { fmtShort, fmtDuration, fmtPct, trunc } from "../format.mjs";

/** Daten des aktuellen Bilds (build() setzt sie; die Hilfsfunktionen lesen sie) */
let r;
let R;

export const size = { width: 1200, height: 760 };

const INK = "#3a2414";
const INK2 = "#5c3d22";
const FADED = "#7a5a3a";
const RED = "#8e1c1c";

// ---------- Zahlen in Worten (bis 999, sonst Ziffern) ----------
const ONES = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf",
  "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
function words(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return (n % 10 ? ONES[n % 10] + "und" : "") + TENS[Math.floor(n / 10)];
  return ONES[Math.floor(n / 100)] + "hundert" + (n % 100 ? words(n % 100) : "");
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "einmal", "siebenundvierzig Mal" */
const times = (n) => (n === 1 ? "einmal" : `${words(n)} Mal`);
const ROMAN = ["I", "II", "III"];

// ---------- Pergament ----------
const parchment = svgUrl(1200, 760, `
  <defs>
    <filter id="n" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="7"/>
      <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.30  0 0 0 0 0.15  0 0 0 0.55 0"/>
    </filter>
    <filter id="f" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
      <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0.10 0"/>
    </filter>
    <radialGradient id="v" cx="50%" cy="48%" r="72%">
      <stop offset="0.55" stop-color="#5a3510" stop-opacity="0"/>
      <stop offset="0.9" stop-color="#5a3510" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#3a1f08" stop-opacity="0.8"/>
    </radialGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4e4c1"/><stop offset=".5" stop-color="#ead2a2"/><stop offset="1" stop-color="#e2c48e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="760" fill="url(#b)"/>
  <rect width="1200" height="760" filter="url(#n)" opacity="0.55"/>
  <rect width="1200" height="760" filter="url(#f)"/>
  <rect width="1200" height="760" fill="url(#v)"/>
  <rect x="26" y="26" width="1148" height="708" fill="none" stroke="${INK2}" stroke-opacity=".55" stroke-width="2"/>
  <rect x="34" y="34" width="1132" height="692" fill="none" stroke="${INK2}" stroke-opacity=".35" stroke-width="1"/>`);

/** Zierlinie mit Raute */
const flourish = (w) =>
  svg(w, 22, `
    <path d="M0 11 C ${w * 0.2} 11, ${w * 0.3} 4, ${w / 2 - 18} 11" stroke="${INK2}" stroke-width="1.6" fill="none"/>
    <path d="M${w} 11 C ${w * 0.8} 11, ${w * 0.7} 18, ${w / 2 + 18} 11" stroke="${INK2}" stroke-width="1.6" fill="none"/>
    <path d="M${w / 2} 3 L${w / 2 + 9} 11 L${w / 2} 19 L${w / 2 - 9} 11 Z" fill="${RED}"/>
    <circle cx="${w / 2 - 15}" cy="11" r="2.2" fill="${INK2}"/><circle cx="${w / 2 + 15}" cy="11" r="2.2" fill="${INK2}"/>`);

/** Strichliste: je 5 ein Bündel (4 senkrecht + 1 quer), leicht zittrig wie Tinte */
function tally(n, max = 15) {
  const shown = Math.min(n, max);
  const groups = Math.ceil(shown / 5);
  const W = Math.max(1, groups) * 34;
  let body = "";
  for (let i = 0; i < shown; i++) {
    const g = Math.floor(i / 5), k = i % 5, x0 = g * 34;
    if (k < 4) {
      const x = x0 + 4 + k * 6.5;
      body += `<path d="M${x} ${4 + (i % 2)} L${x + 1} 26" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
    } else {
      body += `<path d="M${x0 + 1} 21 L${x0 + 28} 8" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
  }
  return svg(W, 30, body);
}

/** Wachssiegel mit unregelmäßigem Rand */
function seal(text) {
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = 62 + (i % 2 ? 5 : -2) + ((i * 7) % 5);
    pts.push(`${(75 + Math.cos(a) * r).toFixed(1)},${(75 + Math.sin(a) * r).toFixed(1)}`);
  }
  return h(
    {
      position: "absolute", right: 52, bottom: 40, width: 150, height: 150, alignItems: "center", justifyContent: "center",
      backgroundImage: svgUrl(150, 150, `
      <defs><radialGradient id="w" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#c8423a"/><stop offset=".6" stop-color="${RED}"/><stop offset="1" stop-color="#4f0b0b"/></radialGradient></defs>
      <polygon points="${pts.join(" ")}" fill="url(#w)"/>
      <circle cx="75" cy="75" r="46" fill="none" stroke="#5a0d0d" stroke-width="3" opacity=".7"/>
      <circle cx="75" cy="75" r="40" fill="none" stroke="#e07a6e" stroke-width="1" opacity=".5"/>`),
    },
    h(
      { flexDirection: "column", alignItems: "center" },
      h({ fontFamily: "Fell", fontSize: 14, color: "#f2b9a8", letterSpacing: 2, lineHeight: 1 }, "WOCHE"),
      h({ fontFamily: "Fraktur", fontSize: 44, color: "#f7d2c4", lineHeight: 1 }, text),
    ),
  );
}

function hero(p, i) {
  const ring = 74;
  return h(
    { alignItems: "center", marginTop: i ? 12 : 6 },
    h({ width: 54, fontFamily: "Fell", fontSize: 34, color: RED, justifyContent: "center" }, ROMAN[i]),
    h(
      {
        width: ring, height: ring, borderRadius: ring, alignItems: "center", justifyContent: "center",
        border: `3px solid ${INK2}`, backgroundImage: "radial-gradient(circle at 45% 35%, #f6e7c8, #c9a46a)", marginRight: 16,
      },
      h({ width: ring - 6, height: ring - 6, borderRadius: ring, alignItems: "center", justifyContent: "center", opacity: 0.92 }, avatar(p, ring - 6, ring - 6, 0.7)),
    ),
    h(
      { flexDirection: "column" },
      h(
        { alignItems: "baseline" },
        h({ fontFamily: "Caveat", fontWeight: 700, fontSize: 44, color: INK, lineHeight: 1 }, p.name),
        h({ fontFamily: "Fell", fontStyle: "italic", fontSize: 20, color: FADED, marginLeft: 12 }, `die ${jobOf(p.job).name}`.replace("die Gladiator", "der Gladiator").replace(/die (Templer|Waldläufer|Magier|Beschwörer|Kleriker|Kantor|Faustkämpfer)/, "der $1")),
      ),
      h({ fontFamily: "Fell", fontSize: 21, color: INK2, marginTop: 2 }, `${fmtShort(p.dps)} DPS wider ${p.boss}`),
    ),
  );
}

function bossLine(b) {
  return h(
    { flexDirection: "column", marginBottom: 10 },
    h(
      { alignItems: "baseline", justifyContent: "space-between" },
      h({ fontFamily: "Fell", fontSize: 23, color: INK }, b.boss),
      h({ fontFamily: "Caveat", fontWeight: 700, fontSize: 26, color: INK2 }, `${b.kills} von ${b.tries}`),
    ),
    h({ alignItems: "center", marginTop: -2 }, tally(b.kills)),
  );
}

export function build(data) {
  r = R = data;
  const moreKills = r.kills - r.prevKills;
  const killText =
    moreKills > 0 ? ` – ${words(moreKills)} ${moreKills === 1 ? "Sieg" : "Siege"} mehr als in der Woche zuvor`
      : moreKills < 0 ? ` – ${words(-moreKills)} weniger als in der Woche zuvor` : " – so oft wie in der Woche zuvor";
  const dps = r.dpsChange === null ? "" : r.dpsChange >= 0
    ? ` Im Mittel schlug sie je Feind um ${fmtPct(r.dpsChange).replace("+", "")} härter zu.`
    : ` Im Mittel schlug sie je Feind um ${fmtPct(r.dpsChange).replace("−", "")} schwächer zu.`;
  const prose = `${cap(times(r.fights))} zog die Gilde gegen die Mächtigen, und ${times(r.kills)} kehrte sie siegreich heim${killText}.${dps}`;

  return h(
    { width: 1200, height: 760, position: "relative", flexDirection: "column", backgroundColor: "#ead2a2", backgroundImage: parchment },
    // Kopf
    h(
      { flexDirection: "column", alignItems: "center", marginTop: 44 },
      h({ fontFamily: "Fell", fontStyle: "italic", fontSize: 22, color: FADED, letterSpacing: 1 }, `Aus den Annalen der Gilde ${r.guild}`),
      h({ fontFamily: "Fraktur", fontSize: 78, color: INK, lineHeight: 1.05 }, "Chronik der Woche"),
      h({ marginTop: 2 }, flourish(560)),
      h({ fontFamily: "Fell", fontSize: 20, color: INK2, marginTop: 4, letterSpacing: 1.5 }, `${r.week.label.replace(" – ", " bis ")}  ·  von Reset zu Reset`),
    ),
    // Inhalt
    h(
      { paddingLeft: 70, paddingRight: 70, marginTop: 22, width: 1200 - 140 },
      // links: Bericht + Helden
      h(
        { flexDirection: "column", width: 620 },
        h(
          { fontFamily: "Fell", fontSize: 24, color: INK, lineHeight: 1.35 },
          prose,
        ),
        h({ fontFamily: "Fell", fontStyle: "italic", fontSize: 26, color: RED, marginTop: 18, letterSpacing: 1 }, "Die Helden der Woche"),
        r.players.slice(0, 3).map(hero),
      ),
      // rechts: Feinde + Ruhmestat
      h(
        { flexDirection: "column", flex: 1, marginLeft: 50, paddingLeft: 30, borderLeft: `1px solid rgba(92,61,34,0.4)` },
        h({ fontFamily: "Fell", fontStyle: "italic", fontSize: 26, color: RED, marginBottom: 8, letterSpacing: 1 }, "Bezwungene Feinde"),
        r.bosses.slice(0, 4).map(bossLine),
        h({ fontFamily: "Fell", fontStyle: "italic", fontSize: 26, color: RED, marginTop: 6, letterSpacing: 1 }, "Die Ruhmestat"),
        h(
          { fontFamily: "Fell", fontSize: 21, color: INK, lineHeight: 1.3, marginTop: 2, width: 200 },
          `${fmtShort(r.best.groupDps)} vereint gegen ${r.best.boss}, gefällt in ${fmtDuration(r.best.durationMs)}.`,
        ),
      ),
    ),
    // Unterschrift
    h(
      { position: "absolute", left: 70, bottom: 46, alignItems: "baseline" },
      h({ fontFamily: "Caveat", fontWeight: 600, fontSize: 26, color: INK2 }, "gez. der Chronist"),
      h({ fontFamily: "Fell", fontStyle: "italic", fontSize: 16, color: FADED, marginLeft: 14 }, "AION2 DPS Meter · nur Mitglieder, ohne Feldbosse"),
    ),
    seal(String(r.week.kw)),
  );
}
