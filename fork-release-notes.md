**Neu**
- Neue Menüs am Meter: Ein Klick auf die Ziel-Taste (TARGET/GROUP/BOSS/TRAIN/ALL) öffnet jetzt ein Menü mit allen Modi und kurzer Erklärung; Mausrad oder Rechtsklick auf die Taste schaltet wie bisher weiter. GROUP ist mit dabei. Die Werte-Taste öffnet ebenso ein Menü: Dort wählst du, wonach sortiert wird und welche Werte zusätzlich in den Zeilen stehen (Schaden pro Sekunde, Gesamtschaden, Erlittener Schaden, Heilung, Stagger).
- Im Werte-Menü lassen sich außerdem einschalten: Boss-Stagger % auf der HP-Leiste des Bosses, Kampfkraft und Ausrüstungswert neben den Namen, der Todeszähler (eine kleine Zahl hinter dem Namen, wie oft jemand im Kampf gestorben ist) und „Farben je Wert“.
- Fußleiste: Ein Klick auf Kampfzeit, Gruppensumme oder Odyle-Energie öffnet ein Menü, in dem du festlegst, was die Fußleiste zeigt (Geschätzte Kill-Zeit, Gruppensumme, Odyle-Energie, Ping). Diese Schalter standen vorher in den Einstellungen.
- Kampfverlauf: zeigt jetzt Gruppen-DPS und deine eigene DPS, lässt sich filtern und sortieren und markiert deine Bestwerte.
- Todesübersicht: Beim Gegner, der dich getötet hat, stehen jetzt auch Ausrüstungswert und Kampfkraft.

**Behoben**
- Meter-Fenster: Schiebt Windows das Meter hinter das Spiel, kommt es wieder nach vorn. Einstellungen, Kampfverlauf und Details springen nach vorn, wenn du ihre Taste drückst.
- Die Fensterhöhe des Meters wird nur noch zusammen mit einer neuen Position gespeichert; der Ziehgriff ändert nur noch die Breite.
- FPS-Anzeige unter Windows 11 funktioniert wieder.
- Plugin-Widgets: Wieder geöffnete Widgets bleiben versteckt, solange das Spiel nicht im Vordergrund ist; die Plugin-Leiste liegt nur dann oben, wenn Spiel oder Meter vorne sind.

**Sonstiges**
- Basis jetzt A2Tools 2.0.87.
- Sicherheit: Viele Härtungen aus der Sicherheitsprüfung von A2Tools sind übernommen: Downloads (Updates, Npcap, Plugins) werden schon beim Herunterladen auf ihre Größe begrenzt, Npcap wird nur noch aus dem eigenen Ordner bzw. System32 geladen und sein Installer muss von Nmap stammen, die Erfassung begrenzt, was manipulierter Netzwerkverkehr auslösen kann, und installierte Plugins werden bei jedem Start gegen ihren signierten Katalog geprüft. Auch die Update-Prüfung dieses Forks liest Antworten jetzt mit Größenbremse.
- Der neue Einstellungs-Tab „Neuigkeiten“ von A2Tools ist im Fork ausgeblendet; er zeigt nur die Notizen des Original-Meters. Die Neuerungen dieses Forks stehen weiter im Patchnotes-Fenster.
- „Bosskämpfe anonym teilen“, „Nützliche Daten mit A2Tools synchronisieren“ und der Party-A2-Tag bleiben aus, bis du sie selbst einschaltest. „Gruppe teilen“, Puppen-Test, HPS, Event-Timer und alle bisherigen Fork-Funktionen bleiben erhalten.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.32_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet der Installer an, es nach dem Setup herunterzuladen (Haken gesetzt lassen, Npcap-Setup mit den Standardoptionen durchklicken). Sonst fragt das Meter beim ersten Start danach.
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
