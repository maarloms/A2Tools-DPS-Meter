// Durable Object "Room": ein Objekt pro Raum-Code.
//  - Live-Relay ueber WebSocket (Hibernation API → keine Dauerkosten im Leerlauf)
//  - Kampf-Uploads: serialisiert pro Raum, Auswertung → D1, Original (gzip) → eigene SQLite

import { DurableObject } from "cloudflare:workers";
import { checkRoomSecret, Env } from "./auth";
import {
  CLIENT_ID_RE,
  LIMITS,
  PROTOCOL_VERSION,
  Role,
  Snap,
  cleanName,
  normalizeBoss,
  normalizeSnap,
} from "./protocol";
import { buildGroupView } from "./merge";
import {
  RecordError,
  TooLargeError,
  assertRecord,
  buildUpload,
  gunzip,
  gzip,
  isGzip,
  readLimited,
  unmaskDetail,
  unmasker,
} from "./fights";
import { deleteEncounter, loadEncounter, reassignUploads, registerMember, removeMember, saveUpload } from "./store";
import { activeMembers, isAllowed } from "./members";
import { recordsOf } from "./stats";

interface Attachment {
  role: Role | "pending";
  room: string;
  clientId: string;
  name: string;
  at: number;
  group: boolean;
  /** Dashboard per Session-Cookie bereits angemeldet (vom Worker gesetzt) */
  pre?: boolean;
}

interface RateState {
  last: number;
  windowStart: number;
  drops: number;
  warned: boolean;
}

