// Entwurf F: "Magazin-Cover" – Titelblatt "Gildenblatt": MVP groß als Titelgeschichte (Klassensymbol,
// später Portrait), Schlagzeilen zu Kills und Bossen, Störer mit der DPS-Entwicklung, Strichcode mit KW.
import { h, svg, avatar, svgUrl, jobIcon, img } from "../lib.mjs";
import { jobOf } from "../lib.mjs";
import { fmtShort, fmtDuration, fmtPct, pct, fmt0, trunc } from "../format.mjs";

/** Daten des aktuellen Bilds (build() setzt sie; die Hilfsfunktionen lesen sie) */
let r;
let R;

export const size = { width: 1200, height: 675 };

const PAPER = "#f3ede1";
const INK = "#141414";
const RED = "#d0142c";
const GREY = "#5b5650";
const YELLOW = "#ffd23f";

const paper = svgUrl(1200, 675, `
  <defs>
    <filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="5"/>
      <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0.07 0"/></filter>
  </defs>
  <rect width="1200" height="675" fill="${PAPER}"/>
  <rect width="1200" height="675" filter="url(#g)"/>`);

/** Störer: Zackenkreis mit Text */
function burst(top, sub) {
  const pts = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r = i % 2 ? 84 : 72;
    pts.push(`${(88 + Math.cos(a) * r).toFixed(1)},${(88 + Math.sin(a) * r).toFixed(1)}`);
  }
  return h(
    {
      position: "absolute", left: 360, top: 200, width: 176, height: 176, alignItems: "center", justifyContent: "center",
      flexDirection: "column", transform: "rotate(-12deg)",
      backgroundImage: svgUrl(176, 176, `<polygon points="${pts.join(" ")}" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>`),
    },
    h({ fontFamily: "Anton", fontSize: 40, color: INK, lineHeight: 1 }, top),
    h({ fontFamily: "Anton", fontSize: 17, color: INK, letterSpacing: 1, marginTop: 2 }, sub),
  );
}

/** Strichcode aus der Kalenderwoche (rein dekorativ) */
function barcode(label) {
  let x = 0, body = "";
  const seq = `${label}AION2`.split("").map((c) => c.charCodeAt(0));
  for (let i = 0; i < 46; i++) {
    const w = 1 + ((seq[i % seq.length] + i * 7) % 3);
    if (i % 2 === 0) body += `<rect x="${x}" y="0" width="${w}" height="54" fill="${INK}"/>`;
    x += w + 1;
  }
  return h(
    { flexDirection: "column", alignItems: "center", backgroundColor: "#fff", padding: "8px 10px 4px" },
    svg(Math.ceil(x), 54, body),
    h({ fontFamily: "Inter", fontWeight: 700, fontSize: 12, color: INK, letterSpacing: 2, marginTop: 2 }, label),
  );
}

function coverline(kicker, head, sub) {
  return h(
    { flexDirection: "column", marginBottom: 16 },
    kicker ? h({ fontFamily: "Inter", fontWeight: 800, fontSize: 14, color: RED, letterSpacing: 2.5 }, kicker) : null,
    h({ fontFamily: "Anton", fontSize: 40, color: INK, lineHeight: 1.05, textTransform: "uppercase" }, head),
    sub ? h({ fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700, fontSize: 19, color: GREY, marginTop: 2 }, sub) : null,
  );
}

const article = (job) => (jobOf(job).name === "Assassine" ? "Die" : "Der");

