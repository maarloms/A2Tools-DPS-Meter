# Protokoll für die App-Anbindung (v1)

Alles, was die Desktop-App (Tauri, Rust + JS) braucht, um **live zu teilen** und **Kämpfe automatisch hochzuladen**.
Der Server ist `app/cloud/` (Cloudflare Worker + Durable Object + D1). Quelle der Wahrheit für Limits: `src/protocol.ts`.

Basis-URL: `https://<worker>.workers.dev` (lokal `http://127.0.0.1:8787`). Alle API-Pfade liegen unter
`/api/rooms/<raum>/…`. `<raum>` = Raum-Code, Kleinbuchstaben/Ziffern/Bindestrich, 3–32 Zeichen.

## 1. Auth

- Ein Raum hat **Code + Secret** (Secret ≥ 16 Zeichen). Definiert im Worker-Secret `ROOMS` (`code:secret,code2:secret2`).
- **HTTP:** Header `Authorization: Bearer <secret>`. Falscher Code oder falsches Secret → `401` (nicht unterscheidbar).
- **WebSocket:** Secret **nicht** in der URL, sondern in der ersten Nachricht (`hello`). Ohne gültiges `hello` innerhalb 10 s
  wird die Verbindung geschlossen.
- Das Secret nie loggen. Der Server loggt es nicht; Invocation-Logs mit Headern sind abgeschaltet.
- **Origin:** Clients ohne `Origin`-Header (Rust/reqwest, tokio-tungstenite) sind immer erlaubt. Browser-/Webview-Clients nur
  von der Dashboard-Origin oder aus `ALLOWED_ORIGINS`. **Läuft der Client im Tauri-Webview per JS**, muss dessen Origin
  (Windows: `http://tauri.localhost`) in `ALLOWED_ORIGINS` (wrangler.jsonc) stehen – sonst `403`. Empfehlung: Upload in Rust.

- **Dashboard (Browser):** meldet sich über `POST /api/session` an und bekommt ein HttpOnly-Session-Cookie (siehe Abschnitt 4).
  Die API akzeptiert **entweder** `Authorization: Bearer <secret>` (App) **oder** dieses Cookie (nur für den eigenen Raum, nur
  von der Dashboard-Origin). Ohne Session liefert der Server außer der Login-Seite keine Dashboard-Datei aus.

Die App braucht also 3 Einstellungen: **Server-URL, Raum-Code, Raum-Secret** (+ Schalter „Live teilen“).

## 2. Live-Sharing (WebSocket)

`GET wss://<host>/api/rooms/<raum>/ws` (Upgrade). Nur Text-Frames mit JSON, max. **16 KB** pro Nachricht.

### 2.1 Client → Server

**hello** (erste Nachricht, Pflicht)
```json
{ "t": "hello", "v": 1, "secret": "<raum-secret>", "role": "app",
  "clientId": "e3b1c2d4-…", "name": "marloms", "wantGroup": true }
```
| Feld | |
|---|---|
| `role` | `"app"` (sendet Snapshots) oder `"viewer"` (nur lesen, z. B. Dashboard) |
| `clientId` | stabil pro Installation, `[A-Za-z0-9_-]{8,64}` (z. B. UUID einmalig erzeugen und in settings.json speichern). Gleiche ID verbindet neu → alte Verbindung wird abgelöst. |
| `name` | **Charaktername des Spielers, exakt wie im Spiel** (max. 24 Zeichen). Wichtig: Derselbe Name dient als `uploader` beim Upload und wird zum Auflösen maskierter Namen („Ma***s“) genutzt. Wird als Gruppenmitglied gespeichert. |
| `wantGroup` | `false` = keine Gruppenansicht zurückschicken (spart Bandbreite, wenn die App sie nicht anzeigt). Default `true`. |

