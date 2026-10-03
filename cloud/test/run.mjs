// `npm test`: frische lokale Datenbank, `wrangler dev` auf einem freien Port, simulate.mjs dagegen.
//
// Jeder Lauf bekommt ein eigenes Verzeichnis für D1/Durable Objects, das danach gelöscht wird.
// Mit dem gemeinsamen .wrangler/state sammelten sich Daten früherer Läufe an, bis Tests scheiterten.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOM = "testraum";
const SECRET = "dev-secret-bitte-aendern-123";
const win = process.platform === "win32";

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

function wrangler(args, opts = {}) {
  return spawn(win ? "npx.cmd" : "npx", ["wrangler", ...args], { cwd: root, shell: win, ...opts });
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

const state = mkdtempSync(join(tmpdir(), "a2dps-test-"));
const vars = join(state, "test.vars");
writeFileSync(vars, `ROOMS="${ROOM}:${SECRET}"\nSESSION_KEY="lokaler-session-schluessel-nur-fuer-tests-0123456789"\n`);

let dev = null;
let code = 1;
try {
  const sync = spawnSync(process.execPath, ["scripts/sync-shared.mjs"], { cwd: root, stdio: "inherit" });
  if (sync.status !== 0) throw new Error("sync-shared fehlgeschlagen");

  const migrate = await new Promise((res) => {
    const m = wrangler(["d1", "migrations", "apply", "a2dps", "--local", "--persist-to", state], { stdio: "inherit", env: { ...process.env, CI: "1" } });
    m.on("exit", res);
  });
  if (migrate !== 0) throw new Error("Migrationen fehlgeschlagen");

  const port = await freePort();
  const BASE = `http://127.0.0.1:${port}`;
  let log = "";
  dev = wrangler(["dev", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", state, "--env-file", vars, "--show-interactive-dev-session=false"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));

  // Bereit, sobald der Worker antwortet (erste Antwort braucht ein paar Sekunden).
  const until = Date.now() + 90_000;
  for (;;) {
    if (dev.exitCode !== null) throw new Error(`wrangler dev beendet:\n${log}`);
    try {
      await fetch(`${BASE}/`);
      break;
    } catch {
      if (Date.now() > until) throw new Error(`wrangler dev antwortet nicht:\n${log}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  code = await new Promise((res) => {
    const t = spawn(process.execPath, ["test/simulate.mjs", ...process.argv.slice(2)], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, BASE, ROOM, SECRET },
    });
    t.on("exit", (c) => res(c ?? 1));
  });
} catch (e) {
  console.error(e.message ?? e);
  code = 2;
} finally {
  stop(dev);
  // Windows gibt die SQLite-Dateien erst kurz nach dem Beenden frei.
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(state, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
process.exit(code);
