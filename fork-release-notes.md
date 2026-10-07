**Neu**
- Battle-Timer zeigt bei Bossen die geschätzte Zeit bis zum Kill (TTK).
- Details zeigen jetzt auch Block, Parry, Perfect Block, Ausweichen und Verfehlt.
- Stream-Overlay für OBS auf einem anderen PC im Heimnetz (Einstellungen → Streaming).
- Trainingspuppen werden auch dann erkannt, wenn ihr Spawn verpasst wurde.

**Genauer**
- Jeder Datensatz wird nur noch innerhalb seines eigenen Pakets gelesen: weniger falsche Namen und Zuordnungen.
- Die eigene Zeile wird über die ID erkannt statt über den Namen, auch wenn das Meter mitten in der Session gestartet wird. Sie wird nie mehr mit einem anderen Spieler zusammengelegt.
- Ticks eines Geists zählen nicht mehr, sobald er weg ist.
- Gift, Blutung, Verbrennung und HP-Wiederherstellung haben jetzt Namen.

**Stabiler**
- Kämpfe und Einstellungen werden über eine temporäre Datei gespeichert: ein Absturz beschädigt nichts mehr.
- Details, Verlauf und DPS-Berechnung laufen im Hintergrund, die Oberfläche bleibt flüssiger.

**Sonstiges**
- Basis aktualisiert auf A2Tools 2.0.53.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.12_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
