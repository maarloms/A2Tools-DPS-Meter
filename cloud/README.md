# AION 2 DPS Meter – Cloud (Relay + Dashboard)

Privater Cloudflare-Teil des DPS-Meters für Marlon + Freunde. **Nur Free-Plan-Features. Nichts öffentlich:** ohne Login
liefert der Server nur eine schlichte Login-Seite (neutraler Titel, `noindex`), alle anderen Dateien erst mit gültiger Session.

- **Live-Relay:** Jede App schickt 1×/s ihren Snapshot per WebSocket; alle bekommen die zusammengeführte Gruppenansicht.
  Ein Durable Object pro Raum mit WebSocket-Hibernation (keine Kosten im Leerlauf).
- **Kampf-Upload (automatisch):** Die App lädt jeden gespeicherten Bosskampf (FightRecord-JSON) hoch. Uploads mehrerer
  Mitglieder vom selben Kampf werden zu einem Kampf zusammengeführt (idempotent). Auswertung in **D1**, Original gzip im DO.
- **Dashboard** (nach Login, Theme „Atreia Gold“, Handy-tauglich):
  **Start** (Einführung, Download mit Version aus der GitHub-API, Installationsschritte) · **Übersicht** (Karte je Mitglied
  mit Ø-DPS 7 Tage + Trendpfeil, Gruppenzahlen, wer führt pro Boss, letzte Kämpfe, Live-Panel) · **Mein Bereich**
  („Wer bist du?“, KPIs, Verlauf, Rekorde je Boss, letzte Kämpfe; umschaltbar) · **Vergleich** (Kennzahlen als Balken,
  Verlauf, pro Boss) · **Kämpfe** (Liste + Detail mit DPS-Kurve, Skill-Analyse, Skill-Zeitleiste, Boss-HP, Ping) ·
  **Live** · **Event-Timer** · **Mitglieder**.
- **Nur wir:** Überall erscheinen ausschließlich Raum-Mitglieder. Alle anderen Spieler zählen im Bossschaden (und damit in
  den Anteilen) mit und stehen höchstens als Sammelzeile „Andere (n)“ da.
- **App-Anbindung:** siehe [PROTOCOL.md](PROTOCOL.md).

## Mitglieder (wer zählt als „wir“?)

Standard: jeder Name, der sich mit der App verbindet (`hello`) oder einen Kampf hochlädt, wird Mitglied. Testnamen oder
Tippfehler blendet man im Dashboard unter **Mitglieder** aus (Daten bleiben, wieder einblendbar).
Wer es strikt will, setzt in `wrangler.jsonc` die Variable `ROOM_MEMBERS` (z. B. `"atreia-trio:marloms|Name2|Name3"`):
dann zählen nur diese Namen und die Verwaltung im Dashboard ist schreibgeschützt.

## Zugang / Sessions

- Login-Seite: Raum + Passwort (= Raum-Secret) oder Einladungslink `https://<host>/#/join/<raum>/<secret>`
  (das Fragment geht nie an den Server; die App verwendet denselben Link).
- Danach ein **HttpOnly-, SameSite=Strict-Cookie** (Secure unter https), 30 Tage („Angemeldet bleiben“) bzw. 1 Tag als
  Sitzungs-Cookie, signiert per HMAC über Raum + Ablauf + Hash des Raum-Secrets mit `SESSION_KEY`. Secret-Wechsel ⇒ alle
  Sessions ungültig. Das Secret liegt nicht im JS/localStorage. Abmelden löscht das Cookie.
- Die App nutzt weiter `Authorization: Bearer <secret>` bzw. das Secret im WebSocket-`hello`.
- `run_worker_first: true`: der Worker prüft jede Anfrage. Öffentlich sind nur HTML-Aufrufe (→ Login-Seite),
  `/login.js`, `/login.css`, `/robots.txt`, `/api/session`, `/api/health`.
- Fehlt `SESSION_KEY` (lokal), wird der Schlüssel aus `ROOMS` abgeleitet – in Produktion `SESSION_KEY` setzen.

## Ordner