export function build(data) {
  r = R = data;
  const [mvp, p2, p3] = r.players;
  const col = jobOf(mvp.job).color;
  const topBoss = [...r.bosses].sort((a, b) => b.kills - a.kills || b.tries - a.tries)[0];
  const more = r.kills - r.prevKills;
  return h(
    { width: 1200, height: 675, position: "relative", flexDirection: "column", backgroundColor: PAPER, backgroundImage: paper },
    // Kopfleiste
    h(
      { width: 1200 - 80, padding: "18px 40px 0", justifyContent: "space-between", alignItems: "center" },
      h({ fontFamily: "Inter", fontWeight: 800, fontSize: 14, color: INK, letterSpacing: 3 }, `AUSGABE KW ${r.week.kw} · ${r.week.label}`),
      h({ fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700, fontSize: 17, color: GREY }, `Das Magazin der Gilde ${r.guild}`),
    ),
    // Titel
    h(
      { paddingLeft: 36, marginTop: -8, alignItems: "flex-end" },
      h({ fontFamily: "Playfair", fontWeight: 900, fontSize: 128, color: RED, lineHeight: 1, letterSpacing: -3 }, "Gildenblatt"),
      h({ fontFamily: "Inter", fontWeight: 900, fontSize: 18, color: INK, marginLeft: 18, marginBottom: 24, letterSpacing: 4 }, "WOCHENRÜCKBLICK"),
    ),
    h({ width: 1128, height: 4, marginLeft: 36, backgroundColor: INK }),
    // Inhalt
    h(
      { paddingLeft: 36, paddingRight: 36, marginTop: 18, width: 1128 },
      // Titelgeschichte
      h(
        { width: 560, height: 470, position: "relative" },
        // Bildfläche (Portrait-Platz)
        h(
          {
            position: "absolute", left: 0, top: 0, width: 300, height: 360, borderRadius: 6, alignItems: "center", justifyContent: "center",
            backgroundImage: `radial-gradient(circle at 50% 40%, ${col} 0%, ${col}99 35%, #1a1a1a 100%)`,
            border: `5px solid ${INK}`,
          },
          avatar(mvp, 290, 350, 0.42),
          h({ position: "absolute", left: 0, bottom: 10, width: 290, justifyContent: "center", fontFamily: "Anton", fontSize: 34, color: "#ffffff", letterSpacing: 4, opacity: 0.9 },
            jobOf(mvp.job).name.toUpperCase()),
        ),
        h(
          { position: "absolute", left: 318, top: 0, flexDirection: "column", width: 242 },
          h({ backgroundColor: RED, padding: "4px 10px", fontFamily: "Inter", fontWeight: 900, fontSize: 16, color: "#fff", letterSpacing: 3 }, "MVP DER WOCHE"),
          h({ fontFamily: "Anton", fontSize: 78, color: INK, lineHeight: 1.0, marginTop: 8, textTransform: "uppercase" }, mvp.name),
          h({ fontFamily: "Anton", fontSize: 54, color: RED, lineHeight: 1.0 }, fmtShort(mvp.dps)),
          h({ fontFamily: "Inter", fontWeight: 800, fontSize: 15, color: INK, letterSpacing: 3, marginTop: 2 }, "DPS IM BESTEN KAMPF"),
        ),
        h(
          { position: "absolute", left: 0, top: 378, width: 380, fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700, fontSize: 25, color: INK, lineHeight: 1.2 },
          `${article(mvp.job)} ${jobOf(mvp.job).name}, vor der ${mvp.boss} zitterte`,
        ),
        burst(fmtPct(r.dpsChange).replace(" %", "%"), "Ø DPS JE BOSS"),
      ),
      // Schlagzeilen
      h(
        { flexDirection: "column", flex: 1, marginLeft: 30, paddingLeft: 26, borderLeft: `2px solid ${INK}` },
        coverline("DIE BILANZ", `${fmt0(r.kills)} Kills in ${fmt0(r.fights)} Kämpfen`,
          more > 0 ? `${fmt0(more)} mehr als letzte Woche (${fmtPct(pct(r.kills, r.prevKills))})` : more < 0 ? `${fmt0(-more)} weniger als letzte Woche` : "so viele wie letzte Woche"),
        topBoss ? coverline("BOSS DER WOCHE", `${topBoss.boss} fällt ${topBoss.kills}-mal`, `${topBoss.kills} Siege aus ${topBoss.tries} Versuchen`) : null,
        coverline("REKORD", `${fmtShort(r.best.groupDps)} Gruppen-DPS`, `gegen ${r.best.boss}, besiegt in ${fmtDuration(r.best.durationMs)}`),
        h(
          { alignItems: "center", marginTop: 2 },
          h({ fontFamily: "Inter", fontWeight: 800, fontSize: 14, color: RED, letterSpacing: 2.5, marginRight: 10 }, "AUSSERDEM"),
          [p2, p3].filter(Boolean).map((p, i) =>
            h(
              { alignItems: "center", marginRight: 16 },
              img(jobIcon(p.job), 26, 27, { marginRight: 6 }),
              h({ fontFamily: "Anton", fontSize: 22, color: INK }, `${p.name} #${i + 2}`),
            ),
          ),
        ),
        h(
          { marginTop: "auto", marginBottom: 26, justifyContent: "space-between", alignItems: "flex-end" },
          h({ fontFamily: "Inter", fontSize: 13, color: GREY, width: 260 }, "AION2 DPS Meter · nur Mitglieder, ohne Feldbosse und Training"),
          barcode(`KW${r.week.kw}/${r.week.label.slice(-4)}`),
        ),
      ),
    ),
  );
}
