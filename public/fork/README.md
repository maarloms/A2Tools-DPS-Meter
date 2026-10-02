# Event-Timer (erste EU-Testversion)

Öffnen: Uhr-Button im DPS-Meter oder Strg+Alt+T. Derselbe Hotkey blendet
das Fenster aus und wieder ein. Wieder einblenden entsperrt Click-through.

Fensterposition, Größe, Sichtbarkeit, Eventauswahl, Transparenz und
Zeitkorrektur werden in der vorhandenen settings.json gespeichert.
Das Theme folgt dem DPS-Meter.

## Zeitplan

- Raum-Zeit-Riss: Global-Regel 00/03/06/09/12/15/18/21 UTC.
  Der Nutzer hat 23:00 Europe/Berlin am 02.10.2026 ingame bestätigt.
  Sommerzeit: 02/05/08/11/14/17/20/23 Uhr deutscher Zeit.
  Winterzeit: 01/04/07/10/13/16/19/22 Uhr deutscher Zeit.
- Portal-offen-Anzeige: 10 Minuten; kein 60-Minuten-Aufenthaltstimer.
- Shugofesta: jede volle Stunde. Minispiele sind wechselnde Varianten und
  werden nicht als unabhängig vorhersehbare stündliche Events dargestellt.
- Dimensionale Invasion: jede halbe Stunde. Beritra, Verfluchtes Schwert und
  Überfall der Naturgeister sind Varianten. Angezeigt wird ihr gemeinsamer Start.
- Basis: Global-Client 1.0.21.0, Europa-Ereigniskalender, Stand 30.09.2026:
  https://aion2.gaming.tools/de/event-calendar
- Riss-Gegenprüfung: https://aion2hub.com/tools/event-timer
- Belagerungen und weitere Bosse sind noch nicht eingebunden.
- Daten: events.json; keine Remote-Datenaktualisierung in dieser Version.
- Eine Zeitkorrektur verschiebt alle Ereignisse gemeinsam.
- Bestehende Minigame-/Beritra-Filter werden auf die gemeinsame Aktivität migriert.

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