```
cloud/
  wrangler.jsonc            Worker, Durable Object "Room", D1 "a2dps", Assets (alles durch den Worker), Build-Schritt
  migrations/               0001 Schema, 0002 Mitglieder ausblenden
  src/
    index.ts                Routing, Session-Gate für Dateien, API-Auth (Bearer oder Cookie), CORS
    session.ts              signierte Session-Cookies
    auth.ts                 Raum-Secrets (Digest-Vergleich), Origin/CORS
    members.ts              wer zählt zur Gruppe (members.hidden, ROOM_MEMBERS)
    protocol.ts / merge.ts  Live-Snapshots → Gruppenansicht (nur Mitglieder + „Andere“)
    room.ts                 Durable Object: WebSocket-Relay, Uploads (serialisiert), Rohdaten
    fights.ts / store.ts    FightRecord → Detail, Zusammenführung, D1-Schreiben
    stats.ts                D1-Abfragen: Übersicht, Mein Bereich, Vergleich, Kampfliste, Trends, Mitglieder
  public/
    login.html/.js/.css     einzige öffentliche Seite
    index.html, app.js, style.css, js/*.js   Dashboard (nur mit Session)
    shared/                 ← beim Build kopiert: events.json + schedule.js aus app/public/fork (nicht von Hand ändern)
  scripts/sync-shared.mjs
  test/simulate.mjs         End-to-End-Test (Live, Upload, Statistik, Mitglieder, Session)
  test/seed.mjs             Testdaten: 3 Mitglieder (marloms, Lyrienne, Kaedros) + Fremde, ~45 Tage; optional Live-Kampf
```

## Lokal starten und testen

```bash
cd app/cloud
npm install
cp .dev.vars.example .dev.vars        # Raum testraum / dev-secret-bitte-aendern-123, SESSION_KEY
npm run db:migrate:local
npm run dev                           # http://127.0.0.1:8787
npm test                              # zweites Terminal (BASE=http://127.0.0.1:8787)
node test/seed.mjs --live 120         # Demo-Daten + 2 min Live-Kampf (--live-only: nur Live)
```

Eine zweite, saubere Instanz neben einer laufenden (z. B. für Tests):
```bash
npx wrangler d1 migrations apply a2dps --local --persist-to .wrangler/test-state
npx wrangler dev --port 8788 --inspector-port 9239 --persist-to .wrangler/test-state
BASE=http://127.0.0.1:8788 node test/seed.mjs
```
`npm test` legt Test-Mitglieder (Marlon, Freund1, Freund2 …) im Raum an – deshalb für Demo-Daten eine eigene Instanz nehmen.
Lokale DB zurücksetzen: wrangler dev stoppen, `.wrangler/state` (bzw. den `--persist-to`-Ordner) löschen, Migrationen neu anwenden.
Neue Dateien in `public/` sieht `wrangler dev` erst nach einem Neustart.

Testergebnis (03.10.2026, eigene Instanz auf Port 8788): **76/76 bestanden** – u. a. Session-Login/Logout, gesperrte
Dateien ohne Cookie, manipuliertes Cookie, Cookie nur für den eigenen Raum, Dashboard-WebSocket per Cookie ohne Secret,
Fremde in Kampfdetail/Liste ausgeblendet (als „Andere“ gezählt), Mitglieder aus-/einblenden, Übersicht/Mein Bereich/Vergleich,
dazu alle bisherigen Live-/Upload-Tests und ein echter 4,7-MB-Weltboss-Record.

Eigenheiten von `wrangler dev`: Schließt der Server einen *anderen* Socket (Hello-Timeout, Ablösung), kommt der Close-Frame
erst beim nächsten Verkehr an – der Server schickt vorher `{"t":"error","code":…}`. Ein zu großer Upload kommt lokal teils
als 500 statt 413 zurück.

## Deployment (macht Marlon)

**Kurzweg:** `npx wrangler login`, dann `.\deploy.ps1 -Room marlon-crew`. Legt D1 an, trägt die ID ein, migriert, deployt, setzt `ROOMS`/`SESSION_KEY` einmalig und schreibt Passwort + Einladungslink nach `zugang.txt` im Projektordner (außerhalb des Repos).

