**Neu**
- Layout bearbeiten: Meter, FP-Pin, Plugin-Dock und alle Plugin-Widgets lassen sich auf einmal entsperren und an ihren Platz ziehen (Einstellungen → Meter-Einstellungen → „Layout bearbeiten“, oder die Taste im Dock, oder eine eigene Taste unter Tastenkürzel, standardmäßig leer). Alle Teile sind umrandet und beschriftet, ein Teil rastet an Bildschirmrändern, der Mitte und den Kanten der anderen Teile ein (oder an einem Raster). Mit „Fertig“ bleiben die neuen Plätze, mit „Abbrechen“ springt alles zurück. Der Event-Timer gehört nicht dazu, er hat sein eigenes Fenster.
- Sammel-Statistik: Das Meter liest jetzt die Sammelfertigkeiten und jeden Sammelvorgang mit (aufgewertet, kritisch, Lady Luck). Plugins sehen aufgewertete und fehlgeschlagene Sammlungen mit ihrem Status. Gesendet wird davon nichts, solange „Nützliche Daten mit A2Tools synchronisieren“ aus ist (im Fork standardmäßig aus); schaltest du es selbst ein, gehen Server, Zeit, Gegenstand, Ergebnis und die Fertigkeitsstufen gesammelt an a2tools.app, ohne Charaktername und ohne Ort.
- Party-Namen (nur mit A2 Tools-Konto): Unter Einstellungen → Datenschutz erscheint nach der Anmeldung „Meinen Namen in Logs meiner Gruppe zeigen“. Der Schalter gehört der Webseite, das Meter fragt ihn nur beim Öffnen ab und ändert ihn nur, wenn du das Häkchen setzt. Ohne Konto passiert nichts.
- Plugins bekommen den Abyss-Rang (Rang 1 bis 19) bei Todesbericht, Mördern, Helfern und Opfern der Abschüsse.
- Spieldaten vom 18.11.: 132 NPCs, 110 Fertigkeiten und 9 Buffs in allen Sprachen. Abyssal Forge: Ludra (leicht) als Raid mit Rahu, Ketu, Zentraler Abyss-Fusionsreaktor und Ewige Ludra.

**Behoben**
- Der Meter-Knopf im Dock und in der Plugin-Leiste zeigt ein Meter, das Auto-Ausblenden oder die „Außerhalb des Kampfes“-/Solo-Regel minimiert hat, schon beim ersten Klick wieder. Vorher versteckte der erste Klick das unsichtbare Meter dauerhaft und erst der zweite holte es zurück.
- Gespeicherte Kämpfe: Ein Heiler ohne Heilung innerhalb des Kampfes zählt nicht mehr als Mitspieler (vorher bekam jeder Heiler der Sitzung in jedem Kampf eine leere Heilzeile; ein Zwei-Spieler-Dungeonkampf wurde mit 115 Spielern gespeichert).
- Weltboss-Verlauf: Die beobachtete „Andere“-Schätzung bleibt im Verlauf und in der Wiedergabe erhalten.

**Sonstiges**
- Basis jetzt A2Tools 2.1.0 (auch Linux: Hyprland setzt versteckte Fenster wieder an ihren alten Platz).
- Alle Fork-Funktionen bleiben erhalten. Das Teilen von Daten (Synchronisieren, Sammel-Statistik, Bosskämpfe, Ranglisten, Party-A2-Tag) bleibt aus, bis du es selbst einschaltest; Tests sichern auch die neue Sammel-Statistik und die Party-Namen-Abfrage ab.

**Installation (neu)**
1. `AION2-DPS-Meter_3.0.42_x64.msi` herunterladen und ausführen. Windows SmartScreen warnt, weil der Installer nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.
2. Npcap: Fehlt es, bietet der Installer an, es nach dem Setup herunterzuladen (Haken gesetzt lassen, Npcap-Setup mit den Standardoptionen durchklicken). Sonst fragt das Meter beim ersten Start danach.
3. Meter starten, im Spiel einloggen. Updates kommen danach automatisch (Meldung beim Start).
4. Einstellungen → „Gruppe teilen“: Einladungslink einfügen.
