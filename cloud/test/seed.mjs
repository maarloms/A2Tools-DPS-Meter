// Testdaten: genau 3 Mitglieder (marloms, Lyrienne, Kaedros), 5 Bosse, ~45 Tage Historie.
// Jeder lädt seine Sicht hoch (wie die App); Fremde stehen in den Kämpfen, zählen aber nicht.
//
//   node test/seed.mjs                 Historie anlegen
//   node test/seed.mjs --live 60       zusätzlich 60 s Live-Kampf (3 Apps senden Snapshots)
//   node test/seed.mjs --live-only 60  nur Live-Kampf, keine neue Historie
//
// BASE (Default http://127.0.0.1:8787), ROOM, SECRET wie in .dev.vars.
// Frische lokale DB: wrangler dev mit eigenem --persist-to starten oder .wrangler/state löschen.

import { gzipSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const ROOM = process.env.ROOM ?? "testraum";
const SECRET = process.env.SECRET ?? "dev-secret-bitte-aendern-123";
const auth = { authorization: `Bearer ${SECRET}` };
const liveArg = process.argv.indexOf("--live");
const onlyArg = process.argv.indexOf("--live-only");
const LIVE_S = liveArg > 0 ? Number(process.argv[liveArg + 1] || 60) : onlyArg > 0 ? Number(process.argv[onlyArg + 1] || 60) : 0;

export const MEMBERS = [
  { id: 501, name: "marloms", job: "검성", base: 13000, grow: 60, cp: 3100 },
  { id: 502, name: "Lyrienne", job: "치유성", base: 5200, grow: 15, cp: 2900 },
  { id: 503, name: "Kaedros", job: "마도성", base: 12500, grow: 40, cp: 3050 },
];
const STRANGERS = [
  { id: 901, name: "Ravenfeld", job: "궁성", base: 9000, grow: 0 },
  { id: 902, name: "Solvei", job: "수호성", base: 6000, grow: 0 },
];
const BOSSES = [
  { mob: 2001, name: "Vakron", dungeon: 600072, hp: 9857819, dur: 300000 },
  { mob: 2002, name: "Thamon", dungeon: 600072, hp: 5220000, dur: 150000 },
  { mob: 2003, name: "Melted Danar", dungeon: 0, hp: 80000000, dur: 220000 },
  { mob: 2004, name: "Kusan der Wahnsinnige", dungeon: 600093, hp: 16000000, dur: 400000 },
  { mob: 2005, name: "Blue Wave Kelpina", dungeon: 0, hp: 135074580, dur: 480000 },
];
const SKILLS = ["Klingensturm", "Wirbelhieb", "Zornesschlag", "Blutung", "Durchbohren", "Schildbrecher", "Kettenhieb", "Raserei"];
const mask = (n) => {
  const c = [...n];
  if (c.length <= 1) return n;
  if (c.length === 2) return c[0] + "*";
  if (c.length === 3) return c[0] + "*" + c[2];
  return c[0] + c[1] + "*".repeat(Math.min(c.length - 3, 4)) + c.at(-1);
};
let rnd = 7;
const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;

function record(uploader, boss, start, day, present, strangers) {
  const dur = Math.round(boss.dur * (0.85 + rand() * 0.3));
  const skills = [];
  const actors = [];
  for (const p of [...present, ...strangers]) {
    const me = p.name === uploader;
    actors.push({ actorId: p.id, nickname: me ? p.name : mask(p.name), job: p.job, jobId: 0, combatPower: (p.cp ?? 2500) + day * 3, gearScore: 900, level: 45 });
    const dps = (p.base + p.grow * day) * (0.85 + rand() * 0.3) * (me ? 1 : 0.96);
    let left = (dps * dur) / 1000;
    SKILLS.forEach((sk, k) => {
      const part = k === SKILLS.length - 1 ? left : left * (0.25 + rand() * 0.2);
      left -= part;
      const hits = Math.max(3, Math.round(part / (2000 + rand() * 6000)));
      const ts = Array.from({ length: hits }, () => Math.floor(rand() * dur)).sort((a, b) => a - b);
      skills.push({
        actorId: p.id, code: 1000 + k, name: sk, time: hits, dmg: Math.round(part), multiHitCount: Math.round(hits * 0.1), multiHitDamage: 10,
        minDmg: 800, maxDmg: 12000, crit: Math.round(hits * (0.2 + rand() * 0.2)), parry: Math.round(hits * 0.02), back: Math.round(hits * (0.3 + rand() * 0.3)),
        perfect: Math.round(hits * 0.08), double: Math.round(hits * 0.05), frontal: Math.round(hits * 0.1), smite: 0, powershard: 0, regen: 0,
        job: p.job, isDot: k === 3, hitTimestamps: ts, specs: [],
      });
    });
  }
  const total = skills.reduce((s, x) => s + x.dmg, 0);
  const heals = uploader === "Lyrienne"
    ? [{ actorId: 502, name: "Heilwelle", time: 30, dmg: 400000, isDot: false }, { actorId: 502, name: "Regeneration", time: 80, dmg: 250000, isDot: true }]
    : [];
  return {
    id: `auto_${boss.mob}_${start}`, bossName: boss.name, targetId: boss.mob * 100 + day, startTimeMs: start, durationMs: dur, totalDamage: total, jobs: [], jobIds: [],
    details: { targetId: boss.mob, maxHp: boss.hp, totalTargetDamage: total, battleTime: dur, startTime: 0, skills, healSkills: heals,
      pingHistory: Array.from({ length: 30 }, (_, i) => ({ tsMs: start + (i * dur) / 30, pingMs: 30 + Math.round(rand() * 25) })) },
    actors, isTrain: false, appVersion: "2.0.41", mobCode: boss.mob, dungeonId: boss.dungeon,
  };
}

async function seedHistory() {
  let n = 0;
  let last = null;
  const now = Date.now();
  for (let day = 45; day >= 0; day -= 2) {
    for (const boss of BOSSES) {
      if (rand() < 0.45) continue;
      const start = now - day * 86400000 - Math.round(rand() * 6) * 3600000 - 3600000;
      // Wer war dabei? Meist alle drei, manchmal nur zwei oder einer allein
      const present = MEMBERS.filter(() => rand() > 0.15);
      if (!present.length) present.push(MEMBERS[0]);
      const strangers = STRANGERS.filter(() => rand() < 0.5);
      for (const p of present) {
        const r = await fetch(`${BASE}/api/rooms/${ROOM}/fights?uploader=${p.name}`, {
          method: "POST",
          headers: { ...auth, "content-encoding": "gzip" },
          body: gzipSync(JSON.stringify(record(p.name, boss, start + Math.round(rand() * 3000), 45 - day, present, strangers))),
        });
        const j = await r.json();
        n++;
        if (!r.ok) console.log(r.status, j);
        else last = j.fightId;
      }
    }
  }
  console.log(`Historie: ${n} Uploads, letzter Kampf ${last}`);
  return last;
}

async function live(seconds) {
  const all = [...MEMBERS, ...STRANGERS];
  const socks = MEMBERS.map((p, i) => {
    const ws = new WebSocket(BASE.replace(/^http/, "ws") + `/api/rooms/${ROOM}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: 1, secret: SECRET, role: "app", name: p.name, clientId: `seed-client-${i}` }));
    return ws;
  });
  let t = 20;
  const iv = setInterval(() => {
    t++;
    const dealt = all.reduce((s, p) => s + p.base * t, 0);
    socks.forEach((ws, i) => {
      if (ws.readyState !== 1) return;
      const me = MEMBERS[i];
      ws.send(JSON.stringify({
        t: "snap", seq: t, battleTime: t * 1000, dungeonId: 600072,
        target: { id: 9001, name: "Vakron", mode: "bossTargets", maxHp: 9857819, hp: Math.max(0, 9857819 - dealt), dealt },
        players: all.map((p) => ({
          id: p.id, name: p.name, job: p.job, dps: p.base * (1 + 0.08 * Math.sin(t / 3 + p.id)),
          dmg: Math.round(p.base * t * (p.name === me.name ? 1 : 0.96)), share: 0, cp: p.cp || 0, self: p.name === me.name,
        })),
      }));
    });
  }, 1000);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(iv);
  socks.forEach((s) => s.close());
}

const last = onlyArg > 0 ? null : await seedHistory();
if (LIVE_S) {
  console.log(`Live-Kampf ${LIVE_S} s …`);
  await live(LIVE_S);
}
if (process.env.PRINT_FIGHT) console.log(last);
process.exit(0);
