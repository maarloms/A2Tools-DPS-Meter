# Wochenbild – Wochenrückblick als PNG in Discord

Der Worker (`cloud/`) rendert keine Bilder (zu viel CPU für den Free Plan). Stattdessen läuft jeden Mittwoch nach
dem Reset ein Claude-Agent lokal: Er holt die offenen Räume vom Worker, rendert je Raum ein PNG (satori + resvg)
und lädt es hoch. Der Worker postet es dann an den Discord-Webhook des Raums: die Karte mit dem Bild darin.

**Es gibt keine Text-Karte** (Vorgabe Marlon, 18.10.2026): Der Worker schickt den Rückblick nur als Bild – nie ohne
Bild, auch nicht nach einer Frist oder nach einem abgelehnten Bild. Ist der PC um 09:30 aus, wird das Bild nachgeholt,
sobald er an ist. Ein Raum bleibt im Worker offen (`/api/weekly/pending`), bis sein Bild gepostet ist; erst mit dem
nächsten Reset (Mittwoch 07:00 UTC) ersetzt die neue Woche die alte. Doppelt gepostet wird nie (Versand-Sperre im Worker).

## Geplante Aufgabe (Windows-Aufgabenplanung)

- Trigger: **wöchentlich, Mittwoch 09:30** (Ortszeit; liegt in Sommer- wie Winterzeit nach dem Reset um 07:00 UTC).
- Einstellung „Aufgabe so schnell wie möglich nach einem verpassten Start ausführen“ **an** → war der PC um 09:30 aus,
  läuft die Aufgabe, sobald er an ist.
- Wiederholung: **jede Stunde, Dauer 7 Tage** (bis zum nächsten Reset). Ein Lauf ohne offene Räume endet sofort mit
  `Nichts zu tun.` (Exit 0) und kostet nur eine kleine Abfrage; so wird ein fehlgeschlagener Post (Discord gestört,
  Bild abgelehnt) wiederholt, bis er durchgeht.
- „Neue Instanz nicht starten“, falls ein Lauf noch läuft.

## Ablauf für den wöchentlichen Agenten

1. **Zeitfenster:** ab Mittwoch nach dem Reset (07:00 UTC) bis zum nächsten Reset. Es gibt keine Frist am selben Tag –
   wird das Bild Tage später hochgeladen, wird es trotzdem gepostet.
2. **Vorbereiten** (in diesem Ordner): `npm ci`. Die Umgebungsvariablen `WEEKLY_BASE_URL` (Worker-Adresse,
   `https://…`) und `WEEKLY_RENDER_KEY` müssen gesetzt sein (Windows-Benutzervariablen). Den Key **nie** ausgeben,
   in Befehle schreiben oder in Berichte übernehmen.
