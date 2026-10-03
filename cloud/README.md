# AION2 Gruppen-Meter – Cloud (Relay + Dashboard)

Privater Cloudflare-Teil des DPS-Meters für Marlon + Freunde. **Nur Free-Plan-Features.**

- **Live-Relay:** Jede App schickt 1×/s ihren Snapshot per WebSocket, alle Mitglieder und das Dashboard bekommen die
  zusammengeführte Gruppenansicht. Ein Durable Object pro Raum, WebSocket-Hibernation (keine Kosten im Leerlauf).
- **Kampf-Upload (automatisch):** Die App lädt jeden gespeicherten Bosskampf (FightRecord-JSON) hoch. Uploads mehrerer
  Mitglieder vom selben Kampf werden zu einem Kampf zusammengeführt (idempotent). Auswertung in **D1**, Original gzip im
  Durable Object.
- **Dashboard** (statische Assets am Worker, Theme „Atreia Gold“, Handy-tauglich):
  Live · Kämpfe (Liste + Detail mit Skill-Analyse, DPS-Kurve, Boss-HP, Skill-Zeitleiste, Ping) ·
  Bestenliste (pro Boss, persönliche Rekorde, Gruppenvergleich) · Trends (Tag/Woche, pro Boss) · Event-Timer.
- **App-Anbindung:** siehe [PROTOCOL.md](PROTOCOL.md).

## Ordner

```
cloud/
  wrangler.jsonc          Worker, Durable Object "Room", D1 "a2dps", Assets, Build-Schritt
  migrations/0001_init.sql  D1-Schema (encounters, uploads, player_stats, members)
  src/
    index.ts              Worker: Routing, Auth, CORS; Lese-Statistik direkt aus D1
    auth.ts               Raum-Secrets (Digest-Vergleich), Origin/CORS
    protocol.ts           Limits, Snapshot-Normalisierung
    merge.ts              Live: Snapshots → Gruppenansicht
    room.ts               Durable Object: WebSocket-Relay, Uploads (serialisiert), Rohdaten
    fights.ts             FightRecord → Detail, Zusammenführung mehrerer Perspektiven
    store.ts              D1-Schreibzugriffe (Upload, Merge, Mitglieder, Aufbewahrung)
    stats.ts              D1-Abfragen: Kampfliste, Bestenliste, Rekorde, Vergleich, Trends
  public/                 Dashboard (Vanilla JS als ES-Module, kein Bundler)
    index.html, app.js, style.css, js/*.js, fonts/cinzel-700.woff2 (OFL, aus app/public/fork/fonts)
    shared/               ← beim Build kopiert: events.json + schedule.js aus app/public/fork (nicht von Hand ändern)
  scripts/sync-shared.mjs Kopierschritt (läuft automatisch vor dev/deploy)
  test/simulate.mjs       End-to-End-Test: 3 Apps + Dashboard, Uploads, Statistik
  PROTOCOL.md             Protokoll für die App
```

## Lokal starten und testen

```bash
cd app/cloud
npm install
cp .dev.vars.example .dev.vars        # Test-Raum: testraum / dev-secret-bitte-aendern-123
npm run db:migrate:local              # D1-Schema lokal anlegen
npm run dev                           # http://127.0.0.1:8787
npm test                              # zweites Terminal; optional: node test/simulate.mjs --record <history/auto_x.json>
```

Dashboard: `http://127.0.0.1:8787/` → Raum `testraum`, Secret aus `.dev.vars`.
Einladungslink (Fragment, geht nicht an den Server): `http://127.0.0.1:8787/#/join/testraum/dev-secret-bitte-aendern-123`.

Testergebnis (lokal, 03.10.2026): **56/56 bestanden** – Auth/CORS, Live-Merge von 3 Apps, Drosselung, Heartbeat,
Größenlimits, Upload JSON+gzip, Idempotenz, Zusammenführung von 2 Perspektiven, neuer Pull = neuer Kampf,
Bestenliste/Rekorde/Vergleich/Trends, nachträgliche Namensauflösung neuer Mitglieder, Löschen, echter 4,7-MB-Weltboss
(Upload ~0,1 s, Detail 263 KB).

Lokale Eigenheit von `wrangler dev`: Schließt der Server einen *anderen* Socket (Hello-Timeout, Ablösung), kommt der
Close-Frame erst beim nächsten Verkehr an. Deshalb schickt der Server vorher `{"t":"error","code":"hello_timeout"|"replaced"}`
– Clients schließen dann selbst. Ein zu großer Upload wird lokal teils als 500/Abbruch statt 413 quittiert.

