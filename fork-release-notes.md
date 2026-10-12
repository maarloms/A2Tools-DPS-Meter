**Wichtig: Einfrieren behoben**
- Das Meter konnte unter Windows einfrieren („Keine Rückmeldung“, keine Aufnahme mehr), wenn eine Taste genau in dem Moment beim Meter-Fenster ankam, in dem der Fokus wechselte. Ursache war ein Fehler in der Fenster-Bibliothek; sie ist jetzt auf dem neuen Stand (Tauri 2.12), der Hänger tritt nicht mehr auf. Update wird allen empfohlen.

**Neu**
- Einstellungen → Tastenbelegung: Schalter „Tastenkürzel verwenden“. Ausschalten gibt die Tasten sofort frei, ohne Neustart.
- Ist eine Tastenkombination schon von einem anderen Programm belegt (oder für zwei Aktionen vergeben), wird sie rot umrandet und der Grund steht darunter. Geänderte Tasten gelten sofort.
- Einstellungen → Plugins: geprüfte Erweiterungen aus einem signierten Katalog installieren, aktualisieren und entfernen. Plugins laufen in einem eigenen, abgeschotteten Fenster ohne Internet und sehen nur die Daten, die sie vorher ausdrücklich anfragen. Für Entwickler gibt es einen Entwicklermodus für lokale Ordner.

**Behoben**
- Buffs: Effekte, die das Spiel unter zwei Kennungen schickt (z. B. Sprint-Mantra), stehen nicht mehr doppelt da – eine Zeile pro Buff und Verursacher.
- Tastenbelegung: Als Standard für „Zurücksetzen“ wird jetzt Strg+Alt+R angezeigt – die Taste, die auch wirklich funktioniert (vorher stand dort fälschlich Strg+Alt+Umschalt+R).
- Details: Die Legende des Diagramms passt ins Diagramm und überdeckt den Bereich darunter nicht mehr.
- Ältere gespeicherte Kämpfe lassen sich wieder neu auswerten, auch wenn ihnen Angaben zum eigenen Charakter fehlen.

**Sonstiges**
- Basis aktualisiert auf A2Tools 2.0.60 (aktueller Stand).
- Strg+Alt+T für den Event-Timer funktioniert wie bisher und hängt nicht am neuen Schalter für Tastenkürzel.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.17_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
