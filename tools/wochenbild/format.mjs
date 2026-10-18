// Formatierung wie cloud/src/weekly-core.ts und Umwandlung der Recap-Daten (GET /api/weekly/pending, je Raum)
// in das, was die Entwürfe erwarten.

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtShort(n) {
  const a = Math.abs(n || 0);
  if (a >= 1e9) return nf1.format(n / 1e9) + " B";
  if (a >= 1e6) return nf1.format(n / 1e6) + " M";
  if (a >= 1e4) return nf1.format(n / 1e3) + " k";
  return nf0.format(Math.round(n || 0));
}
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (Math.abs(v) < 0.05) return "±0 %";
  return `${v > 0 ? "+" : "−"}${nf1.format(Math.abs(v))} %`;
}
export const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
export const fmt0 = (n) => nf0.format(n || 0);
/** Kürzen mit "…" (Namen/Bosse, damit nichts aus Karten läuft) */
export const trunc = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** "atreia-trio" → "Atreia-Trio" (Gildenname, solange es keinen eigenen gibt) */
export const prettyRoom = (room) => String(room ?? "").replace(/(^|[-_ ])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/**
 * Recap eines Raums (pending-Format) → Daten für die Entwürfe.
 * opts.guild: Anzeigename (Standard: Raumcode hübsch), opts.portraits: { name_lc: dataUri } (später).
 */
export function viewModel(room, opts = {}) {
  const portraits = opts.portraits ?? {};
  const players = (room.players ?? []).map((p) => ({
    name: String(p.name ?? "?"),
    job: Number(p.job) || 0,
    dps: Number(p.dps) || 0,
    boss: String(p.boss ?? ""),
    portrait: portraits[String(p.name ?? "").toLowerCase()] ?? null,
  }));
  return {
    room: room.room,
    guild: opts.guild || prettyRoom(room.room),
    week: { label: String(room.week?.label ?? "").replace("–", " – "), kw: room.week?.kw ?? "", key: room.week?.key },
    fights: room.fights ?? 0,
    prevFights: room.prevFights ?? 0,
    kills: room.kills ?? 0,
    prevKills: room.prevKills ?? 0,
    dpsChange: room.dpsChange ?? null,
    best: room.best ?? null,
    fastest: room.fastest ?? null,
    players,
    bosses: (room.bosses ?? []).map((b) => ({ ...b, change: b.change ?? null, avgDps: b.avgDps ?? 0 })),
  };
}