**snap** – eigener Live-Stand, **höchstens 1× pro Sekunde** (schnellere werden verworfen, Hinweis `rate_limited`;
dauerhaftes Fluten → Close `4008`). Nur senden, wenn sich etwas geändert hat und `map` nicht leer ist.
```json
{ "t": "snap", "seq": 42, "battleTime": 51234, "dungeonId": 600072,
  "target": { "id": 9001, "name": "Vakron", "mode": "bossTargets", "maxHp": 9857819, "hp": 8123000, "dealt": 1734819 },
  "players": [
    { "id": 85683, "name": "marloms", "job": "검성", "dps": 13512.4, "dmg": 411800, "share": 30.0, "cp": 3100, "self": true },
    { "id": 85963, "name": "Kaedros", "job": "마도성", "dps": 12400.0, "dmg": 371200, "share": 27.1, "cp": 3050, "self": false }
  ] }
```
Abbildung aus `DpsData` (500-ms-Tick, Event `dps-update`, Felder camelCase):

| snap | DpsData / PersonalData |
|---|---|
| `battleTime` | `battleTime` (ms) |
| `dungeonId` | `dungeonId` |
| `target.id / name / mode` | `targetId`, `targetName`, `targetMode` |
| `target.maxHp` | `targetMaxHp` (0 = unbekannt) |
| `target.hp` | `targetCurrentHp` (−1 = unbekannt → Server rechnet `maxHp − dealt`) |
| `target.dealt` | `targetTotalDamage` |
| `players[].id` | Schlüssel in `map` (Entity-ID) |
| `players[].name/job` | `nickname`, `job` (koreanischer Klassenname wie geliefert, das Dashboard übersetzt) |
| `players[].dps/dmg/share/cp` | `dps`, `amount`, `damageContribution` (0–100), `combatPower` |
| `players[].self` | `id == localPlayerId` |

Max. 24 Spieler pro Snapshot (Server sortiert nach `dmg` und schneidet ab). `seq` frei hochzählen.

JS-Beispiel (Webview, Event `dps-update`):
```js
let last = 0, seq = 0, lastKey = "";
listen("dps-update", ({ payload: d }) => {
  if (!ws || ws.readyState !== 1 || !Object.keys(d.map).length) return;
  const now = Date.now(); if (now - last < 1000) return;
  const key = d.targetId + ":" + d.battleTime + ":" + d.targetTotalDamage; if (key === lastKey) return;
  last = now; lastKey = key;
  ws.send(JSON.stringify({ t: "snap", seq: ++seq, battleTime: d.battleTime, dungeonId: d.dungeonId,
    target: { id: d.targetId, name: d.targetName, mode: d.targetMode, maxHp: d.targetMaxHp, hp: d.targetCurrentHp, dealt: d.targetTotalDamage },
    players: Object.entries(d.map).map(([id, p]) => ({ id: +id, name: p.nickname, job: p.job, dps: p.dps, dmg: p.amount,
      share: p.damageContribution, cp: p.combatPower, self: +id === d.localPlayerId })) }));
});
```

**clear** – eigener Stand zurückgesetzt (Meter-Reset, neuer Kampf ohne Daten): `{ "t": "clear" }`

**get** – Gruppenansicht sofort anfordern (max. 1/s): `{ "t": "get" }`

**bosses** – Feldboss-Timer (nur Apps), nach `welcome` alle eigenen, danach jede Änderung:
```json
{ "t": "bosses", "timers": [ { "code": 2400800, "killedAt": 1790987000000, "respawnAt": null, "seenAt": null,
  "intervalMin": 120, "by": "marloms", "updated": 1790987000000 } ] }
```
Max. 32 pro Nachricht. Pro `code` gewinnt das höchste `updated`; ältere Meldungen werden still verworfen.

**Heartbeat:** alle 25–30 s den Text `ping` senden (kein JSON). Antwort `pong` kommt vom Runtime, ohne das Durable Object
aufzuwecken (kostenlos). 

### 2.2 Server → Client

**welcome** (nach gültigem hello)
```json
{ "t": "welcome", "v": 1, "role": "app", "room": "atreia-trio", "serverTime": 1790987000000,
  "limits": { "snapIntervalMs": 1000, "minSnapIntervalMs": 900, "maxMessageBytes": 16384, "maxPlayersPerSnap": 24 } }
```

