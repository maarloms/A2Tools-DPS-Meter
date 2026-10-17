**Neu**
- HPS (Heilung pro Sekunde) und Gesamtheilung: Der DPS/DMG-Knopf am Meter wechselt jetzt auch zu HPS und HEAL. Heiler bekommen dadurch eine eigene Zeile mit Klasse, auch wenn sie kaum Schaden machen. Abschaltbar unter Einstellungen → Meter → „Heilung im DPS/DMG-Knopf anzeigen“.
- HPS-Anzeige in allen Themes, auch in den eigenen Fork-Themes: Im HPS/HEAL-Modus zeigen die Zeilen dort Heilung, HPS und Anteil an der Heilung, die Leiste oben HPS gesamt und Heilung.
- Titelleiste mit eigener Deckkraft: Einstellungen → Darstellung → „Deckkraft der Titelleiste“, wirkt auch in den eigenen Fork-Themes.
- Discord-Aktivität: erreicht jetzt jeden laufenden Discord (auch Vesktop oder Canary daneben), und ein hängender Discord hält die anderen nicht mehr auf. Unter Einstellungen → A2 Tools-Konto → „Zahl in Discord“ wählst du, ob nach deiner Stufe Kampfkraft, Ausrüstungswert oder nichts steht.
- Plugins: Plugins können kleine eigene Fenster (Widgets) öffnen, verschieben und fixieren. Neuer Schalter Einstellungen → Plugins → „DPS-Meter anzeigen“: aus, sieht man nur die Plugins, das Meter zeichnet im Hintergrund weiter auf.
- Plugin-Fenster öffnen sich wieder dort, wo du sie gelassen hast, und jetzt auch in der Größe, die du ihnen gegeben hast.

**Behoben**
- Klassen: Ein Zauberer wird nicht mehr mit dem Templer der Gruppe zu einer Zeile zusammengelegt, wenn der Name früher mit einer anderen Klasse gesehen wurde. Die Klasse eines Spielers hängt außerdem nicht mehr vom Zufall ab, sondern von den Skills mit dem meisten Schaden.
- Ein-/Ausblenden-Hotkey: Ein Meter, das nur von „Automatisch ausblenden“ versteckt wurde, wird wieder angezeigt statt ausgeschaltet. Der Hotkey merkt sich den Zustand jetzt über einen Neustart hinweg; ein neben dem Event-Timer geschlossenes Meter holt er wie bisher zurück.
- Einstellungen: Ein Klick auf die Versionsnummer öffnet die Release-Notes dieser Version im Fork (maarloms) statt im Upstream-Projekt.
- Plugins: × versteckt das Plugin-Fenster nur noch; das Plugin läuft weiter (Widgets, Hinweise), bis du es in den Einstellungen ausschaltest. „Öffnen“ zeigt es wieder.

**Sonstiges**
- Capture-Filter: Das Meter bekommt vom Netzwerk nur noch, was es für das Spiel braucht (weniger CPU-Last neben Browser und Launcher). Findet es mit offenem Spiel eine Minute lang nichts (z. B. hinter einem ungewöhnlichen Relay), schaltet es den Filter für die Sitzung wieder ab. Unter Windows wird der Filter nie während des Spiels umgestellt, damit keine Pakete verloren gehen.
- Hochladen von Kampfaufzeichnungen an a2tools.app bis 16 MB (vorher 4 MB); zu große Aufzeichnungen sagen das mit ihrer Größe.
- Basis jetzt A2Tools 2.0.69. Event-Timer, Overlay, GROUP-Modus, „Gruppe teilen“, meter.log und die eigenen Themes funktionieren wie bisher.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.23_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