const CHUNK = 1_500_000; // SQLite-Zeile max. 2 MB
const RECORD_FRESH_MS = 3 * 3_600_000; // ältere Kämpfe (nachgeladen) melden keine Rekorde mehr
const dec = new TextDecoder();

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export class Room extends DurableObject<Env> {
  private sql: SqlStorage;
  private snaps = new Map<string, Snap>();
  private loaded = false;
  private dirty = new Set<string>();
  private lastPersist = 0;
  private lastBroadcast = 0;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private rate = new Map<string, RateState>();
  private uploadTimes: number[] = [];
  private uploadChain: Promise<unknown> = Promise.resolve();
  private memberSeen = new Map<string, number>();
  /** Aktive Mitglieder (klein geschrieben) für die Live-Ansicht; null = noch nicht geladen */
  private memberSet: Set<string> | null = null;
  private memberSetAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Wenig Arbeit im Konstruktor: er laeuft bei jedem Aufwachen aus der Hibernation.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS live (client_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS raw_index (upload_id TEXT PRIMARY KEY, uploaded_at INTEGER NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bosses (code INTEGER PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS raw_chunks (upload_id TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (upload_id, idx));
      DROP TABLE IF EXISTS fights; DROP TABLE IF EXISTS fight_chunks; DROP TABLE IF EXISTS names;
    `);
    // Heartbeat ohne das Objekt aufzuwecken: Client sendet "ping", Runtime antwortet "pong".
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ================= HTTP =================

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/api\/rooms\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!m) return json({ error: "not_found" }, 404);
    const room = m[1].toLowerCase();
    const rest = m[2];
    this.roomName = room;

    try {
      if (rest === "/ws") return this.acceptSocket(req, room);
      if (rest === "/bosses" && req.method === "GET") return json({ timers: this.bossTimers() });
      if (rest === "/live" && req.method === "GET") {
        await this.refreshMembers();
        return json(this.groupView());
      }
      if (rest === "/members-changed" && req.method === "POST") {
        // Dashboard hat die Mitgliederliste geändert → Live-Ansicht neu filtern
        await this.refreshMembers(true);
        this.scheduleBroadcast();
        return json({ ok: true });
      }
      if (rest === "/fights" && req.method === "POST") {
        // Uploads pro Raum nacheinander: verhindert doppelte Kaempfe bei gleichzeitigen Uploads
        const run = this.uploadChain.then(() => this.upload(req, url, room));
        this.uploadChain = run.catch(() => undefined);
        return await run;
      }
      const f = /^\/fights\/([0-9a-f]{16})$/.exec(rest);
      if (f && req.method === "GET") return await this.fightDetail(room, f[1]);
      if (f && req.method === "DELETE") return await this.deleteFight(room, f[1]);
      const u = /^\/uploads\/([0-9a-f]{16})\/raw$/.exec(rest);
      if (u && req.method === "GET") return this.rawUpload(u[1]);
      if ((rest === "/maintenance/rename" || rest === "/maintenance/remove") && req.method === "POST") {
        // Wie Uploads nacheinander: beide fuehren Kaempfe neu zusammen
        const run = this.uploadChain.then(() => this.maintainMember(req, room, rest));
        this.uploadChain = run.catch(() => undefined);
        return await run;
      }
    } catch (e) {
      if (e instanceof TooLargeError) return json({ error: "too_large", message: e.message }, 413);
      if (e instanceof RecordError) return json({ error: "bad_record", message: e.message }, 400);
      console.error("room error", room, (e as Error)?.message);
      return json({ error: "internal" }, 500);
    }
    return json({ error: "not_found" }, 404);
  }

  // ================= WebSocket =================

  private acceptSocket(req: Request, room: string): Response {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected_websocket" }, 426);
    if (this.ctx.getWebSockets().length >= LIMITS.maxApps + LIMITS.maxViewers + 4) {
      return json({ error: "room_full" }, 503);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { role: "pending", room, clientId: "", name: "", at: Date.now(), group: true, pre: req.headers.get("x-a2-session") === "1" };
    server.serializeAttachment(att);
    // Unangemeldete Sockets nach Timeout schliessen
    this.ctx.storage.getAlarm().then((a) => {
      if (a === null) this.ctx.storage.setAlarm(Date.now() + LIMITS.helloTimeoutMs);
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return this.closeWith(ws, 1003, "text_only");
    if (message.length > LIMITS.maxMessageBytes) return this.closeWith(ws, 1009, "message_too_large");
    let msg: any;
    try {
      msg = JSON.parse(message);
    } catch {
      return this.sendErr(ws, "bad_json", "Nachricht ist kein JSON");
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return this.sendErr(ws, "bad_message", "Feld t fehlt");

    const att = ws.deserializeAttachment() as Attachment;
    if (att.role !== "pending") this.reapPending(Date.now());
    if (att.role === "pending") {
      if (msg.t !== "hello") return this.closeWith(ws, 4001, "hello_expected");
      return this.hello(ws, att, msg);
    }

    switch (msg.t) {
      case "snap":
        if (att.role !== "app") return this.sendErr(ws, "forbidden", "Nur App-Clients senden Snapshots");
        return this.onSnap(ws, att, msg);
      case "clear":
        if (att.role !== "app") return;
        this.ensureLoaded();
        this.snaps.delete(att.clientId);
        this.dirty.delete(att.clientId);
        this.sql.exec("DELETE FROM live WHERE client_id = ?", att.clientId);
        this.scheduleBroadcast();
        return;
      case "bosses":
        if (att.role !== "app") return;
        return this.onBosses(ws, msg);
      case "get":
        if (!this.allowRate(att.clientId || `v:${att.at}`, Date.now())) return;
        ws.send(JSON.stringify(this.groupView()));
        return;
      default:
        return this.sendErr(ws, "unknown_type", `Unbekannter Typ ${String(msg.t).slice(0, 16)}`);
    }
  }

  private async hello(ws: WebSocket, att: Attachment, msg: any): Promise<void> {
    if (msg.v !== PROTOCOL_VERSION) return this.closeWith(ws, 4002, "unsupported_version");
    const role: Role = msg.role === "app" ? "app" : "viewer";
    // Dashboard mit gültiger Session braucht kein Secret; Apps immer
    const ok = (att.pre && role === "viewer") || (await checkRoomSecret(this.env, att.room, msg.secret));
    if (!ok) return this.closeWith(ws, 4001, "unauthorized");

    const sockets = this.authedSockets();
    if (role === "app") {
      const clientId = typeof msg.clientId === "string" && CLIENT_ID_RE.test(msg.clientId) ? msg.clientId : "";
      const name = cleanName(msg.name);
      if (!clientId || !name) return this.closeWith(ws, 4003, "clientId_and_name_required");
      // Gleicher Client verbindet neu → alte Verbindung abloesen
      for (const [other, a] of sockets) {
        if (a.role === "app" && a.clientId === clientId) this.closeWith(other, 4004, "replaced", true);
      }
      const apps = this.authedSockets().filter(([, a]) => a.role === "app").length;
      if (apps >= LIMITS.maxApps) return this.closeWith(ws, 4005, "room_full");
      att.clientId = clientId;
      att.name = name;
      att.group = msg.wantGroup !== false;
      // Mitglied in D1 eintragen (hoechstens einmal pro Stunde je Name)
      if (Date.now() - (this.memberSeen.get(name) ?? 0) > 3_600_000) {
        this.memberSeen.set(name, Date.now());
        this.ctx.waitUntil(
          registerMember(this.env.DB, att.room, name, Date.now(), isAllowed(this.env, att.room, name))
            .then(() => this.refreshMembers(true))
            .then(() => this.scheduleBroadcast())
            .catch((e) => console.error("member", (e as Error).message)),
        );
      }
    } else {
      const viewers = sockets.filter(([, a]) => a.role === "viewer").length;
      if (viewers >= LIMITS.maxViewers) return this.closeWith(ws, 4005, "room_full");
      att.clientId = "";
      att.name = cleanName(msg.name) || "Dashboard";
      att.group = true;
    }
    att.role = role;
    att.at = Date.now();
    ws.serializeAttachment(att);

    ws.send(
      JSON.stringify({
        t: "welcome",
        v: PROTOCOL_VERSION,
        role,
        room: att.room,
        serverTime: Date.now(),
        limits: {
          snapIntervalMs: LIMITS.snapIntervalMs,
          minSnapIntervalMs: LIMITS.minSnapIntervalMs,
          maxMessageBytes: LIMITS.maxMessageBytes,
          maxPlayersPerSnap: LIMITS.maxPlayersPerSnap,
        },
      }),
    );
    if (att.group) ws.send(JSON.stringify(this.groupView()));
    if (role === "app") {
      this.scheduleBroadcast(); // Mitgliederliste hat sich geaendert
      ws.send(JSON.stringify({ t: "bosses", timers: this.bossTimers() }));
    }
  }

  private onSnap(ws: WebSocket, att: Attachment, msg: any): void {
    const now = Date.now();
    if (!this.allowRate(att.clientId, now)) {
      const st = this.rate.get(att.clientId)!;
      if (st.drops > 30) return this.closeWith(ws, 4008, "rate_limit");
      if (!st.warned) {
        st.warned = true;
        this.sendErr(ws, "rate_limited", `Max. 1 Snapshot pro ${LIMITS.minSnapIntervalMs} ms – ueberzaehlige werden verworfen`);
      }
      return;
    }
    this.ensureLoaded();
    this.snaps.set(att.clientId, normalizeSnap(msg, att.clientId, att.name, now));
    this.dirty.add(att.clientId);
    this.scheduleBroadcast();
  }

  // ================= Feldboss-Timer =================
  // Kills/Respawns der Feldbosse (App: src-tauri/src/fork/bosses.rs). Pro Boss
  // gewinnt die neueste Meldung; neue gehen an alle anderen Apps im Raum.

  private bossTimers(): unknown[] {
    return this.sql.exec("SELECT data FROM bosses ORDER BY code").toArray().map((r) => JSON.parse(String(r.data)));
  }

  private onBosses(from: WebSocket, msg: any): void {
    const now = Date.now();
    const list: unknown[] = Array.isArray(msg.timers) ? msg.timers.slice(0, LIMITS.maxBossTimers) : [];
    const accepted = [];
    for (const raw of list) {
      const t = normalizeBoss(raw, now);
      if (!t) continue;
      const row = this.sql.exec("SELECT updated FROM bosses WHERE code = ?", t.code).toArray()[0];
      if (row && Number(row.updated) >= t.updated) continue;
      this.sql.exec(
        "INSERT INTO bosses (code, data, updated) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated = excluded.updated",
        t.code, JSON.stringify(t), t.updated,
      );
      accepted.push(t);
    }
    if (!accepted.length) return;
    const payload = JSON.stringify({ t: "bosses", timers: accepted });
    for (const [ws, att] of this.authedSockets()) {
      if (ws !== from && att.role === "app") {
        try { ws.send(payload); } catch { /* Socket gerade zu */ }
      }
    }
  }

  /** true = annehmen. Zaehlt verworfene Nachrichten pro 10-s-Fenster. */
  private allowRate(key: string, now: number): boolean {
    let st = this.rate.get(key);
    if (!st) this.rate.set(key, (st = { last: 0, windowStart: now, drops: 0, warned: false }));
    if (now - st.windowStart > 10_000) {
      st.windowStart = now;
      st.drops = 0;
      st.warned = false;
    }
    if (now - st.last < LIMITS.minSnapIntervalMs) {
      st.drops++;
      return false;
    }
    st.last = now;
    return true;
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* schon zu */
    }
    if (att?.role === "app") {
      this.rate.delete(att.clientId);
      this.scheduleBroadcast();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role === "app") this.scheduleBroadcast();
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const pending = this.reapPending(now);
    this.sql.exec("DELETE FROM live WHERE updated < ?", now - LIMITS.liveTtlMs);
    for (const [id, s] of this.snaps) if (now - s.ts > LIMITS.liveTtlMs) this.snaps.delete(id);
    if (pending > 0) await this.ctx.storage.setAlarm(now + LIMITS.helloTimeoutMs);
  }

  /** Schliesst Sockets ohne hello nach Timeout; liefert die Zahl der noch wartenden. */
  private reapPending(now: number): number {
    let pending = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.role !== "pending" || ws.readyState !== WebSocket.OPEN) continue;
      if (now - att.at >= LIMITS.helloTimeoutMs - 1000) this.closeWith(ws, 4001, "hello_timeout", true);
      else pending++;
    }
    return pending;
  }

  // ================= Gruppenansicht =================

  private authedSockets(): [WebSocket, Attachment][] {
    const out: [WebSocket, Attachment][] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && att.role !== "pending" && ws.readyState === WebSocket.OPEN) out.push([ws, att]);
    }
    return out;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const cutoff = Date.now() - LIMITS.liveTtlMs;
    for (const row of this.sql.exec<{ client_id: string; data: string; updated: number }>(
      "SELECT client_id, data, updated FROM live WHERE updated >= ?",
      cutoff,
    )) {
      try {
        const s = JSON.parse(row.data) as Snap;
        if (!this.snaps.has(row.client_id)) this.snaps.set(row.client_id, s);
      } catch {
        /* defekte Zeile ignorieren */
      }
    }
  }

  /** Mitgliederliste aus D1 (gecacht, max. 60 s alt) */
  private async refreshMembers(force = false): Promise<void> {
    if (!force && this.memberSet && Date.now() - this.memberSetAt < 60_000) return;
    const room = this.authedSockets()[0]?.[1].room ?? this.roomName;
    if (!room) return;
    const names = await activeMembers(this.env.DB, this.env, room);
    this.memberSet = new Set(names.map((n) => n.toLowerCase()));
    this.memberSetAt = Date.now();
  }
  private roomName = "";

  private groupView() {
    if (!this.memberSet || Date.now() - this.memberSetAt > 60_000) {
      this.ctx.waitUntil(this.refreshMembers().then(() => this.scheduleBroadcast()).catch(() => undefined));
    }
    this.ensureLoaded();
    const online = this.authedSockets()
      .filter(([, a]) => a.role === "app")
      .map(([, a]) => ({ clientId: a.clientId, name: a.name }));
    const set = this.memberSet;
    // Solange die Liste nicht geladen ist: nur die verbundenen App-Namen (die Melder) zeigen
    return buildGroupView(this.snaps.values(), online, Date.now(), set ? (n) => set.has(n) : undefined);
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    const wait = Math.max(0, this.lastBroadcast + LIMITS.broadcastMinMs - Date.now());
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.lastBroadcast = Date.now();
      this.broadcast(JSON.stringify(this.groupView()), true);
      this.persistSoon();
    }, wait);
  }

  private broadcast(payload: string, groupOnly: boolean): void {
    for (const [ws, att] of this.authedSockets()) {
      if (groupOnly && !att.group) continue;
      try {
        ws.send(payload);
      } catch {
        /* Socket gerade zu */
      }
    }
  }

  /** Live-Zustand gedrosselt sichern, damit er eine Hibernation ueberlebt. */
  private persistSoon(): void {
    if (this.dirty.size === 0 || this.persistTimer) return;
    const wait = Math.max(0, this.lastPersist + LIMITS.persistEveryMs - Date.now());
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.lastPersist = Date.now();
      for (const id of this.dirty) {
        const s = this.snaps.get(id);
        if (s) {
          this.sql.exec(
            "INSERT INTO live (client_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated = excluded.updated",
            id,
            JSON.stringify(s),
            s.ts,
          );
        }
      }
      this.dirty.clear();
    }, wait);
  }

  private sendErr(ws: WebSocket, code: string, message: string): void {
    try {
      ws.send(JSON.stringify({ t: "error", code, message }));
    } catch {
      /* egal */
    }
  }

  /**
   * Schliesst einen Socket. Wird ein *anderer* Socket als der gerade sendende
   * geschlossen (Timeout, Abloesung), kommt der Close-Frame in workerd (lokal
   * beobachtet) erst beim naechsten Verkehr an – daher vorher eine error-
   * Nachricht mit demselben Code, auf die Clients selbst schliessen sollen.
   */
  private closeWith(ws: WebSocket, code: number, reason: string, announce = false): void {
    if (announce) this.sendErr(ws, reason, `Verbindung wird geschlossen (${code})`);
    try {
      ws.close(code, reason);
    } catch {
      /* schon zu */
    }
  }

  // ================= Kaempfe =================

  private async upload(req: Request, url: URL, room: string): Promise<Response> {
    const now = Date.now();
    this.uploadTimes = this.uploadTimes.filter((t) => now - t < 3_600_000);
    if (this.uploadTimes.length >= LIMITS.maxUploadsPerHour) {
      return json({ error: "rate_limited", message: "Zu viele Uploads in der letzten Stunde" }, 429, { "retry-after": "600" });
    }
    const uploader = cleanName(url.searchParams.get("uploader"));
    if (!uploader) return json({ error: "bad_request", message: "Query-Parameter uploader fehlt" }, 400);

    const body = await readLimited(req.body, LIMITS.maxUploadBytes);
    if (body.length === 0) return json({ error: "bad_request", message: "Leerer Body" }, 400);
    let raw: Uint8Array;
    let gz: Uint8Array;
    if (isGzip(body)) {
      gz = body;
      raw = await gunzip(body, LIMITS.maxRecordBytes);
    } else {
      raw = body;
      gz = await gzip(body);
    }
    let record: any;
    try {
      record = JSON.parse(dec.decode(raw));
    } catch {
      throw new RecordError("Body ist kein gueltiges JSON");
    }
    assertRecord(record);
    this.uploadTimes.push(now);

    const db = this.env.DB;
    await registerMember(db, room, uploader, now, isAllowed(this.env, room, uploader));
    this.memberSeen.set(uploader, now);
    const known = await activeMembers(db, this.env, room);
    const detail = buildUpload(record, uploader, known);
    const res = await saveUpload(db, room, detail, gz.length, known, now);

    // Original im Durable Object (D1-Zeilen sind auf 2 MB begrenzt)
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM raw_chunks WHERE upload_id = ?", res.uploadId);
      for (let i = 0, idx = 0; i < gz.length; i += CHUNK, idx++) {
        this.sql.exec("INSERT INTO raw_chunks (upload_id, idx, data) VALUES (?, ?, ?)", res.uploadId, idx, gz.slice(i, i + CHUNK).buffer);
      }
      this.sql.exec(
        "INSERT INTO raw_index (upload_id, uploaded_at, bytes) VALUES (?, ?, ?) ON CONFLICT(upload_id) DO UPDATE SET uploaded_at = excluded.uploaded_at, bytes = excluded.bytes",
        res.uploadId,
        now,
        gz.length,
      );
      const old = this.sql
        .exec<{ upload_id: string }>("SELECT upload_id FROM raw_index ORDER BY uploaded_at DESC LIMIT -1 OFFSET ?", LIMITS.maxRawPerRoom)
        .toArray()
        .map((r) => r.upload_id);
      for (const id of [...old, ...res.removedUploads]) this.forgetRaw(id);
    });

    this.broadcast(JSON.stringify({ t: "fight", fight: res.detail.summary, replaced: res.replaced }), false);
    // Neue Bestwerte an alle Meter und Dashboards, nur für frische Kämpfe (nicht beim Nachladen alter)
    const s = res.detail.summary;
    if (res.records.length && now - s.startMs < RECORD_FRESH_MS)
      this.broadcast(
        JSON.stringify({ t: "record", fightId: res.encounterId, boss: s.boss, mobCode: s.mobCode, dungeonId: s.dungeonId, records: res.records }),
        false,
      );
    return json(
      {
        ok: true,
        fightId: res.encounterId,
        uploadId: res.uploadId,
        replaced: res.replaced,
        perspectives: res.perspectives,
        url: `/#/fight/${res.encounterId}`,
        rawBytes: gz.length,
        records: res.records,
      },
      res.replaced ? 200 : 201,
    );
  }

  private forgetRaw(uploadId: string): void {
    this.sql.exec("DELETE FROM raw_chunks WHERE upload_id = ?", uploadId);
    this.sql.exec("DELETE FROM raw_index WHERE upload_id = ?", uploadId);
  }

  private async fightDetail(room: string, id: string): Promise<Response> {
    // Inzwischen bekannte Mitgliedsnamen nachträglich auflösen. Der Kämpfe-Tab
    // ist der einzige Ort mit allen Spielern; `member` markiert die Gruppe.
    const members = await activeMembers(this.env.DB, this.env, room);
    const d = await loadEncounter(this.env.DB, room, id, members);
    if (!d) return json({ error: "not_found" }, 404);
    unmaskDetail(d, unmasker(members));
    const isMember = new Set(members.map((n) => n.toLowerCase()));
    const member = (n: string) => isMember.has(n.toLowerCase());
    const haveRaw = new Set(
      this.sql.exec<{ upload_id: string }>("SELECT upload_id FROM raw_index").toArray().map((r) => r.upload_id),
    );
    return json({
      ...d,
      summary: { ...d.summary, top: d.summary.top.map((t) => ({ ...t, member: member(t.name) })) },
      players: d.players.map((p) => ({ ...p, member: member(p.name) })),
      others: null,
      timeline: {
        ...d.timeline,
        series: d.timeline.series.map((x) => ({ ...x, member: member(x.name) })),
        lanes: d.timeline.lanes.map((x) => ({ ...x, member: member(x.name) })),
      },
      uploads: d.uploads.map((u) => ({ ...u, raw: haveRaw.has(u.id) })),
      records: (await recordsOf(this.env.DB, [id])).get(id) ?? [],
    });
  }

  private rawUpload(uploadId: string): Response {
    const rows = this.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM raw_chunks WHERE upload_id = ? ORDER BY idx", uploadId)
      .toArray();
    if (rows.length === 0) return json({ error: "not_found" }, 404);
    const body = new Blob(rows.map((r) => r.data)).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="fight-${uploadId}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  /** Falsch benannte Uploader: umbenennen ({from, to}) oder ganz entfernen ({name}). */
  private async maintainMember(req: Request, room: string, rest: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown; name?: unknown } | null;
    const known = await activeMembers(this.env.DB, this.env, room);
    let result: unknown;
    if (rest === "/maintenance/rename") {
      const from = cleanName(body?.from), to = cleanName(body?.to);
      if (!from || !to || from.toLowerCase() === to.toLowerCase()) return json({ error: "from_and_to_required" }, 400);
      result = await reassignUploads(this.env.DB, room, from, to, known);
      this.memberSeen.delete(from);
    } else {
      const name = cleanName(body?.name);
      if (!name) return json({ error: "name_required" }, 400);
      const res = await removeMember(this.env.DB, room, name, known.filter((n) => n.toLowerCase() !== name.toLowerCase()));
      this.ctx.storage.transactionSync(() => res.uploads.forEach((u) => this.forgetRaw(u)));
      this.memberSeen.delete(name);
      result = { uploads: res.uploads.length, fights: res.fights, deletedFights: res.deletedFights };
    }
    await this.refreshMembers(true);
    this.scheduleBroadcast();
    return json({ ok: true, ...(result as object) });
  }

  private async deleteFight(room: string, id: string): Promise<Response> {
    const exists = await this.env.DB.prepare("SELECT 1 AS x FROM encounters WHERE id = ?1 AND room = ?2").bind(id, room).first();
    if (!exists) return json({ error: "not_found" }, 404);
    const ups = await deleteEncounter(this.env.DB, id);
    this.ctx.storage.transactionSync(() => ups.forEach((u) => this.forgetRaw(u)));
    this.broadcast(JSON.stringify({ t: "fightDeleted", id }), false);
    return json({ ok: true });
  }
}
