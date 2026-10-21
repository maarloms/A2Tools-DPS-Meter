**Neu**
- Ausblenden, wenn AION2 geschlossen ist: Neuer Schalter unter Einstellungen → Meter-Einstellungen. Das Meter verschwindet, solange das Spiel nicht läuft, und erscheint beim Spielstart wieder. Plugins haben dafür unter Einstellungen → Plugins einen eigenen Schalter. Ein Meter, das du neben dem Event-Timer geschlossen hast, bleibt beim Spielstart zu.
- „Ausblenden, wenn AION2 nicht im Vordergrund ist“ nimmt jetzt auch Einstellungen, Kampfverlauf, Details und den Event-Timer mit: Sie verschwinden, solange ein anderes Programm vorne ist, und kommen mit dem Spiel zurück. Hast du den Event-Timer in der Zwischenzeit geschlossen, bleibt er zu.
- Schriftart: Unter Einstellungen → Darstellung → Allgemein lässt sich die Schrift für Meter, Einstellungen, Kampfverlauf und Details wählen (Schrift der Anzeige, Systemschrift, Inter, Exo 2, Oxanium, JetBrains Mono, Atkinson Hyperlegible, Lexend, Andika). In den Fork-Designs wirkt die Wahl noch nicht überall, z. B. in den Details.
- Farben der Einstellungen: Das Einstellungsfenster kann eigene Farben bekommen (Meter-Farbschema, Mitternacht, Graphit, Violett, Wald, Karmesin und elf weitere); das Meter behält sein Farbschema. Die Darstellung ist in vier Gruppen sortiert (Allgemein, Farben, Layout, Deckkraft).
- Plugins-Seite neu: Installiert/Verfügbar als Reiter, Suche, eine Zeile je Plugin, Details per Klick.

**Behoben**
- Treffer in einen Schild werden richtig gezählt. Bisher konnte ein Treffer in einen Schild als viel zu großer Wert erscheinen (z. B. 581 als 8.968), und DoT-Schaden in einen Schild fehlte ganz.
- Serverwechsel: Das Meter folgt dem Spiel nach wenigen Sekunden auf die neue Verbindung, statt bis zu zwei Minuten auf der alten zu hängen. So fehlt nach einem Wechsel nichts mehr (z. B. die Begleiter-Liste). Direkt nach einem Wechsel kann einmalig eine Lag-Warnung erscheinen; das ist harmlos.
- Der Haken bei „Ausblenden, wenn AION2 nicht im Vordergrund ist“ zeigt jetzt, was wirklich gilt: Er war bisher angehakt, obwohl die Funktion aus war. Wer sie nutzen will, schaltet sie einmal ein.

**Sonstiges**
- Basis jetzt A2Tools 2.0.75. Kein neuer Datenversand; „Feldboss-Timer teilen“ und die übrigen A2Tools-Teilen-Schalter bleiben im Fork wie bisher standardmäßig aus.
- Puppen-Test, HPS, Event-Timer, „Gruppe teilen“ und alle bisherigen Fork-Funktionen bleiben erhalten.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.27_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
