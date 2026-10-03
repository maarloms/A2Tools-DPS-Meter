// Simuliert 3 App-Clients + 1 Dashboard gegen `npx wrangler dev`.
//
//   npx wrangler dev                      (Terminal 1)
//   node test/simulate.mjs                (Terminal 2)
//   node test/simulate.mjs --record <pfad/zu/history/auto_x.json>   (zusaetzlich echten Kampf hochladen)
//
// Umgebungsvariablen: BASE (Default http://127.0.0.1:8787), ROOM, SECRET (wie in .dev.vars)

import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const ROOM = process.env.ROOM ?? "testraum";
const SECRET = process.env.SECRET ?? "dev-secret-bitte-aendern-123";
const WS_URL = BASE.replace(/^http/, "ws") + `/api/rooms/${ROOM}/ws`;
const recordArg = process.argv.indexOf("--record");
const RECORD_PATH = recordArg > 0 ? process.argv[recordArg + 1] : null;

let pass = 0;
let fail = 0;
function check(name, ok, info = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = { authorization: `Bearer ${SECRET}` };

function connect({ role, name, clientId, secret = SECRET, hello = true }) {
  const ws = new WebSocket(WS_URL);
  const c = { ws, msgs: [], groups: [], errors: [], closed: null, name, clientId };
  c.opened = new Promise((res, rej) => {
    ws.addEventListener("open", () => {
      if (hello) ws.send(JSON.stringify({ t: "hello", v: 1, secret, role, name, clientId }));
      res();
    });
    ws.addEventListener("error", (e) => rej(e));
  });
  c.closedP = new Promise((res) =>
    ws.addEventListener("close", (e) => {
      c.closed = { code: e.code, reason: e.reason };
      res(c.closed);
    }),
  );
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string" && e.data.includes("hello_timeout")) c.helloTimeout = true;
    if (e.data === "pong") {
      c.pong = true;
      return;
    }
    const m = JSON.parse(e.data);
    c.msgs.push(m);
    if (m.t === "group") c.groups.push(m);
    if (m.t === "error") c.errors.push(m);
  });
  return c;
}

/** Snapshot im Protokollformat: alle sehen denselben Boss, jeder meldet sich + Gruppe. */
function snap(seq, self, party, t) {
  const players = party.map((p) => ({
    id: p.id,
    name: p.name,
    job: p.job,
    dps: Math.round(p.rate * (1 + 0.05 * Math.sin(seq))),
    dmg: Math.round(p.rate * t * (p.name === self ? 1 : 0.97)), // fremde Werte leicht unvollstaendig
    share: 0,
    cp: p.cp,
    self: p.name === self,
  }));
  return {
    t: "snap",
    seq,
    battleTime: t * 1000,
    dungeonId: 600072,
    target: { id: 4242, name: "Testboss Kelpina", mode: "bossTargets", maxHp: 5_000_000, hp: 5_000_000 - 30_000 * t, dealt: 30_000 * t },
    players,
  };
}

const PARTY = [
  { id: 101, name: "Marlon", job: "검성", rate: 12000, cp: 3100 },
  { id: 102, name: "Freund1", job: "치유성", rate: 6000, cp: 2900 },
  { id: 103, name: "Freund2", job: "마도성", rate: 11000, cp: 3050 },
];

/**
 * FightRecord wie in AppData/history: der Uploader sieht sich selbst voll und
 * unmaskiert, die anderen maskiert und mit etwas weniger Schaden (Reichweite).
 */