**group** – zusammengeführte Gruppenansicht, höchstens alle 500 ms, an alle mit `wantGroup`:
```json
{ "t": "group", "ts": 1790987001234,
  "members": [ { "clientId": "…", "name": "marloms", "online": true, "state": "fighting", "updatedAt": 1790987001000,
                 "target": "Vakron", "encounter": "9001|Vakron", "battleTime": 51234, "dps": 13512.4, "dmg": 411800 } ],
  "encounters": [ { "key": "9001|Vakron", "active": true,
      "target": { "id": 9001, "name": "Vakron", "mode": "bossTargets", "maxHp": 9857819, "hp": 8123000 },
      "battleTime": 51234, "dungeonId": 600072, "dealt": 1734819, "updatedAt": 1790987001000,
      "reporters": ["marloms", "Kaedros"],
      "players": [ { "name": "marloms", "job": "검성", "dps": 13512.4, "dmg": 411800, "share": 23.7, "cp": 3100,
                     "member": true, "src": "marloms" } ],
      "others": { "count": 2, "dmg": 563000, "share": 32.5 } } ] }
```
- **Nur Gruppenmitglieder** stehen in `members` (Mitglieder = Namen aus `hello`/`uploader`, ausgeblendete zählen nicht;
  optional feste Liste `ROOM_MEMBERS`). `players` enthält auch die Mitspieler im Kampf (`member: false`), höchstens 24
  nach Schaden; nur Kämpfe mit mindestens einem Mitglied erscheinen. Was darüber hinausgeht oder keinem Spieler gehört,
  fasst `others` zusammen – es zählt im Gesamtschaden und damit in jedem `share` mit (Anteil = Anteil am Bossschaden). Die App darf weiter alle Spieler schicken.
- `state`: `fighting` (Snapshot < 15 s), `idle` (verbunden), `offline` (getrennt; Stand bleibt bis 2 h sichtbar).
- Kämpfe werden über `target.id + target.name` gruppiert. Pro Spieler zählt der höchste gemeldete Schaden (= aktuellster),
  bei Gleichstand die Eigenmeldung. `share` wird neu berechnet (Anteil am Gesamtschaden auf das Ziel).
- Max. 4 Kämpfe (aktive zuerst), Kämpfe älter als 10 min fallen raus.

**bosses** – gleiches Format wie oben: nach `welcome` alle gespeicherten Timer des Raums, danach neue Meldungen
anderer Apps. Nur an Apps.

**fight** – ein Kampf wurde hochgeladen/aktualisiert: `{ "t": "fight", "fight": <Kampf-Zusammenfassung>, "replaced": false }`
**fightDeleted** – `{ "t": "fightDeleted", "id": "<fightId>" }`
**record** – neue Bestwerte aus einem gerade hochgeladenen Kampf, an Apps und Dashboards, einmal je Kampf und Spieler:
`{ "t": "record", "fightId": "…", "boss": "…", "mobCode": 2400017, "dungeonId": 0, "records": [ { "name": "Zhou", "kind": "dps", "value": 34210.5, "prev": 30122.1 } ] }`.
`kind`: `dps` (Kampfschnitt) oder `peak` (bestes 10-s-Fenster). Ein Rekord ist besser als jeder andere Kampf desselben Mitglieds gegen
denselben Boss (`mobCode` + `dungeonId`), ohne Training und ab 20 s Kampfzeit; der erste Kampf gegen einen Boss ist keiner.
Kämpfe, die älter als 3 h hochgeladen werden, melden nichts (gespeichert werden sie trotzdem).
**error** – `{ "t": "error", "code": "rate_limited", "message": "…" }`. Bei `hello_timeout` oder `replaced` selbst schließen.

### 2.3 Close-Codes

