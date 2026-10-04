// Diagnose-Pakete aus der App ("Diagnose an Gruppe senden", src-tauri/src/fork/diagnostics.rs):
// gzip-JSON mit Logs, Einstellungen (Passwörter geschwärzt) und den letzten Kämpfen.
// Der Server speichert die Bytes unverändert in D1-Stücken; Abruf als .json.gz-Download.

import { LIMITS } from "./protocol";

const CHUNK = 1_500_000; // D1: höchstens 2 MB je Zeile
const KEEP = 20; // je Raum

const ID_RE = /^[0-9a-f]{16}$/;

export const isDiagnosticPath = (rest: string) => rest === "/diagnostics" || /^\/diagnostics\/[0-9a-f]{16}$/.test(rest);

export async function handleDiagnostics(db: D1Database, room: string, rest: string, url: URL, req: Request): Promise<Response> {
  if (rest === "/diagnostics" && req.method === "POST") return receive(db, room, url, req);
  if (rest === "/diagnostics" && req.method === "GET") {
    const rows = (
      await db
        .prepare("SELECT id, uploader, note, bytes, created_ms AS createdMs FROM diagnostics WHERE room = ?1 ORDER BY created_ms DESC")
        .bind(room)
        .all()
    ).results;
    return Response.json({ diagnostics: rows });
  }
  const id = rest.slice("/diagnostics/".length);
  if (req.method === "GET" && ID_RE.test(id)) return download(db, room, id);
  return Response.json({ error: "not_found" }, { status: 404 });
}

async function receive(db: D1Database, room: string, url: URL, req: Request): Promise<Response> {
  const uploader = (url.searchParams.get("uploader") ?? "").trim().slice(0, 32) || "unbekannt";
  const note = (url.searchParams.get("note") ?? "").trim().slice(0, 300);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > LIMITS.maxUploadBytes) return Response.json({ error: "too_large" }, { status: 413 });
  // Nur gzip annehmen (Magic 1f 8b); alles andere ist kein Diagnose-Paket der App.
  if (bytes.length < 20 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Response.json({ error: "bad_request" }, { status: 400 });

  const now = Date.now();
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const stmts = [
    db
      .prepare("INSERT INTO diagnostics (id, room, uploader, note, bytes, created_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, room, uploader, note, bytes.length, now),
  ];
  for (let seq = 0; seq * CHUNK < bytes.length; seq++) {
    stmts.push(
      db.prepare("INSERT INTO diagnostic_chunks (diag_id, seq, data) VALUES (?1, ?2, ?3)").bind(id, seq, bytes.slice(seq * CHUNK, (seq + 1) * CHUNK)),
    );
  }
  await db.batch(stmts);

  // Alte Pakete aufräumen
  const old = (
    await db.prepare("SELECT id FROM diagnostics WHERE room = ?1 ORDER BY created_ms DESC LIMIT -1 OFFSET ?2").bind(room, KEEP).all<{ id: string }>()
  ).results.map((r) => r.id);
  if (old.length) {
    const list = JSON.stringify(old);
    await db.batch([
      db.prepare("DELETE FROM diagnostic_chunks WHERE diag_id IN (SELECT value FROM json_each(?1))").bind(list),
      db.prepare("DELETE FROM diagnostics WHERE id IN (SELECT value FROM json_each(?1))").bind(list),
    ]);
  }
  return Response.json({ id, bytes: bytes.length }, { status: 201 });
}

async function download(db: D1Database, room: string, id: string): Promise<Response> {
  const meta = await db
    .prepare("SELECT uploader, created_ms AS createdMs FROM diagnostics WHERE id = ?1 AND room = ?2")
    .bind(id, room)
    .first<{ uploader: string; createdMs: number }>();
  if (!meta) return Response.json({ error: "not_found" }, { status: 404 });
  const chunks = (
    await db.prepare("SELECT data FROM diagnostic_chunks WHERE diag_id = ?1 ORDER BY seq").bind(id).all<{ data: ArrayBuffer | number[] }>()
  ).results.map((r) => new Uint8Array(r.data as ArrayBuffer));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  const stamp = new Date(meta.createdMs).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const who = meta.uploader.replace(/[^\p{L}\p{N}_-]/gu, "_");
  return new Response(body, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="diagnose-${who}-${stamp}.json.gz"`,
    },
  });
}