1. `cd app/cloud && npm install`
2. `npx wrangler login` (Cloudflare-Konto, Free Plan reicht)
3. `npx wrangler d1 create a2dps` → `database_id` in `wrangler.jsonc` eintragen
4. `npm run db:migrate:remote` (wendet 0001 + 0002 an)
5. Zwei Zufallswerte erzeugen: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` (2×)
6. `npx wrangler secret put ROOMS` → `raumcode:<wert1>` (mehrere Räume mit Komma)
7. `npx wrangler secret put SESSION_KEY` → `<wert2>` (signiert die Login-Cookies; Ändern meldet alle ab)
8. Optional `ROOM_MEMBERS` in `wrangler.jsonc` setzen (siehe oben). `ALLOWED_ORIGINS` steht auf `http://tauri.localhost` (App-Webview).
9. `npm run deploy` → `https://a2dps-cloud.<konto>.workers.dev`
10. Freunden den Einladungslink `https://…/#/join/<raum>/<wert1>` privat schicken – er funktioniert im Browser und in der App.

Secret wechseln: Schritt 6 wiederholen (Sessions und App-Verbindungen müssen sich neu anmelden).

## Kosten (Free Plan, 3 Spieler, ~4 h/Tag)

| Posten | Rechnung | pro Tag | Free-Limit |
|---|---|---|---|
| Live-Nachrichten | 3 × 1/s × 14 400 s = 43 200 WS-Nachrichten, Abrechnung 20:1 | ~2 200 DO-Requests | 100 000 |
| Worker-Requests: App | WS-Verbindungen + ~90 Uploads | ~300 | 100 000 (gesamt) |
| Worker-Requests: Dashboard | **jetzt inkl. Dateien** (alles läuft durch den Worker): ~16 Dateien je Seitenaufruf + 2–5 API-Aufrufe je Ansicht; 3 Personen × ~20 Aufrufe | ~1 500–3 000 | (gesamt) |
| DO-Laufzeit | während Kämpfen ~durchgehend aktiv: 14 400 s × 128 MB | ~1 800 GB-s | 13 000 GB-s |
| D1 geschrieben / gelesen | ~100 Zeilen je Upload; Statistik-Abfragen | ~9 000 / < 1 Mio. | 100 000 / 5 Mio. |
| Speicher | D1 ~0,1–0,4 MB je Kampf, max. 5 000 Kämpfe; Rohdaten max. 400 Uploads im DO | ~3–12 MB/Tag | 5 GB + 5 GB |

Worker-Requests gesamt ≈ 2 000–6 000/Tag (≤ 6 % des Limits), CPU je Datei-Anfrage < 1 ms (nur Cookie-HMAC). Größter
Posten bleibt die DO-Laufzeit (~15 %). Wird ein Limit gerissen, schlagen nur weitere Operationen bis 00:00 UTC fehl – keine Kosten.

## Sicherheit

- Nichts ohne Login: Dateien, API und Live nur mit Session (Dashboard) oder Raum-Secret (App).
- Raum-Secret nur als SHA-256-Digest im Speicher, Vergleich mit `timingSafeEqual`, nie geloggt; Invocation-Logs (mit Headern) aus.
- Session-Cookie HttpOnly + SameSite=Strict (+ Secure), HMAC-signiert, an Raum und Secret gebunden; Login/Logout nur von der eigenen Origin.
- CORS/Origin: nur das eigene Dashboard + `ALLOWED_ORIGINS`. CSP `script-src 'self'`, `connect-src 'self' https://api.github.com`, `frame-ancestors 'none'`, `noindex`.
- Größen/Drosselung: WS-Nachricht 16 KB, Upload 8 MB (entpackt 32 MB), 24 Spieler/Snapshot, 8 Apps + 20 Viewer je Raum, 1 Snapshot/s, 300 Uploads/h.

## Offen

- `database_id` nach `wrangler d1 create` eintragen (Platzhalter in `wrangler.jsonc`).
- Download-Button: Die GitHub-API liefert für `maarloms/A2Tools-DPS-Meter` derzeit **404** (noch kein Release oder Repo privat) –
  dann führt der Button auf die Release-Seite. Mit dem ersten öffentlichen Release mit `.msi`-Asset erscheinen Version + Direktlink.
- Kill/Wipe, echte Namen von Mitspielern ohne App, Dungeon-Namen: siehe PROTOCOL.md Abschnitt 5.
- Zusammenführung über `mobCode` + `dungeonId` + Start (±45 s) bzw. gleiche `targetId` – im Spiel mit zwei Uploadern prüfen.
