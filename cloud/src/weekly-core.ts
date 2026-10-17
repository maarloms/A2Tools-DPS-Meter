// Wochenrückblick per Discord-Webhook: reine Logik ohne D1/Netz (unit-testbar mit
// `node --test test/weekly.test.mjs`, Node lädt die Datei per Type-Stripping).
// Deshalb hier KEINE Imports und keine TS-Konstrukte, die Code erzeugen (enum, namespace).
//
// Wochengrenze = wöchentlicher Reset wie in der Checkliste (public/js/checklist.js):
// Mittwoch 07:00 UTC. Fest in UTC, also ohne Sprung bei der Zeitumstellung
// (Sommerzeit 09:00, Winterzeit 08:00 deutscher Zeit).

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const RESET_UTC_HOUR = 7;
/** 0 = Sonntag … 3 = Mittwoch */
export const RESET_WEEKDAY = 3;
/** Akzentfarbe des Dashboards (--gold, #d4af69) */
export const EMBED_COLOR = 0xd4af69;
/** Test-Posts höchstens so oft je Raum */
export const TEST_MIN_INTERVAL_MS = 30_000;
/** Bei 429 so lange höchstens warten und einmal neu senden; länger → nächster Cron-Lauf */
export const MAX_RETRY_WAIT_MS = 5_000;

/** Beginn der laufenden Reset-Woche (Mittwoch 07:00 UTC, ≤ now) */
export function weekStart(now: number): number {
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RESET_UTC_HOUR);
  if (t > now) t -= DAY_MS;
  while (new Date(t).getUTCDay() !== RESET_WEEKDAY) t -= DAY_MS;
  return t;
}

export interface Week {
  from: number; // inklusive
  to: number; // exklusive
  key: string; // "w2026-10-21" – gleiches Format wie die Checkliste
}

export const weekKey = (from: number) => "w" + new Date(from).toISOString().slice(0, 10);

/** Die zuletzt abgeschlossene Woche (für den Cron nach dem Reset) */
export function lastWeek(now: number): Week {
  const to = weekStart(now);
  const from = to - WEEK_MS;
  return { from, to, key: weekKey(from) };
}

/** Die laufende Woche bis jetzt (für den Test-Post) */
export function currentWeek(now: number): Week {
  const from = weekStart(now);
  return { from, to: from + WEEK_MS, key: weekKey(from) };
}

// ---------- Webhook-URL ----------

const WEBHOOK_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/(?:v\d{1,2}\/)?webhooks\/(\d{15,22})\/([A-Za-z0-9_-]{40,100})$/;

/**
 * Nur Discord-Webhooks: https://discord.com/api/webhooks/<id>/<token> (auch discordapp.com,
 * optional /api/v10/). Keine Query, kein Fragment, keine anderen Hosts/Ports.
 * Rückgabe: normalisierte URL oder null.
 */
export function parseWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length > 200) return null;
  const m = WEBHOOK_RE.exec(s);
  if (!m) return null;
  return `https://discord.com/api/webhooks/${m[1]}/${m[2]}`;
}

/** Was das Dashboard sehen darf: nur die letzten 4 Zeichen */
export const webhookHint = (url: string) => "…" + url.slice(-4);

// ---------- Discord-Antworten ----------

export type SendOutcome = "ok" | "invalid" | "rate_limited" | "retry" | "rejected";

/**
 * ok: gepostet. invalid: Webhook gelöscht/Token falsch (401/403/404) → nicht mehr senden.
 * rate_limited: 429. retry: Discord gestört (5xx, Netz) → nächster Cron-Lauf.
 * rejected: andere 4xx (z. B. 400 Inhalt) → diese Woche nicht nochmal versuchen.
 */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403 || status === 404) return "invalid";
  if (status === 429) return "rate_limited";
  if (status >= 500 || status === 0) return "retry";
  return "rejected";
}

/** Wartezeit aus 429-Antwort (JSON retry_after in s oder Header Retry-After in s), ms */
export function retryAfterMs(body: unknown, header: string | null): number {
  const fromBody = body && typeof body === "object" ? Number((body as { retry_after?: unknown }).retry_after) : NaN;
  const s = Number.isFinite(fromBody) ? fromBody : header ? Number(header) : NaN;
  return Number.isFinite(s) && s >= 0 ? Math.ceil(s * 1000) : 60_000;
}

// ---------- Auswertung ----------

export interface Recap {
  room: string;
  week: Week;
  fights: number;
  kills: number;
  prevFights: number;
  prevKills: number;
  /** Bester Kampf: höchste Gruppen-DPS (Summe der Mitglieder), besiegte zuerst */
  best: { fightId: string; boss: string; groupDps: number; durationMs: number; killed: boolean } | null;
  /** Bester Kampfschnitt je Mitglied, höchstens 3 */
  top: { name: string; dps: number; boss: string }[];
  /** Ø DPS je Boss gegen die Vorwoche in %, nur Bosse aus beiden Wochen; null = kein Vergleich */
  dpsChange: number | null;
}