function fakeRecord({ id, uploader, start, targetId = 4242, party = PARTY, durationMs = 60000 }) {
  const skills = [];
  const actors = [];
  party.forEach((p, i) => {
    const isMe = p.name === uploader;
    const nick = isMe ? p.name : maskName(p.name);
    const seen = isMe ? 1 : 0.97;
    actors.push({ actorId: p.id, nickname: nick, job: p.job, jobId: 11 + i, combatPower: p.cp, gearScore: 900, level: 45, damageReceived: 1000 * i });
    for (let k = 0; k < 4; k++) {
      const hits = 20 + k * 5;
      skills.push({
        actorId: p.id, code: 1000 + k, name: `Skill ${k}`, time: hits, dmg: Math.round(p.rate * (durationMs / 6000) * (4 - k) * seen), multiHitCount: 1, multiHitDamage: 50,
        minDmg: 100, maxDmg: 9000, crit: Math.floor(hits / 3), parry: 0, back: 2, perfect: 1, double: 0, frontal: 1, smite: 0, powershard: 0, regen: 0,
        job: p.job, isDot: k === 3, hitTimestamps: Array.from({ length: hits }, (_, h) => Math.floor((h / hits) * durationMs)), specs: [],
      });
    }
  });
  const total = skills.reduce((s, x) => s + x.dmg, 0);
  return {
    id, bossName: "Testboss Kelpina", targetId, startTimeMs: start, durationMs, totalDamage: total, killed: true,
    jobs: [], jobIds: [], details: { targetId, maxHp: 5000000, totalTargetDamage: total, battleTime: durationMs, startTime: 0, skills,
      pingHistory: Array.from({ length: 20 }, (_, i) => ({ tsMs: start + i * 3000, pingMs: 40 + i })), healSkills: [] },
    actors, isTrain: false, appVersion: "2.0.41", mobCode: 4242, dungeonId: 600072,
  };
}
function maskName(name) {
  const c = [...name];
  if (c.length <= 1) return name;
  if (c.length === 2) return c[0] + "*";
  if (c.length === 3) return c[0] + "*" + c[2];
  return c[0] + c[1] + "*".repeat(Math.min(c.length - 3, 4)) + c[c.length - 1];
}

