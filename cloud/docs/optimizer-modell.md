# Gear- und Genus-Optimizer – Modell und Daten

Läuft komplett im Browser (Reiter „Charakter“ → „Optimizer starten“). Rechenkern: `public/js/optimizer-core.js`
(Tests: `test/optimizer.test.mjs`). Alles hier sind **Schätzungen auf Basis beobachteter Würfe**, kein offizielles Spielwissen.

## Daten

- `public/data/substat-observed.json` – erzeugt von `scripts/measure-substats.mjs`: Suche → `equipment` → `equipment/item`
  über die öffentlichen NCSOFT-Endpunkte (siehe `ncsoft-character-api.md`). Nur GET, ≤ 1 Anfrage/s, höchstens 400 Anfragen,
  Abbruch bei 429 oder 5 Fehlern in Folge. Je (Slot, Gegenstandsstufe, Qualität, Stat): Stichprobengröße, Min, Max, Mittel,
  Histogramm; oben stehen Datum, Region und Anzahl der Anfragen. Waffen/Schild und niedrige Qualitäten sind nicht erfasst.
  Min/Max sind nur die **gesehenen** Extreme. Mit kleiner Stichprobe liegen sie zu eng; deshalb zeigt die UI `n=` mit an
  und markiert gepoolte Werte (`*`, alle Stufen des Slots zusammen) – Beobachtungen unter 3 Stück zählen nicht.
  Neu messen: `node scripts/measure-substats.mjs [--region eu] [--max 400]` (nur mit gutem Grund wiederholen).
- `public/data/optimizer-costs.json` – Kosten (Kinah/Pet Soul je Reroll, je Slot oder `default`). Nichts geschätzt:
  `null` = nicht eingetragen, die UI zeigt dann „Kosten noch nicht eingetragen“. Marlon trägt die Zahlen ein.

## Gear-Optimizer

Annahme: Ein Reroll würfelt den Wert desselben Stats neu aus der beobachteten Verteilung (ob das Spiel so rollt, ist nicht belegt).

| Größe | Formel |
| --- | --- |
| Qualität | `(Wert − Min) / (Max − Min)` |
| Abstand | `(Mittel − Wert) / Mittel · 100` (Prozentpunkte; positiv = unterdurchschnittlich) |
| Chance besser | Anteil der Beobachtungen mit größerem Wert |
| Gewicht | Nutzer-Gewicht je Stat (Standard 1); Präzision/Krit × 1,5, solange die Summe über alle Zufallswerte das eingestellte Ziel nicht erreicht, danach × 0,25 |
| Rang | Abstand · Gewicht – höher = Reroll lohnt eher |

Präzision = Stat-IDs mit „accura“/„precis“, Krit = „crit“ (ohne Resist/Defense/Avoid). Ziele sind Summen über die geladene Ausrüstung.

## Genus-Optimizer

In der NCSOFT-API kommt „Genus“ nicht vor. Der Genus-Optimizer rechnet deshalb mit denselben Zufallswerten je Slot:
Zielwert = obere X % der beobachteten Werte (einstellbar, Standard 10 %). Chance je Reroll = Anteil der Beobachtungen ≥ Ziel,
erwartete Versuche = 1 / Chance, erwartete Kosten = Versuche · Kosten je Reroll (nur mit eingetragener Tabelle).
Genus-spezifische Werte (BiS) kann Marlon später im Feld `genus` der Kosten-Tabelle ergänzen.