| Code | Bedeutung | App-Reaktion |
|---|---|---|
| 4001 `unauthorized` | Secret/Raum falsch | nicht neu verbinden, Einstellungen prüfen |
| 4001 `hello_timeout` / `hello_expected` | kein/falsches hello | neu verbinden |
| 4002 | Protokollversion | App aktualisieren |
| 4003 | `clientId`/`name` fehlt | Bug |
| 4004 `replaced` | gleiche clientId neu verbunden | nicht neu verbinden |
| 4005 `room_full` | > 8 Apps / > 20 Viewer | später erneut |
| 4008 `rate_limit` | zu viele Snapshots | Drosselung prüfen |
| 1009 | Nachricht > 16 KB | weniger Spieler senden |
| sonst | Netzwerk | Reconnect mit Backoff 1 s, 2 s, 4 s … max. 30 s |

## 3. Kampf-Upload (automatisch)

`POST /api/rooms/<raum>/fights?uploader=<Charaktername>` · `Authorization: Bearer <secret>`
· Body = **FightRecord-JSON genau wie in `AppData/…/history/<id>.json`** · `Content-Type: application/json`
· gzip empfohlen: Body gzip-komprimieren und `Content-Encoding: gzip` setzen (Server erkennt gzip auch an den Magic-Bytes).

Limits: Body max. **8 MB** (wie übertragen), entpackt max. 32 MB; 300 Uploads/Stunde/Raum (`429` + `Retry-After`).
Ein 4,7-MB-Weltboss-Record ist gzip ~0,5 MB.

**Wann hochladen:** jeder gespeicherte Bosskampf, solange die App in einem Raum ist und „Teilen“ an ist.
Empfehlung analog `share::wants_auto_upload`: nicht `isTrain`, Kampf seit ≥ 10 s vorbei
(`now - (startTimeMs + durationMs) >= 10000`), danach einmal hochladen. Erneutes Hochladen desselben Records ist
**idempotent** (gleicher Raum + Uploader + `FightRecord.id` ⇒ derselbe Eintrag wird ersetzt) – die App darf also auch nach
jeder Speicherung hochladen; Fehlschläge in eine Warteschlange und mit Backoff wiederholen.

Antwort `201` (neu) / `200` (ersetzt):
```json
{ "ok": true, "fightId": "6a319c11c0880f2b", "uploadId": "5d4c57c87fadd9b6", "replaced": false,
  "perspectives": 2, "url": "/#/fight/6a319c11c0880f2b", "rawBytes": 1130, "records": [] }
```
- **Zusammenführung:** Laden mehrere Mitglieder denselben Kampf hoch (gleicher Boss `mobCode` + `dungeonId`, Start ≤ 45 s
  auseinander oder gleiche `targetId` ≤ 10 min), wird daraus **ein** Kampf mit mehreren Perspektiven. Pro Spieler zählt
  seine eigene Messung, sonst der höchste Schaden. `perspectives` = Anzahl Uploads in diesem Kampf.
- Link fürs Dashboard: `<basis-url>` + `url`.
- `records`: neue Bestwerte, die erst dieser Upload ergeben hat (Format wie bei der Nachricht **record**).
- Fehler: `400 bad_record` (Struktur), `400 bad_request` (uploader fehlt/leerer Body), `401`, `413 too_large`, `429 rate_limited`.

Rust-Skizze (reqwest + flate2 sind schon Abhängigkeiten, `share::gzip` existiert):
```rust
let body = crate::share::gzip(&std::fs::read(history_path)?)?;
let res = client.post(format!("{base}/api/rooms/{room}/fights"))
    .query(&[("uploader", my_character_name)])
    .bearer_auth(&secret)
    .header("content-type", "application/json")
    .header("content-encoding", "gzip")
    .body(body).send().await?;
```

## 4. Dashboard-Endpunkte (optional für die App)

**Session (nur Dashboard):** `POST /api/session` `{"room","secret","remember":true}` → `200` + Cookie `a2s`
(HttpOnly, SameSite=Strict, Secure bei https, 30 Tage; HMAC über Raum + Ablauf + Secret-Hash mit `SESSION_KEY`).
`GET /api/session` → `{"room"}` oder `401`. `DELETE /api/session` → Logout.
Einladungslink `https://<host>/#/join/<raum>/<secret>`: die Login-Seite liest das Fragment (geht nie an den Server) und meldet an.

Raum-Endpunkte unter `/api/rooms/<raum>`, alle mit Bearer **oder** Session-Cookie; ohne Angabe `GET`:

