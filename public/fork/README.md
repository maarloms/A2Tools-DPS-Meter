# Event-Timer (erste EU-Testversion)

Öffnen: Uhr-Button im DPS-Meter oder Strg+Alt+T. Derselbe Hotkey blendet
das Fenster aus und wieder ein. Wieder einblenden entsperrt Click-through.

Fensterposition, Größe, Sichtbarkeit, Eventauswahl, Transparenz und
Zeitkorrektur werden in der vorhandenen settings.json gespeichert.
Das Theme folgt dem DPS-Meter.

## Zeitplan

- Raum-Zeit-Riss: Global-Zeitplan 00/03/06/09/12/15/18/21 in Asia/Tokyo.
  Der Nutzer hat 23:00 Europe/Berlin am 02.10.2026 ingame bestätigt.
  Sommerzeit: 02/05/08/11/14/17/20/23 Uhr deutscher Zeit.
  Winterzeit: 01/04/07/10/13/16/19/22 Uhr deutscher Zeit.
- Portal-offen-Anzeige: 10 Minuten; kein 60-Minuten-Aufenthaltstimer.
- Feld-Events und Beritra: Community-Zeiten, EU noch nicht bestätigt.
  Deshalb standardmäßig aus, im Filter als unbestätigt markiert.
- Belagerungen erst nach Bestätigung ihrer EU-Zeiten.
- Quelle: https://aion2hub.com/tools/event-timer
- Daten: events.json; keine Remote-Datenaktualisierung in dieser Version.
- Eine Zeitkorrektur verschiebt alle Ereignisse gemeinsam.

## Prüfen

npm run test:timer
npm run build
cd src-tauri
cargo test --lib

Browser-Vorschau: npm run preview und /timer.html.
Im Browser werden Filter in localStorage gespeichert; native Fensteraktionen
stehen nur in der Desktop-App zur Verfügung.