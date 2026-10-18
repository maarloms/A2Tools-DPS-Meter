// Entwurf B: "Esports-Scoreboard" – Schwarz mit Neon (Cyan/Magenta), MVP-Karte + Rangliste, Kennzahlen-Kacheln.
import { h, img, svg, jobIcon } from "../lib.mjs";
import { jobOf } from "../lib.mjs";
import { fmtShort, fmtDuration, fmtPct, pct, fmt0, trunc } from "../format.mjs";

/** Daten des aktuellen Bilds (build() setzt sie; die Hilfsfunktionen lesen sie) */
let r;
let R;

export const size = { width: 1200, height: 630 };

const CYAN = "#3ee8ff";
const MAG = "#ff3ea5";
const TEXT = "#f2f4ff";
const MUTED = "#8a90b4";
const GOOD = "#5cff9d";
const BAD = "#ff6b7d";

const grid = svg(1200, 675, `
  <defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 L0 0 0 40" fill="none" stroke="#ffffff" stroke-opacity=".045" stroke-width="1"/></pattern>
  <linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient></defs>
  <rect width="1200" height="675" fill="url(#p)"/>
  <path d="M0 520 L1200 300 L1200 306 L0 526 Z" fill="${CYAN}" opacity=".08"/>
  <path d="M0 560 L1200 340 L1200 342 L0 562 Z" fill="${MAG}" opacity=".12"/>
  <rect width="1200" height="675" fill="url(#f)"/>`, { position: "absolute", left: 0, top: 0 });

const label = (t, color = CYAN) =>
  h({ fontFamily: "Inter", fontWeight: 800, fontSize: 15, letterSpacing: 3, color, textTransform: "uppercase" }, t);

function kpi(title, value, delta, accent, suffix) {
  return h(
    {
      flexDirection: "column", flex: 1, marginRight: 14, padding: "14px 18px 12px",
      backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
      border: "1px solid rgba(255,255,255,0.10)", borderLeft: `4px solid ${accent}`, borderRadius: 6,
    },
    label(title, MUTED),
    h(
      { alignItems: "flex-end", marginTop: 2 },
      h({ fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 40, color: TEXT, lineHeight: 1.05 }, value),
      delta !== null && delta !== undefined
        ? h({ marginLeft: 10, marginBottom: 5, fontFamily: "Inter", fontWeight: 800, fontSize: 19, color: delta >= 0 ? GOOD : BAD }, `${delta >= 0 ? "↑" : "↓"} ${fmtPct(delta)}`)
        : null,
      suffix ? h({ marginLeft: 10, marginBottom: 7, fontFamily: "Inter", fontWeight: 700, fontSize: 15, letterSpacing: 2, color: MUTED }, suffix) : null,
    ),
  );
}

function row(p, rank, max) {
  const w = Math.round((p.dps / max) * 330);
  const col = jobOf(p.job).color;
  return h(
    {
      alignItems: "center", height: 54, marginBottom: 8, paddingRight: 18,
      backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.07), rgba(255,255,255,0.015))", borderRadius: 6,
    },
    h(
      { width: 58, height: 54, alignItems: "center", justifyContent: "center", backgroundColor: rank === 2 ? "rgba(62,232,255,0.20)" : "rgba(255,255,255,0.06)", borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
      h({ fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 30, color: rank === 2 ? CYAN : TEXT }, `#${rank}`),
    ),
    h({ width: 4, height: 54, backgroundColor: col }),
    img(jobIcon(p.job), 36, 38, { marginLeft: 14 }),
    h(
      { flexDirection: "column", width: 190, marginLeft: 12 },
      h({ fontFamily: "Inter", fontWeight: 800, fontSize: 24, color: TEXT, lineHeight: 1.1 }, p.name),
      h({ fontFamily: "Inter", fontWeight: 500, fontSize: 14, color: MUTED }, jobOf(p.job).name.toUpperCase()),
    ),
    h(
      { flex: 1, height: 10, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 5 },
      h({ width: w, height: 10, borderRadius: 5, backgroundImage: `linear-gradient(90deg, ${MAG}, ${CYAN})`, boxShadow: `0 0 10px rgba(62,232,255,0.6)` }),
    ),
    h({ width: 120, justifyContent: "flex-end", fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 26, color: TEXT }, fmtShort(p.dps)),
  );
}

