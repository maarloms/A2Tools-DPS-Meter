**Neu**
- Stagger (optional): Unter Einstellungen → Meter-Einstellungen → „Stagger im DPS/DMG-Knopf anzeigen“ lässt sich ein weiterer Schritt STAG einschalten. Er zeigt, wie viel jeder Spieler von der Stagger-Leiste des Bosses abgezogen hat; der Tooltip einer Zeile schlüsselt das nach Skills auf. In den Details gibt es einen Abschnitt „Stagger“ mit jedem Stagger-Fenster auf der Zeitleiste: wer wie viel abgezogen hat und wie es endete (gebrochen, verpasst, Boss vorher besiegt …). Der Schalter ist standardmäßig aus. Hinweis: In den Fork-Designs zeigen die Meter-Zeilen im STAG-Schritt vorerst noch Schaden/DPS als Text; Tooltip und Details zeigen den Stagger.
- Updatesuche alle 6 Stunden: Läuft das Meter lange durch, sucht es alle 6 Stunden erneut nach einer neuen Version. Das Patchnotes-Fenster erscheint dabei je Version nur einmal (beim Start bzw. beim ersten Fund); danach bleibt nur der grüne Knopf in der Titelleiste, der es wieder öffnet. Einstellungen → „Nach Updates suchen“ öffnet es wie bisher jederzeit.
- Plugins erfahren, wann ihr Fenster bzw. ihr Reiter im Plugin-Dock ein- oder ausgeblendet wird. Ein Doppelklick auf ein Widget öffnet das Dock direkt auf dem Reiter des Plugins.

**Behoben**
- Gruppenfinder: Zeigte das Spiel die Mitgliederliste einer fremden Gruppe (z. B. im Gruppenfinder), hielt das Meter das für das Ende deiner Gruppe und beendete dabei den laufenden Kampf. Das passiert nicht mehr.
- Kampfkraft: Bei Gruppenmitgliedern, die von einer anderen Welt zu Besuch sind, wurde die Kampfkraft auf manchen Servern völlig falsch (viel zu hoch) angezeigt.
- Ein Spieler-Tooltip blieb stehen, wenn seine Zeile verschwand (neuer Kampf, Zurücksetzen, Gebietswechsel); er schließt sich jetzt. Auch hängengebliebene Tooltips unter Linux schließen sich.
- Windows: Das Schließen des Plugin-Docks konnte das Meter einfrieren. Beim Ziehen von Widgets (z. B. Event-Timer-Symbole) kostet das Meter keine Bildrate mehr.
- Plugins, die neu starten (z. B. beim Verschieben ins Dock oder heraus), lassen keine eingefrorenen Widgets mehr auf dem Bildschirm zurück.

**Sonstiges**
- Basis jetzt A2Tools 2.0.77.
- „Logs an den Entwickler senden“ bleibt im Fork abgeschaltet (der A2Tools-Knopf schickt ab 2.0.77 auch die debug.log mit, die Namen enthalten kann). Ein neuer Test stellt sicher, dass das so bleibt. Die A2Tools-Teilen-Schalter (Feldboss-Timer, Versorgungsaufträge, Party-A2-Tag) bleiben aus, bis du sie selbst einschaltest.
- Puppen-Test, HPS, Event-Timer, „Gruppe teilen“ und alle bisherigen Fork-Funktionen bleiben erhalten.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.29_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
