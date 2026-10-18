// Beispieldaten für die Mockups (Fantasienamen, keine echten Spielerdaten).
// Alles hier lässt sich aus den VIER Abfragen von buildRecap() (cloud/src/weekly.ts) gewinnen,
// ohne zusätzliche D1-Reads – siehe README.md, Abschnitt "Daten".

export const recap = {
  guild: "Silberschwinge",
  week: { label: "14.10. – 21.10.2026", kw: 42 },
  fights: 47,
  prevFights: 39,
  kills: 31,
  prevKills: 24,
  dpsChange: 4.7,
  best: { boss: "Schattenkönigin Nerevia", groupDps: 642_800, durationMs: 227_000, killed: true },
  fastest: { boss: "Ursprungsgolem", durationMs: 118_000 },
  // Bester Kampfschnitt je Mitglied (heute LIMIT 3 – ohne LIMIT gleiche Reads)
  players: [
    { name: "Kaelith", job: 13, dps: 186_400, boss: "Schattenkönigin Nerevia" },
    { name: "Mirevan", job: 15, dps: 171_900, boss: "Feuerdrache Pyrothar" },
    { name: "Thoryn", job: 11, dps: 158_200, boss: "Schattenkönigin Nerevia" },
    { name: "Selwyn", job: 14, dps: 149_700, boss: "Ursprungsgolem" },
    { name: "Aurelis", job: 16, dps: 133_500, boss: "Feuerdrache Pyrothar" },
    { name: "Brannoc", job: 19, dps: 127_800, boss: "Hohepriester Varuun" },
    { name: "Ysolde", job: 18, dps: 96_300, boss: "Ursprungsgolem" },
    { name: "Varekh", job: 12, dps: 81_200, boss: "Schattenkönigin Nerevia" },
    { name: "Lioria", job: 17, dps: 58_900, boss: "Feuerdrache Pyrothar" },
  ],
  // je Boss (heute perBoss-Abfrage, erweitert um Name/Kills/Versuche)
  bosses: [
    { boss: "Schattenkönigin Nerevia", kills: 9, tries: 14, avgDps: 121_300, change: 11.2 },
    { boss: "Feuerdrache Pyrothar", kills: 8, tries: 10, avgDps: 109_800, change: 6.9 },
    { boss: "Ursprungsgolem", kills: 11, tries: 12, avgDps: 98_400, change: 3.1 },
    { boss: "Hohepriester Varuun", kills: 3, tries: 11, avgDps: 87_600, change: -2.4 },
  ],
};

// Klassen: ID → Name, Symbol (Datei in app/src/assets), Klassenfarbe für die Mockups
export const JOBS = {
  11: { name: "Gladiator", file: "검성", color: "#e8793a" },
  12: { name: "Templer", file: "수호성", color: "#5b8fd9" },
  13: { name: "Assassine", file: "살성", color: "#c45ad6" },
  14: { name: "Waldläufer", file: "궁성", color: "#4fbf6a" },
  15: { name: "Magier", file: "마도성", color: "#4aa3f0" },
  16: { name: "Beschwörer", file: "정령성", color: "#2fc4b2" },
  17: { name: "Kleriker", file: "치유성", color: "#f0d36b" },
  18: { name: "Kantor", file: "호법성", color: "#9c8cf0" },
  19: { name: "Faustkämpfer", file: "권성", color: "#e25656" },
};

// ---------- Formatierung wie weekly-core.ts ----------
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
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function fmtPct(v) {
  if (v === null || !Number.isFinite(v)) return "–";
  if (Math.abs(v) < 0.05) return "±0 %";
  return `${v > 0 ? "+" : "−"}${nf1.format(Math.abs(v))} %`;
}
export const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
export const fmt0 = (n) => nf0.format(n);
