# Wochenbild – Wochenrückblick als PNG in Discord

Der Worker (`cloud/`) rendert keine Bilder (zu viel CPU für den Free Plan). Stattdessen läuft jeden Mittwoch nach
dem Reset ein Claude-Agent lokal: Er holt die offenen Räume vom Worker, rendert je Raum ein PNG (satori + resvg)
und lädt es hoch. Der Worker postet es dann an den Discord-Webhook des Raums: die bisherige Karte mit dem Bild darin.
Kommt bis **11:00 UTC** (12:00 MEZ / 13:00 MESZ) kein Bild, schickt der Cron des Workers wie bisher die Text-Karte.
Doppelt gepostet wird nie (Versand-Sperre im Worker).

## Ablauf für den wöchentlichen Agenten

1. **Zeitfenster:** Mittwoch zwischen 07:15 und 10:45 UTC (nach dem Reset um 07:00 UTC, vor der Frist).
   Nach 11:00 UTC nichts mehr hochladen, dann geht ohnehin die Text-Karte raus.
2. **Vorbereiten** (in diesem Ordner): `npm ci`. Die Umgebungsvariablen `WEEKLY_BASE_URL` (Worker-Adresse,
   `https://…`) und `WEEKLY_RENDER_KEY` müssen gesetzt sein (Windows-Benutzervariablen). Den Key **nie** ausgeben,
   in Befehle schreiben oder in Berichte übernehmen.
3. **Probelauf:** `node run.mjs --dry-run`. Das Skript rendert nur und schreibt die PNGs nach
   `%TEMP%\wochenbild-<datum>\`. Ein Bild ansehen: stimmen Gilde, Woche/KW, Namen und Zahlen? Bricht etwas aus dem
   Rahmen oder ist abgeschnitten? Meldet das Skript `Nichts zu tun.`, ist die Woche schon gepostet bzw. ohne Kämpfe → fertig.
4. **Posten:** `node run.mjs` (Standard-Entwurf D „Sammelkarten“; anderer Entwurf: `--design a|b|c|e|f`).
   Die letzte Zeile `ERGEBNIS {...}` enthält je Raum `ok` und `result`.
5. **Fehler:**
   - Exit-Code **2** (Key falsch, Bild-Weg im Worker aus, URL falsch): nicht wiederholen, dem Leiter melden.
   - `Discord hat das Bild abgelehnt`: nichts tun, der Worker schickt beim nächsten Cron-Lauf (zur Minute 15) die
     Text-Karte. Dem Leiter melden.
   - `Worker nicht erreichbar` oder `HTTP 502 retry`/`rate_limited` (das Skript hat schon zweimal neu versucht):
     nach 15 Minuten `node run.mjs` noch einmal, solange es vor 10:45 UTC ist. Sonst liegen lassen (Text-Karte kommt).
   - `Rendern fehlgeschlagen` oder `größer als 1 MB`: einmal mit `--design a` versuchen, sonst liegen lassen und melden.
   - `übersprungen (… 409 …)`: schon gepostet (Bild oder Text) – kein Fehler.
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
