**Neu**
- Außerhalb des Kampfes ausblenden: Unter Einstellungen → Meter-Einstellungen → „Außerhalb des Kampfes ausblenden“ lässt sich eine Zeit wählen (Standard: Aus). Warst du so lange nicht im Kampf, blendet sich das Meter aus und erscheint mit dem nächsten Treffer von selbst wieder. Solange Einstellungen, Verlauf oder Details offen sind oder die Maus über dem Meter ist, bleibt es sichtbar. Ein neben dem Event-Timer geschlossenes Meter bleibt geschlossen.
- Test-Plugins: Unter Einstellungen → Plugins gibt es jetzt einen Bereich „Test-Plugins“ mit frühen Plugin-Versionen zum Ausprobieren. Sie sind signiert wie die anderen Plugins und werden erst installiert, wenn du es willst.
- Mehr Daten für Plugins: Plugins, denen du es erlaubst, sehen jetzt zu deinem Charakter u. a. Kampfkraft, Ausrüstungswert, Odyle-Energie, Inhalts-Zähler (z. B. tägliche Dungeons), Shop-Limits, Herstellungen, heute erhaltenes Kinah und Abyss-Punkte der Woche. Das bleibt auf deinem PC: Plugins haben keinen Internetzugriff.
- Als Administrator ausführen (Windows): Unter Einstellungen → Erweitert lässt sich das Meter als Administrator starten. Das ist nur nötig, wenn ein Plugin die Bildrate (FPS) des Spiels anzeigen soll; Windows fragt dann bei jedem Start nach. Standardmäßig aus.

**Geändert**
- Ein einziger Sync-Schalter: Die bisherigen Schalter „Feldboss-Timer teilen“ und „Versorgungsaufträge teilen“ sind zu einem Schalter zusammengefasst: Einstellungen → Erweitert → „Nützliche Daten mit A2Tools synchronisieren“. Er ist standardmäßig aus. Wichtig: Wer bisher das Teilen der Boss-Timer eingeschaltet hatte, muss den neuen Schalter selbst wieder einschalten.
- Bosskämpfe ohne Konto hochladen: Neu in A2Tools ist ein Schalter, der Bosskämpfe öffentlich und ohne Konto auf a2tools.app hochlädt. Im Fork ist er immer aus, auch bei einer Neuinstallation; du findest ihn unter Einstellungen → A2 Tools-Konto, wenn du ihn nutzen möchtest.

**Behoben**
- Plugin-Fenster und Widgets blenden sich jetzt auch dann mit einem nicht fokussierten Spiel aus, wenn das Meter selbst gerade ausgeblendet ist (z. B. solo oder von dir ausgeblendet); vorher blieben sie über anderen Programmen stehen.
- Buff-Zeitleiste: Buffs, die bisher nur als Nummer (z. B. #122400071) erschienen, tragen jetzt den Namen ihres Skills.
- Verlauf: Der Link eines hochgeladenen Kampfes ist anklickbar.

**Sonstiges**
- Basis jetzt A2Tools 2.0.79.
- Der neue Sponsor-Hinweis (ExitLag) und der Link „Weitere Spendenmöglichkeiten auf a2tools.app“ werden im Unterstützen-Fenster des Forks nicht angezeigt.
- Ein Fehler aus A2Tools 2.0.78 (das Meter-Fenster endete direkt unter der Boss-HP-Leiste und wuchs nicht mehr mit den Zeilen) war im Fork nie enthalten; ein neuer Test stellt sicher, dass das Fenster mit den Zeilen wächst.
- „Gruppe teilen“, Puppen-Test, HPS, Event-Timer und alle bisherigen Fork-Funktionen bleiben erhalten. „Logs an den Entwickler senden“ bleibt im Fork abgeschaltet; der Party-A2-Tag bleibt aus, bis du ihn selbst einschaltest.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.30_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