## Deployment (macht Marlon)

1. `cd app/cloud && npm install`
2. `npx wrangler login` (Cloudflare-Konto, Free Plan reicht)
3. `npx wrangler d1 create a2dps` → ausgegebene `database_id` in `wrangler.jsonc` eintragen
4. `npm run db:migrate:remote`
5. Secret erzeugen: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
6. `npx wrangler secret put ROOMS` → Wert `raumcode:<secret>` (z. B. `atreia-trio:Xy…`; mehrere Räume mit Komma)
7. `npm run deploy` → URL `https://a2dps-cloud.<konto>.workers.dev`
8. Freunden Raum-Code + Secret geben (oder den `#/join/…`-Link – enthält das Secret, also nur privat verschicken).
9. Nur falls die App per **JS im Webview** sendet: `ALLOWED_ORIGINS` in `wrangler.jsonc` auf `http://tauri.localhost` setzen
   und neu deployen. Rust-Clients brauchen das nicht.

Secret wechseln: Schritt 5–6 wiederholen (alte Verbindungen fliegen beim nächsten hello raus), allen neu geben.

## Kosten (Free Plan, 3 Spieler, ~4 h/Tag)

| Posten | Rechnung | pro Tag | Free-Limit |
|---|---|---|---|
| Live-Nachrichten | 3 × 1/s × 14 400 s = 43 200 WS-Nachrichten, Abrechnung 20:1 | ~2 200 DO-Requests | 100 000 |
| Worker-Requests | WS-Verbindungen, Uploads (~30 Bosse × 3), Dashboard-API | ~500 | 100 000 |
| DO-Laufzeit | während Kämpfen praktisch durchgehend aktiv: 14 400 s × 128 MB | ~1 800 GB-s | 13 000 GB-s |
| D1 geschrieben | ~100 Zeilen (inkl. Indizes) pro Upload × 90 | ~9 000 | 100 000 |
| D1 gelesen | Dashboard-Abfragen, je nach Historie | < 1 Mio. | 5 Mio. |
| Speicher | D1 ~0,1–0,4 MB pro Kampf (gzip), max. 5 000 Kämpfe/Raum; Rohdaten max. 400 Uploads/Raum im DO | wächst ~3–12 MB/Tag | 5 GB (D1) + 5 GB (DO) |
| Dashboard-Dateien | statische Assets | kostenlos | unbegrenzt |

Fazit: deutlich unter allen Limits (größter Posten: DO-Laufzeit ~15 %). Wird ein Limit gerissen, schlagen nur weitere
Operationen bis 00:00 UTC fehl – es entstehen keine Kosten.

## Sicherheit

- Raum-Secret nur als SHA-256-Digest im Speicher, Vergleich mit `timingSafeEqual`, wird nie geloggt. WebSocket-Auth in der
  ersten Nachricht (nicht in der URL). Invocation-Logs (enthalten Header) sind abgeschaltet.
- CORS/Origin: nur das eigene Dashboard (+ `ALLOWED_ORIGINS`). Fremde Origins → 403.
- Größen: WS-Nachricht 16 KB, Upload 8 MB (entpackt 32 MB), max. 24 Spieler/Snapshot, 8 Apps + 20 Viewer pro Raum,
  Snapshot-Drosselung 1/s, 300 Uploads/h.
- Dashboard mit CSP (`script-src 'self'`), `noindex`, keine externen Ressourcen.
- Das Dashboard merkt sich Raum + Secret im Browser (abwählbar) – auf fremden Geräten „Abmelden“.

## Offen

- **D1-`database_id`** nach `wrangler d1 create` eintragen (Platzhalter in `wrangler.jsonc`).
- Kill/Wipe, echte Namen von Mitspielern ohne App, Dungeon-Namen: siehe PROTOCOL.md Abschnitt 5.
- Ein Kampf wird über `mobCode` + `dungeonId` + Startzeit (±45 s) bzw. gleiche `targetId` zusammengeführt – im echten Spiel
  mit zwei Uploadern prüfen, ob die Entity-ID des Bosses bei allen gleich ist.
- Nach dem Deploy einmal prüfen, ob der Close-Frame bei Hello-Timeout in Produktion direkt ankommt (lokal verzögert).
