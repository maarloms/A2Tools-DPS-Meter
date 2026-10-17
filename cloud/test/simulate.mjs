// Simuliert 3 App-Clients + 1 Dashboard gegen `npx wrangler dev`.
//
//   npm test                              (startet alles selbst, frische Datenbank: test/run.mjs)
//
// Oder von Hand gegen einen laufenden Worker:
//   npx wrangler dev                      (Terminal 1)
//   node test/simulate.mjs                (Terminal 2)
//   node test/simulate.mjs --record <pfad/zu/history/auto_x.json>   (zusaetzlich echten Kampf hochladen)
//
// Umgebungsvariablen: BASE (Default http://127.0.0.1:8787), ROOM, SECRET (wie in .dev.vars)

import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { WEEK_MS, weekStart } from "../src/weekly-core.ts";

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
// Löschen, Ausblenden, Wartung: zusätzlich das Admin-Passwort (ADMIN_SECRET in .dev.vars)
const admin = { ...auth, "x-a2-admin": process.env.ADMIN ?? "admin-secret-nur-fuer-tests-123" };

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
const MITSPIELER = { id: 198, name: "Mitspieler", job: "궁성", rate: 4000, cp: 2500 };

/**
 * FightRecord wie in AppData/history: der Uploader sieht sich selbst voll und
 * unmaskiert, die anderen maskiert und mit etwas weniger Schaden (Reichweite).
 */