| Pfad | Inhalt |
|---|---|
| `/live` | aktuelle Gruppenansicht (wie `group`) |
| `/fights?limit=50&before=<startMs>&boss=<mob>:<dungeon>&train=1` | Kampfliste (zusammengeführt), Paging über `next` |
| `/fights/<fightId>` | Detail: nur Mitglieder (`players`), Rest als `others` {count, dmg, share}; Skills, Zeitreihen, Skill-Zeitleiste, Ping, Perspektiven |
| `DELETE /fights/<fightId>` | Kampf für alle löschen |
| `/uploads/<uploadId>/raw` | Original-FightRecord (die letzten 400 Uploads je Raum) |
| `/members` | alle bekannten Namen: `{fixed, members:[{name, lastSeen, fights, active}]}` |
| `PATCH /members` | `{"name","active":false}` blendet einen Namen aus (Testname/Tippfehler), `true` wieder ein. Bei `ROOM_MEMBERS` gesperrt |
| `/stats/overview` | Übersicht: Karte je Mitglied (Ø-DPS 7 Tage + Vorwoche, Bestwert, Kämpfe, Klasse), Gruppenzahlen, Bestwert je Boss/Mitglied, letzte Kämpfe |
| `/stats/bosses` | Bosse mit Anzahl Kämpfe + Bestwert |
| `/stats/leaderboard?boss=<mob>:<dungeon>&days=30` | Top-15-Leistungen der Mitglieder an einem Boss |
| `/stats/player?name=<name>&days=30&boss=&bucket=&tz=` | Mein Bereich: KPIs (Ø/Best-DPS, Ø-Anteil, Kämpfe, Lieblingsboss, Vorperiode), Rekorde je Boss, letzte Kämpfe, Verlauf. Nur Mitglieder (sonst `not_member`) |
| `/stats/compare?days=30&boss=&bucket=&tz=` | Vergleich: Kennzahlen je Mitglied inkl. „Platz 1“ in gemeinsamen Kämpfen, Bestwerte je Boss, Verlauf |
| `/stats/trends?days=90&bucket=day\|week&tz=<min>&boss=` | Ø/Best-DPS und Anteil je Mitglied und Tag/Woche |

Alle Statistiken zeigen nur **Mitglieder**. Kämpfe ohne Mitglied fehlen in der Liste; Fremde zählen nur im Gesamtschaden mit.

## 5. Was der FightRecord nicht hergibt (für spätere App-Erweiterungen)

Der Server arbeitet mit dem, was `FightRecord` enthält. Für die gewünschten Auswertungen fehlt/wäre besser:

| Fehlt | Folge | Vorschlag für die App |
|---|---|---|
| Echte Namen der Gruppenmitglieder (`obscure_nickname` maskiert alle außer dem eigenen) | Server löst Masken nur für bekannte Mitglieder auf (mehrdeutige Masken bleiben maskiert); Mitspieler ohne App bleiben „Ka****s“ | optional `names` (actorId → Name) für Party-Mitglieder mitschicken – der Raum ist privat |
| Kill oder Wipe | „Schnellster Kill“ nicht möglich (Kampfzeit zählt auch bei Wipes) | Feld `killed` (aus `mark_entity_dead` / HP 0) |
| Schaden pro Treffer (nur Summe + Zeitstempel je Skill) | DPS-Kurve und Skill-Zeitleiste rechnen mit Ø-Schaden pro Treffer – wie das DPS-Diagramm der App selbst | Trefferliste `[t, dmg]` oder 1-s-Buckets je Skill |
| Dungeon-/Schwierigkeitsname | Dashboard zeigt nur `Instanz 600072` | Namen/Schwierigkeit mitschicken oder Mapping aus dem App-Frontend ins Dashboard übernehmen |
| Buffs/Debuffs, Tode, erlittener Schaden je Skill, Ausweichen | nicht auswertbar | eigene Felder, falls der Parser sie hat |
| `specs` (Skill-Spezialisierungen) | ungenutzt | Bedeutung der 5 Flags dokumentieren, dann anzeigen |
