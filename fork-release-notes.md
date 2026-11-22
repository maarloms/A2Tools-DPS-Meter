**Neu**
- Boss-Countdowns laufen jetzt auch dann auf die Sekunde, wenn die Uhr deines PCs falsch geht (ein PC, der 14 Sekunden nachging, sah Bosse 12 Sekunden vor dem Ende des Countdowns erscheinen). Das Meter misst die Abweichung dazu nur an der Antwort, die es für Plugins mit Boss-Timern ohnehin abruft, es schickt dafür keine eigene Anfrage. Plugins können die korrigierte Zeit abfragen (`a2.now()`), ohne dass sie eine Erlaubnis brauchen; sie bekommen nur die Uhrzeit, nichts über dich. Der Event-Timer des Forks rechnet weiter mit der PC-Uhr.
- Fenster-Diagnose im Debug-Protokoll: Wenn du unter Einstellungen das „Debug-Protokoll“ einschaltest, schreibt das Meter eine Momentaufnahme von Bildschirm, Monitoren und allen Fenstern (sichtbar, wo, wie groß, klickdurchlässig, immer oben) in die lokale Datei `debug.log`. Alternativ startet `A2TOOLS_DEBUG_LOG=1` das Protokoll sofort beim Start (wird nicht gespeichert). Das bleibt auf deinem PC; „Logs an den Entwickler senden“ bleibt im Fork aus.

**Behoben**
- Plugin-Widgets, die sich ausblenden, wenn weder Spiel noch Meter vorn sind: Ein neu geöffnetes Widget blieb vorher kurz sichtbar oder hielt den Fokus, obwohl ein anderes Programm vorn war. Es wird jetzt gleich versteckt gehalten und erscheint erst, wenn Spiel oder Meter wieder vorn sind (ohne Fensterrahmen).

**Sonstiges**
- Basis jetzt A2Tools 2.1.4. Der Rest der Neuerungen betrifft nur Linux (KDE/Wayland-Fenster, Plugin-Dock beim Start, Anleitung).
- Alle Fork-Funktionen bleiben erhalten. Das Teilen von Daten bleibt aus, bis du es selbst einschaltest; ein weiterer Test sichert ab, dass Serveruhr und Fenster-Protokoll nichts von sich aus senden.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.43_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet der Installer an, es nach dem Setup herunterzuladen (Haken gesetzt lassen, Npcap-Setup mit den Standardoptionen durchklicken). Sonst fragt das Meter beim ersten Start danach.
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
