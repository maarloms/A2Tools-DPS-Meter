**Neu**
- Server-Paarungen für Plugins: Plugins (zum Beispiel Event-Timer) erfahren, gegen welche Server dein Server im Abyss und im Raumzeit-Riss antritt. Die Liste lädt das Meter von a2tools.app und aktualisiert sie alle 6 Stunden. Im Fork passiert das nur, wenn du „Nützliche Daten mit A2Tools synchronisieren“ selbst einschaltest (standardmäßig aus); ohne den Schalter fragt das Meter die Liste nicht ab. Den Abyss-Gegner, den das Spiel selbst nennt, bekommen Plugins auch ohne Netzwerk.
- Plugins erhalten außerdem die Versorgungsaufträge-Tafeln des Servers (Tab, Zeitfenster, Aufträge) und die Ping-Schwankung (Jitter). Beides sind öffentliche Spieldaten, ohne Erlaubnis und ohne etwas zu senden.
- Einstellungen → Verbindung: „Das Spiel läuft auf einem anderen PC (gespiegelte Aufzeichnung)“ für Spieler, die den Netzwerkverkehr eines anderen PCs über einen Switch-Spiegelport mitlesen. Standardmäßig aus, wirkt nach einem Neustart des Meters.

**Behoben**
- Deutlich weniger Arbeitsspeicher: Die Seiten des Meters teilen sich jetzt einen Browser-Prozess, die Plugins einen zweiten, und kleine Fenster (Pins, Plugin-Widgets, Dock) sparen zusätzlich. Bei acht offenen Fenstern sank der Verbrauch bei Upstream von 656 auf 423 MB.
- Auf schlechten Leitungen lädt das Meter Plugins, Listen und Updates mehrmals nach (1 s, 3 s Pause), und ein abgebrochener Update-Download wird an der Stelle fortgesetzt (bis zu vier Mal), statt von vorn zu beginnen. Fällt das mehrmals hintereinander aus, erscheint einmal pro Start ein Hinweis mit dem üblichen Rat (Cloudflares 1.1.1.1-App).
- Die Aufzeichnung engt jetzt auch am Netzwerkgerät des Spiels auf den Spiel-Anschluss ein, damit lokale Proxys das Meter nicht mit fremdem Verkehr fluten (vorher bis zu 7,8 MB/s). Die Umstellung läuft über ein zweites Aufnahme-Handle, damit kein Spielpaket verloren geht.
- Die Plugin-Dock-Taste erkennt ein verstecktes Dock richtig; der erste Klick öffnet es sofort. Ein Klick auf Spieler bei offenen Details startet nicht mehr jedes Mal einen weiteren Hintergrundwächter.
- Server-Namen ergänzt: 1321 Gauss, 1322 Lamuatan, 2321 Agnita, 2322 Atiel, 2323 Tassin.

**Sonstiges**
- Basis jetzt A2Tools 2.0.99.
- Wenn du den automatischen Upload deiner Dungeon-Kämpfe selbst eingeschaltet hast: Kämpfe, die nie als Bosskampf zählen, werden beim Start nicht mehr jedes Mal neu geladen. Bei dir bleibt das aus, solange du den Upload nicht einschaltest; ein Test sichert das ab.
- Alle Fork-Funktionen bleiben erhalten. Das Teilen von Daten (Synchronisieren, Bosskämpfe, Ranglisten, Party-A2-Tag) bleibt aus, bis du es selbst einschaltest.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.41_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet der Installer an, es nach dem Setup herunterzuladen (Haken gesetzt lassen, Npcap-Setup mit den Standardoptionen durchklicken). Sonst fragt das Meter beim ersten Start danach.
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
