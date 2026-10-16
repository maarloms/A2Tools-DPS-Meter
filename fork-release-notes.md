**Neu**
- Odyle-Energie unter dem Meter, so wie das Spiel sie anzeigt (Basis und aufgeladen). Einschalten in den Einstellungen (Bereich Meter) mit „Odyle-Energie anzeigen“. Nach einem Neustart steht der zuletzt gesehene Wert blass da, bis das Spiel ihn neu schickt.
- Details: neue Werte Ø DPS, Spitzen-DPS (beste 5 Sekunden), erlittener Schaden und Tode; die Kritrate steht neben den Casts, Mehrfachtreffer und ihr Schaden darunter. Die Kampfzeit steht im Titel.
- Details-Gruppenliste im Farbtheme des Meters; Spitzen-DPS dort per Schalter im Einstellungsmenü der Details.
- Neben Spielernamen kann jetzt „Beides“ stehen: Kampfkraft und Ausrüstungswert zusammen (mit dünnem dunklem Rand, besser lesbar).
- Kampfverlauf: Albtraum-Stufe wird benannt, dazu die Stufe jedes Bosses.
- Balken-Texturen jetzt auch auf der Boss-HP-Leiste und in der Details-Gruppenliste.
- Neue A2Tools-Funktionen unter Einstellungen → Erweitert: „Feldboss-Timer teilen“ (über a2tools.app) und „A2Tools-Nutzer in meiner Gruppe zeigen“ (kleines A2 neben dem Namen). Beide sind im Fork standardmäßig aus und lassen sich dort einschalten. Der Event-Timer braucht sie nicht, er hat seine eigenen Feldboss-Timer. Achtung beim A2-Tag: Gruppenmitglieder mit A2Tools sehen daran, dass du ein Meter nutzt.
- Plugins: Schalter „Aktiviert“ je Plugin, Update-Hinweis beim Start in deiner Sprache; ein mit × geschlossenes Plugin bleibt bis zum nächsten Start zu.

**Behoben**
- Kritische Treffer werden richtig gezählt (der Schaden war bei Krits teils falsch gelesen).
- Erlittener Schaden: Treffer von Monstern auf Spieler zählen jetzt mit.
- Mehrfachtreffer-Rate wird so berechnet wie im Spiel.
- Weltbosse mit über 100 Millionen HP zeigen ihre Live-HP richtig an.
- Gruppe: Beim Verlassen einer Gruppe (offene Welt, Dungeon oder Raid) wird die Gruppenliste sofort aktualisiert; ohne Gruppe wird nichts gelöscht.
- Boss-Modus zeigt nur noch Bosse, nicht mehr ersatzweise deinen eigenen Trash-Mob.
- Das Debug-Log hört bei 5 MB nicht mehr auf, sondern legt die alte Datei als debug.old.log ab.

**Sonstiges**
- Kürzere Statustexte in der unteren Leiste; weniger Anfragen an a2tools.app.
- Basis jetzt A2Tools 2.0.66. Event-Timer, Overlay, GROUP-Modus, „Gruppe teilen“, meter.log und die eigenen Themes funktionieren wie bisher.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.22_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet das Meter beim ersten Start an, es herunterzuladen und zu installieren (Standardoptionen übernehmen, danach Meter neu starten).
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