async function main() {
  // ---------- HTTP-Grundlagen ----------
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("health", h.ok === true);
  check("Startadresse liefert Login-Seite", (await fetch(`${BASE}/`, { headers: { accept: "text/html" } })).status === 200);
  check("ohne Secret → 401", (await fetch(`${BASE}/api/rooms/${ROOM}/fights`)).status === 401);
  check("falsches Secret → 401", (await fetch(`${BASE}/api/rooms/${ROOM}/fights`, { headers: { authorization: "Bearer falsch-falsch-falsch" } })).status === 401);
  check("unbekannter Raum → 401", (await fetch(`${BASE}/api/rooms/gibtsnicht/fights`, { headers: auth })).status === 401);
  check("fremde Origin → 403", (await fetch(`${BASE}/api/rooms/${ROOM}/fights`, { headers: { ...auth, origin: "https://evil.example" } })).status === 403);
  const pre = await fetch(`${BASE}/api/rooms/${ROOM}/fights`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  check("CORS-Preflight fremde Origin → 403", pre.status === 403);

  // ---------- WebSocket: Auth ----------
  const bad = connect({ role: "app", name: "Boese", clientId: "boese-client-1", secret: "falsches-secret-12345" });
  await bad.opened;
  const badClose = await Promise.race([bad.closedP, sleep(3000).then(() => null)]);
  check("WS mit falschem Secret wird geschlossen (4001)", badClose?.code === 4001, JSON.stringify(badClose));

  const silent = connect({ role: "viewer", hello: false });
  const silentStart = Date.now();
  await silent.opened;

  // ---------- Live: 3 Apps + Dashboard ----------
  const viewer = connect({ role: "viewer", name: "Dashboard" });
  const apps = PARTY.map((p, i) => connect({ role: "app", name: p.name, clientId: `client-${p.name.toLowerCase()}-0${i}` }));
  await Promise.all([viewer.opened, ...apps.map((a) => a.opened)]);
  await sleep(500);
  check("welcome an alle", [viewer, ...apps].every((c) => c.msgs.some((m) => m.t === "welcome")));

  const t0 = Date.now();
  let sent = 0;
  for (let s = 1; s <= 6; s++) {
    for (const [i, a] of apps.entries()) {
      a.ws.send(JSON.stringify(snap(s, PARTY[i].name, PARTY, s)));
      sent++;
    }
    await sleep(1050);
  }
  await sleep(800);
  const g = viewer.groups.at(-1);
  const enc = g?.encounters?.find((e) => e.target.name === "Testboss Kelpina");
  console.log(`      ${sent} Snapshots gesendet, Viewer hat ${viewer.groups.length} Gruppen-Updates in ${((Date.now() - t0) / 1000).toFixed(1)} s bekommen`);
  check("Gruppen-Updates gedrosselt (≤ 2/s)", viewer.groups.length <= Math.ceil(((Date.now() - t0) / 1000) * 2) + 2, `${viewer.groups.length}`);
  check("3 Mitglieder online + kämpfend", g?.members?.filter((m) => m.state === "fighting").length === 3, JSON.stringify(g?.members?.map((m) => `${m.name}:${m.state}`)));
  check("ein gemeinsamer Kampf mit 3 Meldern", g?.encounters?.[0]?.key === enc?.key && enc?.reporters?.length === 3);
  check("3 Spieler zusammengeführt", enc?.players?.length === 3);
  const marlon = enc?.players?.find((p) => p.name === "Marlon");
  check("Eigenmeldung (höchster Schaden) gewinnt", marlon?.dmg === 12000 * 6 && marlon?.src === "Marlon", JSON.stringify(marlon));
  check("Anteil am Mob-Schaden berechnet", enc?.players?.every((p) => p.share > 0) && enc.players.reduce((s, p) => s + p.share, 0) <= 100.5);
  check("HP / Kampfzeit übernommen", enc?.target?.hp === 5_000_000 - 30_000 * 6 && enc?.battleTime === 6000);
  check("Apps bekommen Gruppenansicht ebenfalls", apps.every((a) => a.groups.length > 0));
  const size = JSON.stringify(g).length;
  check("Gruppen-Payload klein", size < 4000, `${size} Bytes`);

  // HTTP-Snapshot der Gruppenansicht
  const live = await fetch(`${BASE}/api/rooms/${ROOM}/live`, { headers: auth }).then((r) => r.json());
  check("GET /live liefert dieselbe Ansicht", live.encounters?.find((e) => e.target.name === "Testboss Kelpina")?.players?.length === 3);

  // ---------- Drosselung ----------
  for (let i = 0; i < 5; i++) apps[0].ws.send(JSON.stringify(snap(100 + i, "Marlon", PARTY, 7)));
  await sleep(600);
  check("Burst → rate_limited-Hinweis", apps[0].errors.some((e) => e.code === "rate_limited"));

  // ---------- Heartbeat ----------
  apps[1].ws.send("ping");
  await sleep(300);
  check("ping → pong (Auto-Response)", apps[1].pong === true);

  // ---------- clear ----------
  await sleep(1000);
  apps[2].ws.send(JSON.stringify({ t: "clear" }));
  await sleep(1200);
  const g2 = viewer.groups.at(-1);
  check("clear entfernt Snapshot des Clients", g2.encounters.find((e) => e.key === enc.key)?.reporters?.length === 2);

  // ---------- zu große Nachricht ----------
  const big = connect({ role: "app", name: "Gross", clientId: "client-gross-0001" });
  await big.opened;
  await sleep(300);
  big.ws.send(JSON.stringify({ t: "snap", junk: "x".repeat(20000) }));
  const bigClose = await Promise.race([big.closedP, sleep(3000).then(() => null)]);
  check("Nachricht > 16 KB → Close 1009", bigClose?.code === 1009, JSON.stringify(bigClose));

  // ---------- Disconnect → offline ----------
  apps[1].ws.close(1000, "bye");
  await sleep(1200);
  const g3 = viewer.groups.at(-1);
  check("getrennter Client wird offline angezeigt", g3.members.find((m) => m.name === "Freund1")?.state === "offline");

  // ---------- Kampf-Upload (automatisch, mehrere Perspektiven) ----------
  const post = (uploader, rec, gz = false) =>
    fetch(`${BASE}/api/rooms/${ROOM}/fights?uploader=${encodeURIComponent(uploader)}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", ...(gz ? { "content-encoding": "gzip" } : {}) },
      body: gz ? gzipSync(JSON.stringify(rec)) : JSON.stringify(rec),
    });
  const t0f = Date.now() - 120000;
  const recM = fakeRecord({ id: `auto_4242_${t0f}`, uploader: "Marlon", start: t0f });
  const up1 = await post("Marlon", recM);
  const up1j = await up1.json();
  check("Upload (JSON) → 201", up1.status === 201 && up1j.fightId?.length === 16 && up1j.perspectives === 1, JSON.stringify(up1j));
  await sleep(200);
  check("Dashboard bekommt fight-Event", viewer.msgs.some((m) => m.t === "fight" && m.fight.id === up1j.fightId));

  const up2 = await post("Marlon", recM, true);
  const up2j = await up2.json();
  check("gleicher Kampf nochmal (gzip) → idempotent, ersetzt", up2.status === 200 && up2j.replaced && up2j.fightId === up1j.fightId && up2j.perspectives === 1, JSON.stringify(up2j));

  // Freund2 laedt DENSELBEN Kampf aus seiner Sicht hoch (eigene Record-ID, Start 2 s spaeter)
  const recF = fakeRecord({ id: `auto_4242_${t0f + 2000}`, uploader: "Freund2", start: t0f + 2000 });
  const up3j = await (await post("Freund2", recF)).json();
  check("zweite Perspektive → gleicher Kampf", up3j.fightId === up1j.fightId && up3j.perspectives === 2, JSON.stringify(up3j));

  // Ein spaeterer, anderer Pull desselben Bosses → eigener Kampf
  const recLater = fakeRecord({ id: `auto_4243_${t0f + 600000}`, uploader: "Marlon", start: t0f + 600000, targetId: 4243, durationMs: 45000 });
  const up4j = await (await post("Marlon", recLater)).json();
  check("anderer Pull → neuer Kampf", up4j.fightId && up4j.fightId !== up1j.fightId, JSON.stringify(up4j));

  const list = await fetch(`${BASE}/api/rooms/${ROOM}/fights`, { headers: auth }).then((r) => r.json());
  const lf = list.fights?.find((f) => f.id === up1j.fightId);
  check("Liste: zusammengeführter Kampf mit 2 Uploadern", lf && lf.uploaders.length === 2, JSON.stringify(lf?.uploaders));

  const det = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${up1j.fightId}`, { headers: auth }).then((r) => r.json());
  const dp = (n) => det.players?.find((p) => p.name === n);
  check("Detail: 3 Spieler, Namen aufgelöst", det.players?.length === 3 && dp("Marlon") && dp("Freund1") && dp("Freund2"), det.players?.map((p) => p.name).join(","));
  check("Detail: Eigenmeldung zählt (Freund2 aus Freund2s Upload)", dp("Freund2")?.source === "Freund2" && dp("Freund2")?.selfReport === true && dp("Marlon")?.source === "Marlon");
  check("Detail: Skill-Analyse-Felder", dp("Marlon")?.skills?.length === 4 && "back" in dp("Marlon").skills[0] && "frontal" in dp("Marlon").skills[0] && "multiHits" in dp("Marlon").skills[0]);
  check("Detail: Zeitreihen, Skill-Spuren, Ping", det.timeline?.series?.length === 3 && det.timeline.lanes?.length === 3 && det.timeline.total?.dmg?.length > 10 && det.ping?.length === 2);
  check("Detail: 2 Uploads mit Rohdaten", det.uploads?.length === 2 && det.uploads.every((u) => u.raw));

  const raw = await fetch(`${BASE}/api/rooms/${ROOM}/uploads/${up1j.uploadId}/raw`, { headers: auth }).then((r) => r.json());
  check("Raw-Download = Original-FightRecord", raw.id === recM.id && raw.details.skills.length === recM.details.skills.length);

  // ---------- Statistik (nur Mitglieder) ----------
  const getj = (p) => fetch(`${BASE}/api/rooms/${ROOM}${p}`, { headers: auth }).then((r) => r.json());
  const bosses = await getj("/stats/bosses");
  const tb = bosses.bosses?.find((b) => b.mobCode === 4242 && b.dungeonId === 600072);
  check("Bosse: Testboss mit Bestwert", tb && tb.fights >= 2 && tb.best?.player === "Marlon", JSON.stringify(tb?.best));
  const lb = await getj("/stats/leaderboard?boss=4242:600072");
  const lbNames = [...new Set(lb.top?.map((p) => p.player))];
  check("Top-Leistungen je Boss: nur Mitglieder, sortiert", lb.top?.length >= 3 && lb.top[0].dps >= lb.top[1].dps && !lbNames.some((n) => n.includes("*")), lbNames.join(","));
  const pr = await getj("/stats/player?name=Marlon&days=0");
  check("Mein Bereich: KPIs, Rekorde, Verlauf", pr.kpi?.fights >= 2 && pr.kpi.bestDps > 0 && pr.kpi.favorite && pr.records?.some((r) => r.mobCode === 4242) && pr.series?.points?.length > 0,
    JSON.stringify(pr.kpi));
  check("Mein Bereich: Nicht-Mitglied abgelehnt", (await getj("/stats/player?name=Ravenfeld")).error === "not_member");
  const ov = await getj("/stats/overview");
  check("Übersicht: Karten, Gruppe, Wer-führt, letzte Kämpfe", ov.members?.length >= 3 && ov.group?.fights >= 2 && ov.group.together >= 1 && ov.matrix?.length >= 1 && ov.recent?.length >= 1,
    JSON.stringify(ov.group));
  const cmp = await getj("/stats/compare?days=30");
  check("Vergleich: Mitglieder, pro Boss, Verlauf", cmp.members?.length >= 3 && cmp.matrix?.length >= 1 && cmp.members.some((m) => m.firsts >= 1) && cmp.series?.points?.length > 0);
  const bf = await (await fetch(`${BASE}/api/rooms/${ROOM}/maintenance/backfill`, { method: "POST", headers: auth })).json();
  check("Peak-DPS und Frontal-Quote alter Kämpfe nachgetragen", bf.remaining === 0, JSON.stringify(bf));
  const mPeak = (await getj("/stats/compare?days=30")).members.find((m) => m.name === "Marlon");
  check("Frontal-Quote im Vergleich", mPeak?.avgFront > 0, String(mPeak?.avgFront));
  check("Peak (10 s) da und mindestens der Kampfschnitt", mPeak?.bestPeak >= mPeak?.bestDps * 0.95, `${mPeak?.bestPeak} / ${mPeak?.bestDps}`);
  const fl = await getj("/fights?limit=5");
  check("Kampfliste: besiegt-Flag", fl.fights?.some((f) => f.killed === true));
  const meK = await getj(`/stats/player?name=Marlon&days=30`);
  check("Mein Bereich: schnellster Kill je Boss", meK.records?.[0]?.fastestKill > 0, String(meK.records?.[0]?.fastestKill));
  const cmpF = await getj("/stats/compare?days=30&bucket=fight");
  const fp = cmpF.series?.points ?? [];
  const fPeriods = [...new Set(fp.map((p) => p.period))];
  check("Vergleich: Verlauf pro Kampf (ein Punkt je Spieler und Kampf, mit Boss)",
    cmpF.series?.bucket === "fight" && fPeriods.length >= 2 && fp.every((p) => p.boss && /^\d{13}$/.test(p.period)) &&
      fp.filter((p) => p.player === "Marlon").length === fPeriods.length && fp.every((p) => p.peakDps > 0) && fPeriods.join() === [...fPeriods].sort().join(),
    `${fPeriods.length} Kämpfe, ${fp.length} Punkte`);
  const tr = await getj(`/stats/trends?days=30&tz=${-new Date().getTimezoneOffset()}&boss=4242:600072`);
  check("Trends: Punkte pro Spieler und Tag", tr.points?.some((p) => p.player === "Marlon" && p.fights >= 2), JSON.stringify(tr.points?.[0]));
  const trw = await getj("/stats/trends?days=30&bucket=week");
  check("Trends: Wochen-Buckets", trw.points?.[0]?.period?.includes("-W"));

  // Fremder Spieler mit vollem Namen im Kampf → erscheint nirgends, zählt aber im Anteil
  const partyX = [...PARTY, { id: 199, name: "Fremdling", job: "궁성", rate: 15000, cp: 0 }];
  const recX = fakeRecord({ id: `auto_4245_${t0f + 1800000}`, uploader: "Marlon", start: t0f + 1800000, targetId: 4245, party: partyX });
  recX.actors.find((a) => a.actorId === 199).nickname = "Fremdling"; // unmaskiert
  const upXj = await (await post("Marlon", recX)).json();
  const detX = await getj(`/fights/${upXj.fightId}`);
  // Der Kämpfe-Tab ist der einzige Ort mit allen Spielern, `member` markiert die Gruppe.
  const fremdX = detX.players?.find((p) => p.name === "Fremdling");
  check("Kampfdetail: Fremde sichtbar, als Nicht-Mitglied markiert", fremdX && fremdX.member === false && detX.players.some((p) => p.member === true),
    JSON.stringify(detX.players?.map((p) => [p.name, p.member])));
  const listX = await getj("/fights?limit=5");
  check("Kampfliste: Fremde in der Top-Liste, markiert", listX.fights?.some((f) => f.top.some((p) => p.name === "Fremdling" && p.member === false)));
  check("Übersicht: Fremde bleiben draußen", !JSON.stringify(await getj("/stats/overview")).includes("Fremdling"));
  check("Vergleich: Fremde bleiben draußen", !JSON.stringify(await getj("/stats/compare?days=30")).includes("Fremdling"));

  // Neues Mitglied: bisher maskiert ("Ne****g"), nach dem ersten hello mit echtem Namen
  const NEU = `Neu${String(Date.now()).slice(-5)}`; // pro Lauf neu, sonst schon bekannt
  const partyN = [...PARTY, { id: 104, name: NEU, job: "권성", rate: 9000, cp: 2800 }];
  const recN = fakeRecord({ id: `auto_4244_${t0f + 1200000}`, uploader: "Marlon", start: t0f + 1200000, targetId: 4244, party: partyN });
  const upNj = await (await post("Marlon", recN)).json();
  const inTop = (r) => r.top?.some((p) => p.player === NEU);
  check("unbekannter Spieler nicht in Statistik", !inTop(await getj("/stats/leaderboard?boss=4242:600072")));
  const neu = connect({ role: "app", name: NEU, clientId: "client-neuling-01" });
  await neu.opened;
  await sleep(1500);
  check("nach hello: maskierte Einträge dem Mitglied zugeordnet", inTop(await getj("/stats/leaderboard?boss=4242:600072")));
  neu.ws.close();

  // ---------- Mitglieder verwalten ----------
  const patch = (name, active) =>
    fetch(`${BASE}/api/rooms/${ROOM}/members`, { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name, active }) });
  check("Mitglied ausblenden", (await patch(NEU, false)).status === 200);
  const mem = await getj("/members");
  check("Mitgliederliste zeigt ausgeblendet", mem.members?.some((m) => m.name === NEU && m.active === false) && mem.fixed === false);
  check("ausgeblendetes Mitglied verschwindet aus Statistik", !inTop(await getj("/stats/leaderboard?boss=4242:600072")));
  await patch(NEU, true);
  check("wieder eingeblendet", inTop(await getj("/stats/leaderboard?boss=4242:600072")));
  await patch(NEU, false); // Testname bleibt ausgeblendet

  // ---------- Dashboard-Session (Cookie) ----------
  const login = (secret) =>
    fetch(`${BASE}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room: ROOM, secret }) });
  check("Login mit falschem Passwort → 401", (await login("falsch-falsch-falsch")).status === 401);
  const lr = await login(SECRET);
  const setCookie = lr.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  check("Login → HttpOnly/SameSite=Strict-Cookie", lr.status === 200 && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && cookie.startsWith("a2s="), setCookie.replace(/=[^;]+/, "=…"));
  const ck = { cookie };
  check("ohne Cookie: Dashboard-Dateien gesperrt", (await fetch(`${BASE}/app.js`)).status === 401 && (await fetch(`${BASE}/js/core.js`)).status === 401 && (await fetch(`${BASE}/shared/events.json`)).status === 401);
  const loginHtml = await (await fetch(`${BASE}/`, { headers: { accept: "text/html" } })).text();
  check("ohne Cookie: nur schlichte Login-Seite", loginHtml.includes("<title>Anmeldung</title>") && !loginHtml.includes("DPS") && loginHtml.includes("noindex"));
  check("mit Cookie: Dashboard + Dateien", (await (await fetch(`${BASE}/`, { headers: { ...ck, accept: "text/html" } })).text()).includes("app.js") && (await fetch(`${BASE}/app.js`, { headers: ck })).status === 200);
  check("mit Cookie: API ohne Secret", (await fetch(`${BASE}/api/rooms/${ROOM}/stats/overview`, { headers: ck })).status === 200);
  check("Cookie gilt nicht für fremden Raum", (await fetch(`${BASE}/api/rooms/anderer-raum/fights`, { headers: ck })).status === 401);
  const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  check("manipuliertes Cookie → 401", (await fetch(`${BASE}/api/rooms/${ROOM}/fights`, { headers: { cookie: forged } })).status === 401);
  check("GET /api/session", (await (await fetch(`${BASE}/api/session`, { headers: ck })).json()).room === ROOM);
  const lo = await fetch(`${BASE}/api/session`, { method: "DELETE", headers: ck });
  check("Logout löscht Cookie", /Max-Age=0/i.test(lo.headers.get("set-cookie") || ""));
  // WebSocket mit Cookie: Dashboard braucht kein Secret; ohne Cookie schon
  const wsC = await new Promise((res) => {
    const ws = new WebSocket(WS_URL, { headers: ck });
    ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, role: "viewer" })));
    ws.addEventListener("message", (e) => { if (String(e.data).includes('"welcome"')) { ws.close(); res("welcome"); } });
    ws.addEventListener("close", (e) => res(`close ${e.code}`));
    setTimeout(() => res("timeout"), 4000);
  });
  check("WS mit Cookie ohne Secret → welcome", wsC === "welcome", wsC);
  const wsN = await new Promise((res) => {
    const ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, role: "viewer" })));
    ws.addEventListener("close", (e) => res(`close ${e.code}`));
    ws.addEventListener("message", (e) => { if (String(e.data).includes('"welcome"')) res("welcome"); });
    setTimeout(() => res("timeout"), 4000);
  });
  check("WS ohne Cookie und ohne Secret → 4001", wsN === "close 4001", wsN);

  const badUp = await fetch(`${BASE}/api/rooms/${ROOM}/fights?uploader=Marlon`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: '{"foo":1}' });
  check("ungültiger Record → 400", badUp.status === 400);
  const noUploader = await fetch(`${BASE}/api/rooms/${ROOM}/fights`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(recM) });
  check("fehlender uploader → 400", noUploader.status === 400);
  // Der Worker antwortet, bevor er den Body liest. wrangler dev quittiert das teils
  // mit 500/Verbindungsabbruch statt 413 (lokale Eigenheit) – beides heisst "abgelehnt".
  const huge = await fetch(`${BASE}/api/rooms/${ROOM}/fights?uploader=Marlon`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "x".repeat(9 * 1024 * 1024) }).catch(() => ({ status: "abgebrochen" }));
  check("Upload > 8 MB abgelehnt (413)", huge.status === 413 || huge.status === 500 || huge.status === "abgebrochen", `${huge.status}`);

  if (RECORD_PATH) {
    const buf = readFileSync(RECORD_PATH);
    const gz = gzipSync(buf);
    const t = Date.now();
    const r = await fetch(`${BASE}/api/rooms/${ROOM}/fights?uploader=marloms`, {
      method: "POST", headers: { ...auth, "content-type": "application/json", "content-encoding": "gzip" }, body: gz,
    });
    const j = await r.json();
    check(`echter Kampf (${(buf.length / 1e6).toFixed(1)} MB, gzip ${(gz.length / 1e3).toFixed(0)} KB) hochgeladen`, r.ok, `${Date.now() - t} ms ${JSON.stringify(j)}`);
    const d = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${j.fightId}`, { headers: auth });
    const dt = await d.text();
    const dj = JSON.parse(dt);
    check("echter Kampf: Detail lesbar", d.ok && dj.players.length > 0, `${dj.summary.boss}, ${dj.summary.actorCount} Akteure, Detail ${(dt.length / 1e3).toFixed(0)} KB, Top: ${dj.players[0].name} ${Math.round(dj.players[0].dps)} DPS`);
  }

  for (const id of [up1j.fightId, up4j.fightId, upNj.fightId, upXj.fightId]) {
    const del = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${id}`, { method: "DELETE", headers: auth });
    check("Löschen", del.status === 200);
  }
  check("danach 404", (await fetch(`${BASE}/api/rooms/${ROOM}/fights/${up1j.fightId}`, { headers: auth })).status === 404);
  check("Raw nach Löschen weg", (await fetch(`${BASE}/api/rooms/${ROOM}/uploads/${up1j.uploadId}/raw`, { headers: auth })).status === 404);

  // ---------- Feldboss-Timer ----------
  {
    const [a, , b] = apps; // apps[1] ist oben schon getrennt
    const t0 = Date.now();
    const at = (c) => c.msgs.filter((m) => m.t === "bosses").length;
    const before = at(b);
    a.ws.send(JSON.stringify({ t: "bosses", timers: [{ code: 2400800, killedAt: t0, respawnAt: null, seenAt: null, intervalMin: 120, by: a.name, updated: t0 }] }));
    await sleep(500);
    const got = b.msgs.filter((m) => m.t === "bosses").at(-1);
    check("Boss-Kill geht an die anderen Apps", at(b) === before + 1 && got?.timers?.[0]?.code === 2400800 && got.timers[0].by === a.name);
    check("Boss-Kill nicht zurück an den Melder", !a.msgs.some((m) => m.t === "bosses" && m.timers?.[0]?.updated === t0));
    const n = at(b);
    a.ws.send(JSON.stringify({ t: "bosses", timers: [{ code: 2400800, killedAt: t0 - 5000, updated: t0 - 5000 }, { code: 2400853, updated: t0 + 3_600_000 }] }));
    await sleep(400);
    check("ältere und Zukunfts-Meldungen verworfen", at(b) === n);
    const late = connect({ role: "app", name: "Spaetkommer", clientId: "spaet-client-1" });
    await late.opened;
    await sleep(500);
    const first = late.msgs.find((m) => m.t === "bosses");
    const viaHttp = await getj("/bosses");
    check("Dashboard liest Boss-Timer per GET /bosses", viaHttp.timers?.some((x) => x.code === 2400800 && x.killedAt === t0));
    check("neue App bekommt gespeicherte Boss-Timer", first?.timers?.some((x) => x.code === 2400800 && x.killedAt === t0 && x.intervalMin === 120));
    late.ws.close(1000);
  }

  // ---------- Hello-Timeout ----------
  // Lokal (wrangler dev) kommt der Close-Frame eines von aussen geschlossenen
  // Sockets erst beim naechsten Verkehr an; die vorausgeschickte error-Nachricht
  // ("hello_timeout") kommt sofort. Beides zaehlt.
  const waitUntil = silentStart + 13000;
  while (Date.now() < waitUntil && !silent.closed && !silent.helloTimeout) await sleep(250);
  check("Socket ohne hello wird nach ~10 s abgewiesen", silent.closed?.code === 4001 || silent.helloTimeout === true,
    `${silent.closed ? "close " + silent.closed.code : silent.helloTimeout ? "error hello_timeout" : "nichts"} nach ${((Date.now() - silentStart) / 1000).toFixed(1)} s`);

  for (const c of [viewer, ...apps]) c.ws.close(1000);
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
