# Event-Timer (erste EU-Testversion)

Öffnen: Uhr-Button im DPS-Meter oder Strg+Alt+T. Derselbe Hotkey blendet
das Fenster aus und wieder ein. Wieder einblenden entsperrt Click-through.

Fensterposition, Größe, Sichtbarkeit, Eventauswahl, Transparenz und
Zeitkorrektur werden in der vorhandenen settings.json gespeichert.
Das Theme folgt dem DPS-Meter.

## Zeitplan

Quelle: Global-Client 1.0.21.0, Rohdaten von aion2.gaming.tools
(`schedules.d.json`). Events mit Serverzeit laufen auf der Regionsuhr,
für Europa `Europe/Berlin`; Resets auf 16:00 koreanischer Zeit.

| Event | Zeit (deutsch) | Stand |
|---|---|---|
| Raumzeit-Riss | täglich 02/05/08/11/14/17/20/23, Portal 10 min | ingame bestätigt (23:00, 02.10.) |
| Shugofesta | jede volle Stunde (9 wechselnde Minispiele) | Clientdaten |
| Dimensionale Invasion | jede halbe Stunde (3 Varianten) | Clientdaten |
| Artefakt-Eroberung | Mo/Do/Sa 21:00 | Clientdaten, ingame offen |
| Vollstrecker Tamasa · Agro · Kaira (Untere Ebene) | Mo/Do/Sa 21:30 | Clientdaten, ingame offen |
| Dhramos · Ducal · Maraka (Mittlere Ebene) | Mo/Do/Sa 21:30 | Clientdaten, ingame offen |
| Wächtergott Nahma / Wütender Wächtergott Nahma | Fr/So 21:00 | Clientdaten, ingame offen |
| Aufseherin Kaira | täglich 01/04/…/22 | Clientdaten, ingame offen |
| Arena der Strategie | täglich 11–14 und 19–21 | Clientdaten, ingame offen |
| Täglicher / wöchentlicher Reset (Mi) | 09:00 Sommerzeit, 08:00 Winterzeit | mehrere Quellen |

- aion2hub/gamers4.life rechnen Global mit GMT+9 (Belagerung wäre dann
  14:00 deutscher Zeit). Der Riss passt zu beiden Annahmen, deshalb einmal
  eine Belagerung oder Kaira ingame prüfen.
- Nach der Zeitumstellung am 25.10. bleibt der Riss auf 02/05/… deutscher
  Zeit (Regionsuhr). Ebenfalls ingame gegenprüfen.
- Nur KR/TW, nicht im Global-Client: Abyss-Riss-Zone, Raumzeit-Riss-Herrschaft.
- Feldbosse (Verteron/Altgard) respawnen nach Kill, kein fester Zeitplan.
- Neue Events mit `enabled: true` werden bei bestehenden Auswahlen einmalig
  dazugeschaltet (`preferences.known`).
- Eine Zeitkorrektur verschiebt alle Ereignisse gemeinsam.
## Einstellungen

Kompakte Schalter, einklappbare Eventgruppen und Auswahlzähler im Reiter
Events. Deckkraft mit Live-Prozentwert und Zeitkorrektur mit +/- im Reiter
Darstellung. Reiter sind auch mit Pfeiltasten erreichbar.
## Prüfen

npm run test:timer
npm run build
cd src-tauri
cargo test --lib

Browser-Vorschau: npm run preview und /timer.html.
Im Browser werden Filter in localStorage gespeichert; native Fensteraktionen
stehen nur in der Desktop-App zur Verfügung.
## Kampfdaten-Ansicht

Die Fork-Themes gestalten auch die Detailfenster: ruhiger Statistikbereich,
Spielerauswahl mit Auswahlrahmen, Skill-Zeilen mit Damage-Balken und passende
Menüs. Unter 850 px stehen Spieler und Statistiken untereinander. Die
Skill-Tabelle scrollt horizontal, wenn die eingeblendeten Spalten nicht passen.
Diagrammabschnitte lassen sich mit Enter und Leertaste öffnen und schließen.

Geprüft in einer getrennten Browser-Vorschau mit Beispieldaten bei 420, 640,
850 und 1280 px; Sortierung, Spaltenauswahl und die vier Fork-Themes geprüft.
Die Vorschau enthält keine echten Kampfdaten.