function fakeRecord({ id, uploader, start, targetId = 4242, party = PARTY, durationMs = 60000, mobCode = 4242, maxHp = 5000000, bossName = "Testboss Kelpina", dungeonId = 600072 }) {
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
    id, bossName, targetId, startTimeMs: start, durationMs, totalDamage: total, killed: true,
    jobs: [], jobIds: [], details: { targetId, maxHp, totalTargetDamage: total, battleTime: durationMs, startTime: 0, skills,
      pingHistory: Array.from({ length: 20 }, (_, i) => ({ tsMs: start + i * 3000, pingMs: 40 + i })), healSkills: [] },
    actors, isTrain: false, appVersion: "2.0.41", mobCode, dungeonId,
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
      // Marlon sieht zusätzlich einen Mitspieler ohne App
      a.ws.send(JSON.stringify(snap(s, PARTY[i].name, i === 0 ? [...PARTY, MITSPIELER] : PARTY, s)));
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
  check("3 Mitglieder zusammengeführt", enc?.players?.filter((p) => p.member).length === 3);
  const mit = enc?.players?.find((p) => p.name === "Mitspieler");
  check("Live: Mitspieler mit eigener Zeile, als Nicht-Mitglied markiert", mit?.member === false && mit.dmg > 0 && enc.others.count === 0, JSON.stringify([mit, enc?.others]));
  check("Gruppenansicht verrät keine clientId", g?.members?.length > 0 && g.members.every((m) => !("clientId" in m) && /^[0-9a-f]{8}$/.test(m.key)) && !JSON.stringify(g).includes("client-marlon-00"));
  const hijack = connect({ role: "app", name: "Boese", clientId: "client-marlon-00" });
  await hijack.opened;
  const hijackClose = await Promise.race([hijack.closedP, sleep(3000).then(() => null)]);
  await sleep(300);
  check("fremde clientId unter anderem Namen → abgewiesen (4007), Original bleibt", hijackClose?.code === 4007 && apps[0].closed === null, JSON.stringify([hijackClose, apps[0].closed]));
  const marlon = enc?.players?.find((p) => p.name === "Marlon");
  check("Eigenmeldung (höchster Schaden) gewinnt", marlon?.dmg === 12000 * 6 && marlon?.src === "Marlon", JSON.stringify(marlon));
  check("Anteil am Mob-Schaden berechnet", enc?.players?.every((p) => p.share > 0) && enc.players.reduce((s, p) => s + p.share, 0) <= 100.5);
  check("HP / Kampfzeit übernommen", enc?.target?.hp === 5_000_000 - 30_000 * 6 && enc?.battleTime === 6000);
  check("Apps bekommen Gruppenansicht ebenfalls", apps.every((a) => a.groups.length > 0));
  const size = JSON.stringify(g).length;
  check("Gruppen-Payload klein", size < 4000, `${size} Bytes`);

  // HTTP-Snapshot der Gruppenansicht
  const live = await fetch(`${BASE}/api/rooms/${ROOM}/live`, { headers: auth }).then((r) => r.json());
  check("GET /live liefert dieselbe Ansicht", live.encounters?.find((e) => e.target.name === "Testboss Kelpina")?.players?.length === 4);

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
  const getj0 = (p) => fetch(`${BASE}/api/rooms/${ROOM}${p}`, { headers: auth }).then((r) => r.json());
  // Nur mit TEST_HOOKS=1 (run.mjs): D1-Ausfall simulieren, Nachtragen auslösen, Aufbewahrung takten
  const hooks = (b) =>
    fetch(`${BASE}/api/rooms/${ROOM}/test/hooks`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
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

  // Meter melden für denselben Kampf verschiedene Dungeons (veraltet, 0 ohne Gruppenliste)
  const tDg = t0f + 2_400_000;
  const dg = (uploader, off, dungeonId) =>
    fakeRecord({ id: `auto_4300_${tDg + off}`, uploader, start: tDg + off, targetId: 4300, mobCode: 4300, bossName: "Testboss Dungeonwechsel", dungeonId });
  const dg1 = await (await post("Marlon", dg("Marlon", 0, 600072))).json();
  const dg2 = await (await post("Freund2", dg("Freund2", 1500, 600012))).json();
  const dg3 = await (await post("Freund1", dg("Freund1", 3000, 0))).json();
  check("andere Dungeon-ID, gleicher Kampf → zusammengeführt", dg2.fightId === dg1.fightId && dg3.fightId === dg1.fightId && dg3.perspectives === 3,
    JSON.stringify([dg1.fightId, dg2.fightId, dg3.fightId, dg3.perspectives]));
  const dgFar = await (await post("Freund2", dg("Freund2", 120_000, 600012))).json();
  check("andere Dungeon-ID, 2 min später → eigener Kampf", dgFar.fightId && dgFar.fightId !== dg1.fightId, JSON.stringify(dgFar));
  // Ein Meter zieht den Kampf über eine lange Pause, das andere kam erst danach dazu
  const tLong = t0f + 3_600_000;
  const lg = (uploader, off, durationMs) =>
    fakeRecord({ id: `auto_4301_${tLong + off}`, uploader, start: tLong + off, durationMs, targetId: 4301, mobCode: 4301, bossName: "Testboss Pause" });
  const lg1 = await (await post("Marlon", lg("Marlon", 0, 912_000))).json();
  const lg2 = await (await post("Freund2", lg("Freund2", 848_000, 205_000))).json();
  check("gleiche Entity, Kampfzeiten überschneiden sich → ein Kampf", lg2.fightId === lg1.fightId && lg2.perspectives === 2, JSON.stringify([lg1.fightId, lg2]));
  // Ein Meter, das Datenmüll als eigenen Namen las: umbenennen bzw. ganz entfernen
  const maint = (path, body) =>
    fetch(`${BASE}/api/rooms/${ROOM}/maintenance/${path}`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const tJunk = t0f + 4_800_000;
  const junk = await (await post("8Z", fakeRecord({ id: `auto_4302_${tJunk}`, uploader: "Marlon", start: tJunk, targetId: 4302, mobCode: 4302, bossName: "Testboss Umbenannt" }))).json();
  const ren = await maint("rename", { from: "8Z", to: "Marlon" });
  const fRen = await getj0(`/fights/${junk.fightId}`);
  const memAfterRen = await getj0("/members");
  check("Wartung rename: Upload gehört Marlon, 8Z kein Mitglied", ren.ok && fRen.summary?.uploaders?.join() === "Marlon" && !memAfterRen.members?.some((m) => m.name === "8Z"),
    JSON.stringify([ren, fRen.summary?.uploaders]));
  const dShared = await (await post("D", lg("D", 900_000, 100_000))).json();
  const dSolo = await (await post("D", fakeRecord({ id: `auto_4303_${tJunk + 600_000}`, uploader: "Marlon", start: tJunk + 600_000, targetId: 4303, mobCode: 4303, bossName: "Testboss Entfernt" }))).json();
  const rem = await maint("remove", { name: "D" });
  const fShared = await getj0(`/fights/${dShared.fightId}`);
  const fSolo = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${dSolo.fightId}`, { headers: auth });
  const memAfterRem = await getj0("/members");
  check("Wartung remove: geteilter Kampf ohne D, eigener gelöscht, D kein Mitglied",
    rem.ok && rem.uploads === 2 && rem.deletedFights === 1 && dShared.fightId === lg1.fightId && fShared.summary?.uploaders?.join() === "Marlon,Freund2" &&
      fSolo.status === 404 && !memAfterRem.members?.some((m) => m.name === "D"),
    JSON.stringify([rem, fShared.summary?.uploaders, fSolo.status]));
  const dedupe = await fetch(`${BASE}/api/rooms/${ROOM}/maintenance/dedupe`, { method: "POST", headers: admin }).then((r) => r.json());
  check("Wartung dedupe läuft, nichts mehr doppelt", dedupe.merged === 0, JSON.stringify(dedupe));

  // ---------- Neue Bestwerte ----------
  check("erster Kampf gegen den Boss ist kein Rekord", Array.isArray(up1j.records) && up1j.records.length === 0, JSON.stringify(up1j.records));
  const STRONG = PARTY.map((p) => (p.name === "Marlon" ? { ...p, rate: 15000 } : p));
  const tRec = t0f + 1_200_000;
  const recBest = fakeRecord({ id: `auto_4244_${tRec}`, uploader: "Marlon", start: tRec, targetId: 4244, party: STRONG });
  const seenBefore = viewer.msgs.length;
  const up5j = await (await post("Marlon", recBest)).json();
  const mRec = up5j.records?.find((r) => r.name === "Marlon" && r.kind === "dps");
  check("Rekord: höherer Schnitt wird erkannt, mit altem Bestwert", mRec && mRec.value > mRec.prev && mRec.prev > 0, JSON.stringify(up5j.records));
  check("Rekord: nur wer besser war", !up5j.records?.some((r) => r.name === "Freund1" && r.kind === "dps"));
  await sleep(300);
  const recMsgs = viewer.msgs.slice(seenBefore).filter((m) => m.t === "record");
  check("Rekord geht an Dashboard und Apps", recMsgs.length === 1 && recMsgs[0].fightId === up5j.fightId && recMsgs[0].boss === "Testboss Kelpina" &&
    apps[0].msgs.some((m) => m.t === "record" && m.fightId === up5j.fightId), JSON.stringify(recMsgs));
  const recBest2 = fakeRecord({ id: `auto_4244_${tRec + 1500}`, uploader: "Freund2", start: tRec + 1500, targetId: 4244, party: STRONG });
  const up6j = await (await post("Freund2", recBest2)).json();
  await sleep(300);
  check("Rekord: zweite Perspektive meldet ihn nicht nochmal", up6j.fightId === up5j.fightId && !up6j.records?.some((r) => r.name === "Marlon") &&
    viewer.msgs.filter((m) => m.t === "record").length === 1, JSON.stringify(up6j.records));
  const recOld = fakeRecord({ id: `auto_4245_${tRec - 86_400_000}`, uploader: "Marlon", start: tRec - 86_400_000, targetId: 4245,
    party: PARTY.map((p) => (p.name === "Marlon" ? { ...p, rate: 20000 } : p)) });
  const up7j = await (await post("Marlon", recOld)).json();
  await sleep(300);
  check("Rekord aus nachgeladenem altem Kampf: gespeichert, nicht gemeldet", up7j.records?.some((r) => r.name === "Marlon") &&
    viewer.msgs.filter((m) => m.t === "record").length === 1, JSON.stringify(up7j.records));
  const recList = await fetch(`${BASE}/api/rooms/${ROOM}/fights?limit=50`, { headers: auth }).then((r) => r.json());
  check("Kampfliste: Rekorde je Kampf", recList.fights?.find((f) => f.id === up5j.fightId)?.records?.some((r) => r.name === "Marlon" && r.kind === "dps"));
  const recDet = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${up5j.fightId}`, { headers: auth }).then((r) => r.json());
  check("Kampfdetail: Rekorde", recDet.records?.some((r) => r.name === "Marlon" && r.prev > 0));
  const recOv = await fetch(`${BASE}/api/rooms/${ROOM}/stats/overview`, { headers: auth }).then((r) => r.json());
  check("Übersicht: neue Bestwerte", recOv.records?.some((r) => r.fightId === up5j.fightId && r.name === "Marlon" && r.boss === "Testboss Kelpina"));

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
  const bf = await (await fetch(`${BASE}/api/rooms/${ROOM}/maintenance/backfill`, { method: "POST", headers: admin })).json();
  check("Peak-DPS und Frontal-Quote alter Kämpfe nachgetragen", bf.remaining === 0, JSON.stringify(bf));
  const mPeak = (await getj("/stats/compare?days=30")).members.find((m) => m.name === "Marlon");
  check("Frontal-Quote im Vergleich", mPeak?.avgFront > 0, String(mPeak?.avgFront));
  check("Peak (10 s) da und mindestens der Kampfschnitt", mPeak?.bestPeak >= mPeak?.bestDps * 0.95, `${mPeak?.bestPeak} / ${mPeak?.bestDps}`);
  const cmpG = await getj("/stats/compare?days=30");
  const mG = cmpG.members.find((m) => m.name === "Marlon");
  check("Vergleich: Gearscore, Combat Score und Verlauf", mG?.gs === 900 && mG?.cp > 0 && cmpG.gear?.some((p) => p.player === "Marlon" && p.gs === 900), `${mG?.gs} / ${mG?.cp}`);
  const fK = await getj("/fights?limit=20&killed=1&with=Marlon&dungeon=600072");
  check("Kämpfe filtern: besiegt, mit Mitglied, Dungeon", fK.fights?.length > 0 && fK.fights.every((f) => f.killed && f.dungeonId === 600072));
  const fNone = await getj("/fights?limit=20&with=niemand");
  check("Kämpfe filtern: unbekanntes Mitglied → leer", fNone.fights?.length === 0);
  const ovW = await getj("/stats/overview");
  check("Übersicht: Wochenrückblick", ovW.week?.fights > 0 && ovW.week.members?.some((m) => m.name === "Marlon" && m.best?.dps > 0) && ovW.week.bestRun?.fightId,
    JSON.stringify(ovW.week?.bestRun));
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
    fetch(`${BASE}/api/rooms/${ROOM}/members`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ name, active }) });
  check("Mitglied ausblenden", (await patch(NEU, false)).status === 200);
  const mem = await getj("/members");
  check("Mitgliederliste zeigt ausgeblendet", mem.members?.some((m) => m.name === NEU && m.active === false) && mem.fixed === false);
  check("ausgeblendetes Mitglied verschwindet aus Statistik", !inTop(await getj("/stats/leaderboard?boss=4242:600072")));
  await patch(NEU, true);
  check("wieder eingeblendet", inTop(await getj("/stats/leaderboard?boss=4242:600072")));
  await patch(NEU, false); // Testname bleibt ausgeblendet

  // ---------- Bosse: kleine (Quest-Minibosse) zählen nicht ----------
  const MINI = { mobCode: 7777, maxHp: 900_000, bossName: "Questboss Kius" };
  const tMini = t0f + 2_400_000;
  const upMj = await (await post("Marlon", fakeRecord({ id: `auto_7777_${tMini}`, uploader: "Marlon", start: tMini, targetId: 7777, ...MINI }))).json();
  const upM2j = await (await post("Marlon", fakeRecord({ id: `auto_7778_${tMini + 600000}`, uploader: "Marlon", start: tMini + 600000, targetId: 7778, party: STRONG, ...MINI }))).json();
  check("Miniboss gespeichert, aber kein Rekord", upMj.fightId && upM2j.fightId && upM2j.records?.length === 0, JSON.stringify(upM2j.records));
  const hasMini = (r) => r.bosses?.some((b) => b.mobCode === 7777);
  const inList = async (q = "") => (await getj(`/fights?limit=100${q}`)).fights?.some((f) => f.id === upMj.fightId);
  check("Miniboss nicht in Bossliste/Kampfliste", !hasMini(await getj("/stats/bosses")) && !(await inList()));
  check("Kampfliste mit all=1 zeigt ihn", await inList("&all=1"));
  const bs = await getj("/boss-settings");
  check("Boss-Verwaltung: Miniboss ausgeblendet, Testboss zählt", bs.bosses?.find((b) => b.mobCode === 7777)?.hidden === true &&
    bs.bosses?.find((b) => b.mobCode === 4242)?.hidden === false && bs.minHp > 900_000, JSON.stringify(bs.bosses));
  const setMode = (mobCode, mode) =>
    fetch(`${BASE}/api/rooms/${ROOM}/boss-settings`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ mobCode, mode }) });
  check("Boss fest einblenden", (await setMode(7777, "show")).status === 200 && hasMini(await getj("/stats/bosses")) && (await inList()));
  check("Boss fest ausblenden", (await setMode(4242, "hide")).status === 200 && !(await getj("/stats/bosses")).bosses?.some((b) => b.mobCode === 4242));
  await setMode(4242, "auto");
  await setMode(7777, "auto");
  check("zurück auf Auto", !hasMini(await getj("/stats/bosses")) && (await getj("/stats/bosses")).bosses?.some((b) => b.mobCode === 4242));
  check("ungültiger Modus → 400", (await setMode(7777, "egal")).status === 400);

  // ---------- Übersicht: Cache im Durable Object (Raum-Version) ----------
  const ovGet = async () => {
    const r = await fetch(`${BASE}/api/rooms/${ROOM}/stats/overview`, { headers: auth });
    return { cache: r.headers.get("x-a2-cache"), j: await r.json() };
  };
  const c1 = await ovGet();
  const c2 = await ovGet();
  check("Übersicht-Cache: zweiter Abruf aus dem Cache, gleiches Ergebnis", c2.cache === "hit" && JSON.stringify(c1.j) === JSON.stringify(c2.j), `${c1.cache} → ${c2.cache}`);
  await setMode(4242, "hide");
  const c3 = await ovGet();
  check("Übersicht-Cache: Boss-Einstellung verwirft ihn", c3.cache === "miss" && !c3.j.matrix?.some((b) => b.mobCode === 4242), c3.cache);
  await setMode(4242, "auto");
  check("Übersicht-Cache: Boss wieder da", (await ovGet()).j.matrix?.some((b) => b.mobCode === 4242));
  const tC = t0f + 9_000_000; // neuester Kampf → steht in "letzte Kämpfe"
  const upCj = await (await post("Marlon", fakeRecord({ id: `auto_4246_${tC}`, uploader: "Marlon", start: tC, targetId: 4246, mobCode: 4246, bossName: "Testboss Cache" }))).json();
  const c4 = await ovGet();
  check("Übersicht-Cache: Upload verwirft ihn, neuer Kampf sofort sichtbar", c4.cache === "miss" && c4.j.recent?.[0]?.id === upCj.fightId && c4.j.matrix?.some((b) => b.mobCode === 4246),
    `${c4.cache} ${c4.j.recent?.[0]?.id} / ${upCj.fightId}`);
  check("Übersicht-Cache: danach wieder Treffer", (await ovGet()).cache === "hit");
  await fetch(`${BASE}/api/rooms/${ROOM}/fights/${upCj.fightId}`, { method: "DELETE", headers: admin });
  const c5 = await ovGet();
  check("Übersicht-Cache: Löschen verwirft ihn", c5.cache === "miss" && !c5.j.recent?.some((r) => r.id === upCj.fightId) && !c5.j.matrix?.some((b) => b.mobCode === 4246), c5.cache);
  await patch(NEU, true);
  const c6 = await ovGet();
  check("Übersicht-Cache: Mitglied einblenden verwirft ihn", c6.cache === "miss" && c6.j.members?.some((m) => m.name === NEU), c6.cache);
  await patch(NEU, false);
  check("Übersicht-Cache: Mitglied ausblenden verwirft ihn", !(await ovGet()).j.members?.some((m) => m.name === NEU));
  await fetch(`${BASE}/api/rooms/${ROOM}/maintenance/backfill`, { method: "POST", headers: admin });
  check("Übersicht-Cache: Wartung verwirft ihn", (await ovGet()).cache === "miss");

  // ---------- Reset-Checkliste ----------
  const cl0 = await getj("/checklist");
  const clName = cl0.players?.[0]?.player;
  check("Checkliste: jedes Mitglied mit Main", !!clName && cl0.players.every((p) => p.chars[0]?.id === "main"), JSON.stringify(cl0).slice(0, 200));
  const clPatch = (body, headers = auth) =>
    fetch(`${BASE}/api/rooms/${ROOM}/checklist`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  check("Checkliste ohne Secret → 401", (await clPatch({ player: clName, char: "main", task: "pflicht", count: 1, period: "d2026-10-06" }, {})).status === 401);
  check("Haken setzen (ohne Admin)", (await clPatch({ player: clName.toUpperCase(), char: "main", task: "pflicht", count: 3, period: "d2026-10-06" })).status === 200);
  check("Charaktere speichern", (await clPatch({ player: clName, chars: [{ id: "main", name: "Main" }, { id: "t1", name: "Heiler" }] })).status === 200);
  check("Haken für Twink", (await clPatch({ player: clName, char: "t1", task: "aszension", count: 2, period: "w2026-09-30" })).status === 200);
  check("unbekannter Twink → 400", (await clPatch({ player: clName, char: "t9", task: "aszension", count: 1, period: "w2026-09-30" })).status === 400);
  check("Zähler > 99 → 400", (await clPatch({ player: clName, char: "main", task: "pflicht", count: 100, period: "d2026-10-06" })).status === 400);
  check("unbekannter Spieler → 400", (await clPatch({ player: "Niemand", char: "main", task: "pflicht", count: 1, period: "d2026-10-06" })).status === 400);
  check("Main muss vorne stehen → 400", (await clPatch({ player: clName, chars: [{ id: "t1", name: "Heiler" }] })).status === 400);
  const cl1 = (await getj("/checklist")).players.find((p) => p.player === clName);
  check("Checkliste gelesen", cl1.chars.length === 2 && cl1.items.some((i) => i.char === "main" && i.task === "pflicht" && i.count === 3 && i.period === "d2026-10-06") &&
    cl1.items.some((i) => i.char === "t1" && i.count === 2), JSON.stringify(cl1));
  await clPatch({ player: clName, chars: [{ id: "main", name: "Main" }] });
  const cl2 = (await getj("/checklist")).players.find((p) => p.player === clName);
  check("Twink entfernt → seine Haken weg", cl2.chars.length === 1 && !cl2.items.some((i) => i.char === "t1") && cl2.items.some((i) => i.char === "main"));

  // ---------- Diagnose-Pakete ----------
  const diagBody = gzipSync(JSON.stringify({ kind: "a2dps-diagnostics", logs: { "meter.log": "x".repeat(4000) }, fights: [] }));
  const sendDiag = (body, headers = auth) =>
    fetch(`${BASE}/api/rooms/${ROOM}/diagnostics?uploader=Zhou&note=${encodeURIComponent("Schaden zu niedrig")}`, { method: "POST", headers: { ...headers, "content-type": "application/gzip" }, body });
  check("Diagnose ohne Secret → 401", (await sendDiag(diagBody, {})).status === 401);
  check("Diagnose kein gzip → 400", (await sendDiag("hallo welt, kein gzip hier")).status === 400);
  const dr = await sendDiag(diagBody);
  const dj = await dr.json();
  check("Diagnose senden → 201", dr.status === 201 && /^[0-9a-f]{16}$/.test(dj.id) && dj.bytes === diagBody.length, JSON.stringify(dj));
  const dl = await getj("/diagnostics");
  check("Diagnose-Liste mit Notiz", dl.diagnostics?.[0]?.id === dj.id && dl.diagnostics[0].uploader === "Zhou" && dl.diagnostics[0].note === "Schaden zu niedrig");
  const dd = await fetch(`${BASE}/api/rooms/${ROOM}/diagnostics/${dj.id}`, { headers: auth });
  const ddBytes = Buffer.from(await dd.arrayBuffer());
  check("Diagnose-Download = gesendete Bytes", dd.status === 200 && ddBytes.equals(diagBody) && /diagnose-Zhou-/.test(dd.headers.get("content-disposition") || ""));

  const bigDiag = gzipSync(randomBytes(3_400_000)); // kaum komprimierbar → 3 Stücke in D1
  const bj = await (await sendDiag(bigDiag)).json();
  const bigBack = Buffer.from(await (await fetch(`${BASE}/api/rooms/${ROOM}/diagnostics/${bj.id}`, { headers: auth })).arrayBuffer());
  check("großes Diagnose-Paket in Stücken, unverändert zurück", bigBack.equals(bigDiag), `${bigBack.length} von ${bigDiag.length} Bytes`);

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
  check("ohne Cookie: Patchnotes-Seite + Markdown-Modul gesperrt", (await fetch(`${BASE}/js/patchnotes.js`)).status === 401 && (await fetch(`${BASE}/js/releases.js`)).status === 401 && (await fetch(`${BASE}/shared/markdown.js`)).status === 401);
  const mdJs = await fetch(`${BASE}/shared/markdown.js`, { headers: ck });
  check("mit Cookie: Patchnotes-Seite + Markdown-Modul", (await fetch(`${BASE}/js/patchnotes.js`, { headers: ck })).status === 200 && mdJs.status === 200 && (await mdJs.text()).includes("export function renderNotes"));
  check("CSP erlaubt GitHub-API für Patchnotes", /connect-src[^;]*https:\/\/api\.github\.com/.test(mdJs.headers.get("content-security-policy") || ""));
  check("mit Cookie: API ohne Secret", (await fetch(`${BASE}/api/rooms/${ROOM}/stats/overview`, { headers: ck })).status === 200);
  check("Cookie gilt nicht für fremden Raum", (await fetch(`${BASE}/api/rooms/anderer-raum/fights`, { headers: ck })).status === 401);
  // Ein Zeichen mitten in der Signatur: das letzte Base64-Zeichen trägt Füllbits, A↔B dort ändert nichts.
  const at = cookie.length - 8;
  const forged = cookie.slice(0, at) + (cookie[at] === "A" ? "Q" : "A") + cookie.slice(at + 1);
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

  // ---------- D1-Ausfall: Uploads gehen nicht verloren (Rohdaten zuerst ins DO, D1 später nachtragen) ----------
  const tP = t0f + 7_200_000;
  const pRec = (uploader, off, mob = 4400) =>
    fakeRecord({ id: `auto_${mob}_${tP + off}`, uploader, start: tP + off, targetId: mob, mobCode: mob, bossName: `Testboss Ausfall ${mob}` });
  const fightsOf = async (mob) => ((await getj("/fights?limit=100&all=1")).fights ?? []).filter((f) => f.mobCode === mob);
  await hooks({ failAfter: 0 });
  const pa = await post("Marlon", pRec("Marlon", 0));
  const paj = await pa.json();
  check("D1 fällt aus → Upload trotzdem angenommen (202, ausstehend)", pa.status === 202 && paj.ok === true && paj.pending === true && /^[0-9a-f]{16}$/.test(paj.uploadId ?? ""),
    `${pa.status} ${JSON.stringify(paj)}`);
  check("… Rohdaten sind schon im DO", (await fetch(`${BASE}/api/rooms/${ROOM}/uploads/${paj.uploadId}/raw`, { headers: auth })).status === 200);
  await hooks({ failAfter: 7 }); // Abbruch mitten in der Auswertung: uploads-Zeile steht schon in D1, der Kampf noch nicht
  const pb = await post("Freund2", pRec("Freund2", 1500));
  const hP = await hooks({ failAfter: null });
  check("Ausfall mitten in der Auswertung → ebenfalls ausstehend", pb.status === 202 && hP.pending === 2, `${pb.status} pending=${hP.pending}`);
  check("ausstehende Kämpfe noch nicht in der Liste", (await fightsOf(4400)).length === 0);
  const hD = await hooks({ drain: true });
  const f4400 = await fightsOf(4400);
  check("nachgetragen: ein Kampf mit beiden Perspektiven, nichts doppelt", hD.pending === 0 && f4400.length === 1 && f4400[0].uploaders?.length === 2,
    JSON.stringify([hD, f4400.map((f) => [f.id, f.uploaders])]));
  const again = await post("Marlon", pRec("Marlon", 0));
  const againj = await again.json();
  check("App lädt denselben Kampf nochmal hoch → ersetzt, kein Duplikat", again.status === 200 && againj.replaced === true && againj.fightId === f4400[0]?.id &&
    againj.perspectives === 2 && (await fightsOf(4400)).length === 1, JSON.stringify(againj));
  await hooks({ failAfter: 0 });
  const pc = await post("Marlon", pRec("Marlon", 600_000, 4401));
  await hooks({ failAfter: null });
  const pd = await post("Marlon", pRec("Marlon", 1_200_000, 4402));
  let late = [];
  for (let i = 0; i < 40 && !late.length; i++) {
    await sleep(250);
    late = await fightsOf(4401);
  }
  check("nächster erfolgreicher Upload holt Ausstehendes nach (Alarm)", pc.status === 202 && pd.status === 201 && late.length === 1 && (await hooks({})).pending === 0,
    `${pc.status} ${pd.status} ${late.length}`);

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

  // Nur mit Admin-Passwort: das Raum-Secret allein reicht nicht
  const noAdmin = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${up1j.fightId}`, { method: "DELETE", headers: auth });
  const wrongAdmin = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${up1j.fightId}`, { method: "DELETE", headers: { ...auth, "x-a2-admin": "falsch" } });
  const noAdminMaint = await fetch(`${BASE}/api/rooms/${ROOM}/maintenance/remove`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Marlon" }) });
  check("Löschen/Wartung ohne Admin-Passwort → 403", noAdmin.status === 403 && (await noAdmin.json()).error === "admin_required" && wrongAdmin.status === 403 && noAdminMaint.status === 403);
  for (const id of [up1j.fightId, up4j.fightId, upNj.fightId, upXj.fightId]) {
    const del = await fetch(`${BASE}/api/rooms/${ROOM}/fights/${id}`, { method: "DELETE", headers: admin });
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

  // ---------- Wochenrückblick (Discord-Webhook) ----------
  if (process.env.FAKE_DISCORD_PORT) await weeklyTests(t0f, NEU);
  else console.log("SKIP  Wochenrückblick (ohne FAKE_DISCORD_PORT, nur mit npm test)");

  // ---------- Aufbewahrung: alte Kämpfe nur jeden n-ten Upload löschen ----------
  const hR = await hooks({});
  await hooks({ retentionEvery: 3, retentionMax: hR.encounters, retentionReset: true });
  const counts = [];
  for (let i = 0; i < 3; i++) {
    const tR = t0f + 12_000_000 + i * 600_000;
    await post("Marlon", fakeRecord({ id: `auto_4500_${tR}`, uploader: "Marlon", start: tR, targetId: 4500 + i, mobCode: 4500, bossName: "Testboss Aufbewahrung" }));
    counts.push((await hooks({})).encounters);
  }
  const oldGone = (await fetch(`${BASE}/api/rooms/${ROOM}/fights/${up7j.fightId}`, { headers: auth })).status === 404;
  check("Aufbewahrung: erst beim 3. Upload aufgeräumt, die ältesten zuerst", counts.join() === [hR.encounters + 1, hR.encounters + 2, hR.encounters].join() && oldGone,
    `${hR.encounters} → ${counts.join(", ")}, ältester weg: ${oldGone}`);
  await hooks({ retentionEvery: null, retentionMax: null, retentionReset: true });

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

/**
 * Discord-Ersatz: merkt sich jeden POST. Antwort je Webhook-ID:
 * 1111… → 200, 4040… → 404, 4290… → einmal 429 (retry_after 0,3 s), dann 200, 5000… → 500.
 */
function fakeDiscord(port) {
  const hits = [];
  const seen429 = new Set();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const m = /^\/api\/webhooks\/(\d+)\/([^/?]+)/.exec(req.url);
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* egal */
      }
      hits.push({ id: m?.[1], url: req.url, method: req.method, json });
      const id = m?.[1] ?? "";
      const reply = (status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data ?? {}));
      };
      if (id.startsWith("404")) return reply(404, { message: "Unknown Webhook", code: 10015 });
      if (id.startsWith("500")) return reply(500, { message: "kaputt" });
      if (id.startsWith("429") && !seen429.has(id)) {
        seen429.add(id);
        return reply(429, { message: "You are being rate limited.", retry_after: 0.3, global: false });
      }
      reply(200, { id: "1", type: 0 });
    });
  });
  return new Promise((res) => server.listen(port, "127.0.0.1", () => res({ hits, close: () => server.close() })));
}