3. **Probelauf:** `node run.mjs --dry-run`. Das Skript rendert nur und schreibt die PNGs nach
   `%TEMP%\wochenbild-<datum>\`. Ein Bild ansehen: stimmen Gilde, Woche/KW, Namen und Zahlen? Bricht etwas aus dem
   Rahmen oder ist abgeschnitten? Meldet das Skript `Nichts zu tun.`, ist die Woche schon gepostet bzw. ohne Kämpfe → fertig.
4. **Posten:** `node run.mjs` (Standard-Entwurf D „Sammelkarten“; anderer Entwurf: `--design a|b|c|e|f`).
   Die letzte Zeile `ERGEBNIS {...}` enthält je Raum `ok` und `result`.
5. **Fehler** (die Woche bleibt im Worker offen, nichts geht als Text raus):
   - Exit-Code **2** (Key falsch, Bild-Weg im Worker aus, URL falsch): nicht wiederholen, dem Leiter melden.
   - `Discord hat das Bild abgelehnt`: einmal mit `--design a` versuchen, sonst dem Leiter melden; der nächste
     geplante Lauf versucht es erneut.
   - `Worker nicht erreichbar` oder `HTTP 502 retry`/`rate_limited` (das Skript hat schon zweimal neu versucht):
     liegen lassen, der nächste geplante Lauf (stündlich) versucht es erneut.
   - `Webhook ungültig`: im Dashboard (Einstellungen) eine neue Webhook-Adresse hinterlegen lassen – danach ist die
     Woche wieder offen und der nächste Lauf postet das Bild. Dem Leiter melden.
   - `Rendern fehlgeschlagen` oder `größer als 1 MB`: einmal mit `--design a` versuchen, sonst liegen lassen und melden.
   - `übersprungen (… 409 …)`: schon gepostet oder Woche vorbei – kein Fehler.
6. **Bericht:** die `ERGEBNIS`-Zeile und den Pfad zum PNG an den Leiter/aufs Board, keine Schlüssel und keine URLs.

## Befehle

```
node run.mjs [--design d] [--dry-run] [--room <code>] [--out-dir <ordner>]
node render.mjs --data recap.json [--design d] [--out bild.png] [--room <code>] [--guild "Name"]
node samples.mjs [--design d] [--out-dir <ordner>]      # alle Entwürfe + Randfälle rendern (Probe)
node e2e-local.mjs                                       # End-to-End gegen wrangler dev (lokal, Discord-Ersatz)
```

- `run.mjs` liest Basis-URL und Key nur aus der Umgebung. Exit-Code 0 = erledigt/nichts zu tun, 1 = ein Raum nicht
  gepostet, 2 = Konfiguration/Zugang. `--dry-run` ohne gesetzte Umgebung nimmt `sample.json`.
- `render.mjs --data` nimmt ein Raum-Objekt oder die ganze Antwort von `GET /api/weekly/pending`.
- Ist ein PNG größer als 1 MB (Grenze des Workers), wird es schrittweise schmaler gerechnet (Entwurf E mit
  Pergament-Struktur landet bei ~870 px).

## Entwürfe

| `--design` | Entwurf | Größe |
|---|---|---|
| **d** (Standard) | Sammelkarten: Top 3 als Trading-Cards (Holo-Gold/Silber/Bronze), 1–2 Spieler zentriert | 1200×675 |
| a | Gilden-Trophäe: Podium Nachtblau/Gold | 1200×675 |
| b | Esports-Scoreboard: MVP + Rangliste | 1200×630 |
| c | Infografik: alle Mitglieder (bis 9), Klassen-Ring, Bosse | 1200×760 |
| e | Kriegschronik: Pergament, Fraktur, Strichlisten, Siegel | 1200×760 |
| f | Magazin-Cover „Gildenblatt“ | 1200×675 |

Neuer Entwurf: `designs/<x>.mjs` mit `export const size` und `export function build(data)`, Buchstabe in
`DESIGNS` (`render.mjs`) eintragen, mit `node samples.mjs --design <x>` prüfen. Satori-Stolperfallen stehen in
`../../mockups/README.md` (u. a.: Hintergründe als `svgUrl()`, gedrehte Elemente überdecken Nachbarn).

## Daten

`GET /api/weekly/pending` liefert je Raum: `week` (key, label, kw), `fights`, `kills`, Vorwoche, `dpsChange`,
`best`, `fastest`, `players` (alle Mitglieder: name, job = Klassen-ID 11–19 bzw. 0, dps, boss) und `bosses`
(boss, kills, tries, avgDps, change). Nie Webhook-URLs. `format.mjs → viewModel()` macht daraus die Daten der Entwürfe;
Gildenname = Raumcode („atreia-trio“ → „Atreia-Trio“), mit `--guild` überschreibbar.

**Portraits (später):** `avatar()` in `lib.mjs` zeigt `player.portrait` (data-URI), sonst das Klassensymbol.
`viewModel(room, { portraits: { name_lc: dataUri } })` ist schon vorgesehen; Upload/Ablage gibt es noch nicht.

Klassensymbole kommen aus `../../src/assets/<koreanischer Name>.png` (App), unbekannte Klassen bekommen ein neutrales Schild.