/** Zeilen: Ø DPS der Mitglieder je Boss und Woche (cur = 1 diese, 0 Vorwoche) */
export function bossDpsChange(rows: { boss: string; cur: number; avgDps: number }[]): number | null {
  const prev = new Map(rows.filter((r) => !r.cur).map((r) => [r.boss, r.avgDps]));
  const changes: number[] = [];
  for (const r of rows) {
    if (!r.cur) continue;
    const before = prev.get(r.boss);
    if (before && before > 0) changes.push((r.avgDps - before) / before);
  }
  return changes.length ? (changes.reduce((a, c) => a + c, 0) / changes.length) * 100 : null;
}

/** Veränderung in %, null = kein Vergleichswert */
export function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

// ---------- Formatierung (wie im Dashboard, public/js/core.js) ----------

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtShort(n: number): string {
  const a = Math.abs(n || 0);
  if (a >= 1e9) return nf1.format(n / 1e9) + " B";
  if (a >= 1e6) return nf1.format(n / 1e6) + " M";
  if (a >= 1e4) return nf1.format(n / 1e3) + " k";
  return nf0.format(Math.round(n || 0));
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "–";
  if (Math.abs(v) < 0.05) return "±0 %";
  return `${v > 0 ? "+" : "−"}${nf1.format(Math.abs(v))} %`;
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

/** "21.10.–28.10.2026" (von Reset bis Reset, deutsche Zeit) */
export function weekLabel(w: Week): string {
  return `${dayFmt.format(w.from)}–${dateFmt.format(w.to)}`;
}

/** Discord-Markdown entschärfen (Spielernamen, Bossnamen) */
export function escapeMd(s: string): string {
  return String(s ?? "").slice(0, 64).replace(/[\\*_~`|\[\]]/g, (c) => "\\" + c);
}

// ---------- Discord-Nachricht ----------

export interface EmbedOptions {
  /** Dashboard-Adresse (Origin), unter der der Raum eingerichtet wurde */
  origin: string;
  /** Test-Post aus dem Dashboard: laufende Woche, gekennzeichnet */
  test?: boolean;
  /** Zeitstempel der Karte (Standard: Wochenende bzw. jetzt) */
  now?: number;
}

const PLACE = ["1.", "2.", "3."];

/** Discord-Webhook-Payload (eine Embed-Karte), ohne Erwähnungen */
export function buildPayload(r: Recap, opts: EmbedOptions) {
  const link = (path: string) => `${opts.origin}/#/${path}`;
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (r.best) {
    const b = r.best;
    fields.push({
      name: "Bester Kampf",
      value: `[${escapeMd(b.boss)}](${link(`fight/${b.fightId}`)})${b.killed ? " · besiegt" : ""}\n` +
        `${fmtShort(b.groupDps)} Gruppen-DPS · ${fmtDuration(b.durationMs)}`,
    });
  }
  if (r.top.length) {
    fields.push({
      name: `Top-${r.top.length}-DPS der Woche`,
      value: r.top.map((t, i) => `**${PLACE[i]}** ${escapeMd(t.name)} · ${fmtShort(t.dps)} · ${escapeMd(t.boss)}`).join("\n"),
    });
  }
  const killsCmp = r.prevKills > 0 ? `${fmtPct(pctChange(r.kills, r.prevKills))} (${nf0.format(r.prevKills)} → ${nf0.format(r.kills)})` : r.kills ? "neu (Vorwoche ohne Kill)" : "–";
  fields.push(
    { name: "Kills gegen Vorwoche", value: killsCmp, inline: true },
    { name: "Ø DPS je Boss gegen Vorwoche", value: fmtPct(r.dpsChange), inline: true },
  );

  const title = `${opts.test ? "Test · " : ""}Wochenrückblick ${r.room} · ${weekLabel(r.week)}`;
  const description =
    `**${nf0.format(r.fights)}** Bosskämpfe · **${nf0.format(r.kills)}** Boss-Kills` +
    (opts.test ? "\n_Test-Post aus dem Dashboard: laufende Woche bis jetzt._" : "") +
    `\n[Zum Dashboard](${link("overview")})`;

  return {
    username: "AION2 DPS Meter",
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: title.slice(0, 256),
        url: link("overview"),
        description,
        color: EMBED_COLOR,
        fields,
        footer: { text: "Woche von Reset zu Reset (Mi 07:00 UTC) · nur Mitglieder, ohne Feldbosse und Training" },
        timestamp: new Date(Math.min(r.week.to, opts.now ?? Date.now())).toISOString(),
      },
    ],
  };
}

/** Test-Post, wenn die Woche noch keine Kämpfe hat */
export function buildPingPayload(room: string, origin: string) {
  return {
    username: "AION2 DPS Meter",
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: `Test · Wochenrückblick ${room}`,
        url: `${origin}/#/overview`,
        description: "Der Webhook funktioniert. Diese Woche gibt es noch keine Bosskämpfe – der Rückblick kommt nach dem Reset am Mittwoch.",
        color: EMBED_COLOR,
      },
    ],
  };
}