async function weeklyTests(t0f, hiddenName) {
  const discord = await fakeDiscord(Number(process.env.FAKE_DISCORD_PORT));
  const TOKEN = "TestToken_" + "x".repeat(50) + "-AbCd";
  const hook = (id) => `https://discord.com/api/webhooks/${id}/${TOKEN}`;
  const wh = (method, body, headers = admin, path = "/webhook") =>
    fetch(`${BASE}/api/rooms/${ROOM}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const whj = async (...a) => {
    const r = await wh(...a);
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: r.status, text, json: json ?? {} };
  };
  // Cron lokal auslösen (Miniflare): time = scheduledTime in ms
  const cron = async (time) => (await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("15 7-23 * * 3")}&time=${time}`)).status;
  const noSecret = (text) => !text.includes(TOKEN) && !text.includes("webhooks/");

  const g0 = await whj("GET", null, auth);
  check("Webhook: anfangs nicht eingerichtet", g0.status === 200 && g0.json.configured === false && g0.json.enabled === false, g0.text);
  check("Webhook setzen ohne Admin → 403", (await wh("PATCH", { url: hook("111111111111111111"), enabled: true }, auth)).status === 403);
  check("Webhook-Test ohne Admin → 403", (await wh("POST", null, auth, "/webhook/test")).status === 403);
  check("Webhook löschen ohne Admin → 403", (await wh("DELETE", null, auth)).status === 403);
  const bad = await whj("PATCH", { url: "https://evil.example/api/webhooks/111111111111111111/" + TOKEN, enabled: true });
  check("fremde Webhook-URL → 400 bad_url", bad.status === 400 && bad.json.error === "bad_url", bad.text);
  check("http:// statt https:// → 400", (await wh("PATCH", { url: hook("111111111111111111").replace("https:", "http:") })).status === 400);
  check("einschalten ohne URL → 400", (await whj("PATCH", { enabled: true })).json.error === "no_webhook");

  const set = await whj("PATCH", { url: hook("111111111111111111"), enabled: true });
  check("Webhook gesetzt: nur Hinweis, nie die URL", set.status === 200 && set.json.configured && set.json.enabled && set.json.hint === "…AbCd" && noSecret(set.text), set.text);
  const g1 = await whj("GET", null, auth);
  check("GET /webhook ohne Geheimnis", g1.json.configured === true && noSecret(g1.text), g1.text);

  // Test-Post: laufende Woche
  const t = await whj("POST", null, admin, "/webhook/test");
  const tp = discord.hits.at(-1);
  check("Test-Post gesendet", t.status === 200 && t.json.ok === true && noSecret(t.text) && discord.hits.length === 1, t.text);
  check("Test-Post: gekennzeichnete Karte ohne Erwähnungen", /^Test · Wochenrückblick testraum/.test(tp?.json?.embeds?.[0]?.title ?? "") &&
    tp.json.allowed_mentions?.parse?.length === 0 && /wait=true/.test(tp.url), JSON.stringify(tp?.json).slice(0, 300));
  check("zweiter Test sofort → 400 too_soon", (await whj("POST", null, admin, "/webhook/test")).json.error === "too_soon" && discord.hits.length === 1);

  // Cron in der Woche nach den Testkämpfen
  const cronAt = weekStart(t0f) + WEEK_MS + 15 * 60_000;
  check("Cron lokal auslösbar", (await cron(cronAt)) === 200);
  const wp = discord.hits.at(-1);
  const emb = wp?.json?.embeds?.[0];
  const fields = Object.fromEntries((emb?.fields ?? []).map((f) => [f.name, f.value]));
  check("Cron postet Wochenrückblick", discord.hits.length === 2 && /^Wochenrückblick testraum · \d\d\.\d\d\.–\d\d\.\d\d\.\d{4}$/.test(emb?.title ?? ""), emb?.title);
  check("Karte: Kämpfe, bester Kampf, Top-DPS, Vorwoche, Link", /\*\*\d+\*\* Bosskämpfe/.test(emb?.description ?? "") && !!fields["Bester Kampf"] &&
    /Top-\d-DPS der Woche/.test(Object.keys(fields).join("|")) && "Kills gegen Vorwoche" in fields && emb?.url === `${BASE}/#/overview` && emb?.color === 0xd4af69,
    JSON.stringify(emb).slice(0, 400));
  const topText = Object.entries(fields).find(([k]) => k.startsWith("Top-"))?.[1] ?? "";
  check("Top-DPS nur Mitglieder (ausgeblendete und Fremde nicht)", topText.includes("Marlon") && !topText.includes(hiddenName) && !topText.includes("Mitspieler"), topText);
  check("Cron zweimal → kein zweiter Post", (await cron(cronAt + 3_600_000)) === 200 && discord.hits.length === 2);
  const g2 = await whj("GET", null, auth);
  check("Stand: gepostet, Woche gemerkt", g2.json.status === "ok" && /^w\d{4}-\d\d-\d\d$/.test(g2.json.lastWeek ?? "") && g2.json.lastPostMs > 0, g2.text);
  check("Woche ohne Kämpfe wird nicht gepostet", (await cron(cronAt + 2 * WEEK_MS)) === 200 && discord.hits.length === 2);

  // 404 → ungültig, kein weiterer Versuch
  await wh("DELETE");
  await wh("PATCH", { url: hook("404404404404404404"), enabled: true });
  await cron(cronAt);
  const g3 = await whj("GET", null, auth);
  check("404 → Webhook ungültig", discord.hits.length === 3 && g3.json.status === "invalid" && g3.json.lastCode === 404 && noSecret(g3.text), g3.text);
  await wh("PATCH", { enabled: true }); // nur einschalten setzt den Status nicht zurück
  await cron(cronAt);
  await cron(cronAt + 60_000);
  check("ungültig → keine Wiederholung", discord.hits.length === 3, `${discord.hits.length} Aufrufe`);

  // 429 mit kurzer Wartezeit → einmal neu, dann gepostet
  await wh("DELETE");
  await wh("PATCH", { url: hook("429429429429429429"), enabled: true });
  await cron(cronAt);
  const g4 = await whj("GET", null, auth);
  check("429 → kurz gewartet, einmal neu gesendet", discord.hits.length === 5 && g4.json.status === "ok" && !!g4.json.lastWeek, `${discord.hits.length} ${g4.text}`);

  // 500 → Fehler, nächster Cron-Lauf versucht es nochmal
  await wh("DELETE");
  await wh("PATCH", { url: hook("500500500500500500"), enabled: true });
  await cron(cronAt);
  const g5 = await whj("GET", null, auth);
  await cron(cronAt + 3_600_000);
  check("500 → Fehler gemerkt, nächster Lauf versucht neu", g5.json.status === "error" && g5.json.lastWeek === null && discord.hits.length === 7, `${discord.hits.length} ${g5.text}`);

  // Ausschalten: kein Post
  await wh("DELETE");
  await wh("PATCH", { url: hook("111111111111111111"), enabled: false });
  await cron(cronAt);
  check("ausgeschaltet → kein Post", discord.hits.length === 7);
  const del = await whj("DELETE");
  check("Webhook löschen", del.status === 200 && del.json.configured === false && (await whj("GET", null, auth)).json.configured === false);
  discord.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
