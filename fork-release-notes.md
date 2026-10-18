**Neu**
- Meter leeren beim Dungeon-Wechsel: Betrittst oder verlässt du einen Dungeon (auch beim erneuten Betreten desselben Dungeons), verschwindet der letzte Kampf vom Meter, statt bis zum nächsten Kampf stehen zu bleiben. Einstellbar unter Einstellungen → Meter-Einstellungen → „Meter leeren“ (Beim Betreten oder Verlassen eines Dungeons / Bei jedem Zonenwechsel / Nie). Der Kampf bleibt im Kampfverlauf gespeichert.
- Tastenkürzel mit 1 bis 3 Tasten: Unter Einstellungen → Tastenbelegung lässt sich jede Belegung frei mit einer bis drei Tasten setzen, dazu „Standard wiederherstellen“ und ein neues Kürzel „Plugin-Fenster zurückholen“ (standardmäßig nicht belegt). Der Event-Timer bleibt auf Strg+Alt+T.
- Update-Knopf: Neben der Versionsnummer in den Einstellungen prüft „Nach Updates suchen“ sofort, ob eine neue Version da ist; ein Update öffnet wie gewohnt das Fenster mit den Patchnotes.

**Behoben**
- Das Meter friert beim Speichern eines Kampfs nicht mehr ein. Bisher konnte das Speichern vor einem Zonenwechsel minutenlang hängen, dabei gingen Pakete verloren und das Meter stand still. Jetzt dauert es unter einer Sekunde und läuft im Hintergrund.
- Genauere Kampfdauer und DPS nach Lag: Treffer zählen zu dem Zeitpunkt, an dem sie ankamen, nicht wann sie verarbeitet wurden. Ein zwei Minuten langer Bosskampf wird nach einem Hänger nicht mehr als zwei Sekunden mit Fantasie-DPS angezeigt.
- Beim Beenden werden noch wartende Kämpfe vollständig gespeichert.
- Server-Erkennung mit ExitLag/VPN oder im LAN verbessert.

**Sonstiges**
- Basis jetzt A2Tools 2.0.73. Neue A2Tools-Meldungen zu Abyss-Artefakten und Dimensionskernen laufen über den Schalter „Feldboss-Timer teilen“ und sind im Fork wie bisher standardmäßig aus.
- Puppen-Test, HPS, Event-Timer, „Gruppe teilen“ und alle bisherigen Fork-Funktionen bleiben erhalten.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.26_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