export function build(data) {
  r = R = data;
  const [mvp, ...rest] = r.players;
  return h(
    { width: 1200, height: 630, position: "relative", flexDirection: "column", backgroundColor: "#06060c",
      backgroundImage: "radial-gradient(circle at 0% 0%, rgba(255,62,165,0.30), rgba(6,6,12,0) 45%), radial-gradient(circle at 100% 100%, rgba(62,232,255,0.24), rgba(6,6,12,0) 50%)" },
    grid,
    // Kopfzeile
    h(
      { alignItems: "center", justifyContent: "space-between", padding: "30px 40px 0" },
      h(
        { alignItems: "center" },
        h(
          { backgroundColor: MAG, padding: "6px 14px", transform: "skewX(-12deg)", marginRight: 18, boxShadow: `0 0 18px rgba(255,62,165,0.7)` },
          h({ fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 24, color: "#fff", letterSpacing: 1 }, `KW ${r.week.kw}`),
        ),
        h({ fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 46, color: TEXT, letterSpacing: 1 }, "WOCHEN-SCOREBOARD"),
      ),
      h(
        { flexDirection: "column", alignItems: "flex-end" },
        h({ fontFamily: "Inter", fontWeight: 800, fontSize: 22, color: CYAN, letterSpacing: 3 }, `[${r.guild.toUpperCase()}]`),
        h({ fontFamily: "Inter", fontWeight: 500, fontSize: 17, color: MUTED }, r.week.label),
      ),
    ),
    // Kennzahlen
    h(
      { padding: "20px 26px 0 40px" },
      kpi("Bosskämpfe", fmt0(r.fights), pct(r.fights, r.prevFights), MAG),
      kpi("Boss-Kills", fmt0(r.kills), pct(r.kills, r.prevKills), GOOD),
      kpi("Ø DPS je Boss", fmtPct(r.dpsChange), null, CYAN),
      kpi("Beste Gruppe", fmtShort(r.best.groupDps), null, "#ffd34a"),
    ),
    // MVP + Rangliste
    h(
      { padding: "18px 40px 0", flex: 1 },
      h(
        {
          width: 380, height: 334, flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative",
          backgroundImage: "linear-gradient(160deg, rgba(62,232,255,0.20), rgba(255,62,165,0.16) 60%, rgba(6,6,12,0.6))",
          border: `2px solid ${CYAN}`, borderRadius: 10, boxShadow: `0 0 26px rgba(62,232,255,0.45)`,
        },
        h({ position: "absolute", top: 16, left: 18 }, label("MVP der Woche", CYAN)),
        h({ position: "absolute", top: 12, right: 16, fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 30, color: "rgba(255,255,255,0.18)" }, "#1"),
        h(
          { width: 100, height: 100, borderRadius: 100, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6,6,12,0.7)", border: `3px solid ${MAG}`, boxShadow: `0 0 22px rgba(255,62,165,0.6)`, marginTop: 18 },
          img(jobIcon(mvp.job), 64, 67),
        ),
        h({ fontFamily: "Inter", fontWeight: 900, fontSize: 36, color: TEXT, marginTop: 6 }, mvp.name.toUpperCase()),
        h({ fontFamily: "Inter", fontStyle: "italic", fontWeight: 900, fontSize: 72, color: "#ffffff", lineHeight: 1, textShadow: `0 0 16px ${CYAN}, 0 0 34px rgba(62,232,255,0.6)` }, fmtShort(mvp.dps)),
        h({ fontFamily: "Inter", fontWeight: 700, fontSize: 16, color: CYAN, letterSpacing: 3, marginTop: 6 }, "DPS · BESTER KAMPF"),
        h({ fontFamily: "Inter", fontWeight: 500, fontSize: 17, color: MUTED, marginTop: 4 }, `${jobOf(mvp.job).name} · ${mvp.boss}`),
      ),
      h(
        { flexDirection: "column", flex: 1, marginLeft: 22 },
        rest.slice(0, 5).map((p, i) => row(p, i + 2, mvp.dps)),
        h(
          { justifyContent: "space-between", marginTop: 2, fontFamily: "Inter", fontSize: 14, color: MUTED },
          h({}, `Bester Kampf: ${r.best.boss} · ${fmtDuration(r.best.durationMs)} · besiegt`),
          h({}, "nur Mitglieder · ohne Feldbosse"),
        ),
      ),
    ),
  );
}
