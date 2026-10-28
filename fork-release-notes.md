**Neu**
- Update-Prüfung jetzt direkt in der App: Das Meter fragt selbst bei den Fork-Releases auf GitHub nach einer neuen Version (beim Start, danach alle 6 Stunden und über den Knopf in den Einstellungen). „Jetzt installieren“ lädt nur Installer aus den Releases dieses Forks und installiert sie nur, wenn die Prüfsumme stimmt; sonst bricht es mit einer Meldung ab. Das Patchnotes-Fenster und der grüne Update-Knopf bleiben wie gewohnt.
- Meter bleibt fest an: Unter Einstellungen → Meter-Einstellungen lässt sich wählen, welcher Rand des Meters stehen bleibt, wenn Zeilen dazukommen oder wegfallen (Oben, Mitte oder Unten).
- Kampfverlauf: Die gruppierten Ansichten sind übersichtlicher, mit Bestzeit, Höchstwert und „Alle aufklappen“/„Alle zuklappen“.
- Plugins: „Plugins auto-aktualisieren“ unter Einstellungen → Plugins installiert Plugin-Updates beim Start im Hintergrund (Standard: Aus). Ein Update, das neue Rechte verlangt, wartet weiter auf dein Ja. Im Update-Hinweis steht jetzt, was in der neuen Plugin-Version neu ist.
- Plugins können mit deiner Erlaubnis nach deinem Tod sehen, welcher Spieler dich getötet hat und wer geholfen hat, und Bildschirmfotos ihres eigenen Fensters machen.
- Installer: Fehlt Npcap, bietet eine neue Seite im Installer an, es nach dem Setup herunterzuladen und zu öffnen (Haken ist gesetzt; Npcap-Setup wie gewohnt durchklicken).

**Behoben**
- Erfassung nach Paketlücken: Fehlen unterwegs Pakete, liest das Meter die Daten des Servers jetzt in der richtigen Reihenfolge weiter, statt danach Treffer zu verlieren.
- Boss-Erkennung: Bekommt ein neu erscheinender Gegner die Nummer eines zuvor besiegten, wird er jetzt mit seinem eigenen Namen erkannt.
- „Außerhalb des Kampfes ausblenden“ zeigt die Sekunden an statt „{seconds}“.
- Skill-Icons: Jeder Klassenskill hat jetzt sein eigenes Icon.
- Ein geschlossenes Plugin-Widget bleibt geschlossen, wenn die Maus darüber fährt; ausgeschaltete Plugins öffnen keine Icons mehr.

**Geändert**
- Datenschutz: Die Einstellungen haben einen eigenen Bereich „Datenschutz“. Dort stehen jetzt „Bosskämpfe anonym teilen“ und „Nützliche Daten mit A2Tools synchronisieren“; beide bleiben im Fork aus, bis du sie selbst einschaltest. Die Frage zum Teilen, die A2Tools beim Start zeigt, erscheint im Fork nicht. Der Text dort sagt jetzt, was der Fork selbst sendet: „Gruppe teilen“ schickt Live-DPS und Kämpfe mit Charakternamen an den eingetragenen Gruppenserver, „Diagnose senden“ nur auf Knopfdruck Logs und die letzten Kämpfe.
- Wer „Bosskämpfe anonym teilen“ selbst eingeschaltet hatte: A2Tools lädt jetzt erst hoch, wenn danach gefragt wurde. Den Schalter einmal aus- und wieder einschalten, sonst wird nichts mehr hochgeladen.
- Abyss-Bosse (Kaira, Tamasa, Argo, Nahma): Mit eingeschaltetem „Nützliche Daten mit A2Tools synchronisieren“ werden auch ihre Kills und HP geteilt.

**Sonstiges**
- Basis jetzt A2Tools 2.0.83.
- Sicherheit: Mehrere Punkte aus einer Sicherheitsprüfung von A2Tools sind übernommen (Links, Plugin-Fenster dürfen nur noch ihre eigenen Befehle nutzen, Discord-Antworten begrenzt). Die Update-Prüfung von A2Tools selbst ist im Fork abgeschaltet, damit nie das Original-Meter angeboten wird.
- „Gruppe teilen“, Puppen-Test, HPS, Event-Timer und alle bisherigen Fork-Funktionen bleiben erhalten. „Logs an den Entwickler senden“ bleibt im Fork abgeschaltet; der Party-A2-Tag bleibt aus, bis du ihn selbst einschaltest.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.31_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet der Installer an, es nach dem Setup herunterzuladen (Haken gesetzt lassen, Npcap-Setup mit den Standardoptionen durchklicken). Sonst fragt das Meter beim ersten Start danach.
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
