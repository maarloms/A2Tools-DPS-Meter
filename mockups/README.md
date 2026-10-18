# Wochenrückblick als Bild – Mockups (Phase 1)

Nur Entwürfe, nicht im Worker eingebaut. Beispieldaten mit Fantasienamen (`data.mjs`).

| Datei | Entwurf | Größe |
|---|---|---|
| `wochenbild-a.png` | Gilden-Trophäe: Podium in Nachtblau/Gold (Cinzel, wie Dashboard-Theme „Atreia Gold“) | 1200×675 |
| `wochenbild-b.png` | Esports-Scoreboard: Schwarz/Neon, MVP-Karte + Rangliste #2–#6, Kennzahlen-Kacheln | 1200×630 |
| `wochenbild-c.png` | Infografik: alle Mitglieder als Balken in Klassenfarben, Klassen-Ring, Bosse mit Trend, 3 Highlights | 1200×760 |
| `wochenbild-d.png` | Sammelkarten: Top 3 als Trading-Cards (Holo-Gold/Silber/Bronze, Seltenheit, Sterne), Gruppenwerte als Leiste | 1200×675 |
| `wochenbild-e.png` | Kriegschronik: Pergament, Fraktur-Titel, Wochenbericht als Fließtext, Strichlisten je Boss, Wachssiegel mit KW | 1200×760 |
| `wochenbild-f.png` | Magazin-Cover „Gildenblatt“: MVP als Titelgeschichte, Schlagzeilen (Bilanz, Boss der Woche, Rekord), Störer, Strichcode | 1200×675 |

`vorschau/*-400.png` = dieselben Bilder in 400 px Breite (ungefähr so groß zeigt Discord ein Embed-Bild).

## Neu rendern

```
cd mockups
npm install
node render.mjs          # alle; oder: node render.mjs b
node measure-wasm.mjs    # Zeitmessung mit satori/standalone + @resvg/resvg-wasm (Worker-Weg)
```

Element-Bäume ohne JSX (`lib.mjs` → `h(style, ...kinder)`), Fonts aus `@fontsource` (WOFF, Satori kann kein WOFF2),
Klassensymbole aus `../src/assets/*.png` als data-URI.

D–F (18.10.2026) nehmen zusätzlich `@fontsource/im-fell-english`, `caveat`, `unifrakturmaguntia`, `anton`, `playfair-display`.
Spielerbild über `avatar()` in `lib.mjs`: heute Klassensymbol, später `p.portrait` (data-URI) an derselben Stelle.

Satori-Stolperfallen: jedes `div` mit mehreren Kindern braucht `display:flex` (macht `h()`), Padding wird
zur Breite addiert (Innenmaß angeben), absolut positionierte Bilder liegen ÜBER Text im Fluss (Hintergründe
daher als `backgroundImage: url(data:svg)` → `svgUrl()`), gedrehte Elemente (`transform`) überdecken Nachbarn, Glow (`box-shadow`/`text-shadow`) kostet in resvg viel CPU (Entwurf B).

## Daten (gegenüber heute keine zusätzlichen D1-Reads)

rows_read zählt gelesene, nicht gelieferte Zeilen – mehr Spalten oder ein weggelassenes `LIMIT` nach
`GROUP BY`/Fensterfunktion kosten nichts extra. Aus den vier Abfragen von `buildRecap()`:

- **Top-Spieler mit Klasse** (alle Entwürfe): Top-Abfrage um `ps.job_id` erweitern; A braucht 3, B 6, C alle Mitglieder (`LIMIT` weg).
- **Klassen-Ring** (C): aus derselben Liste (Klasse des Bestkampfs je Mitglied).
- **Bester Kampf, schnellster Kill, Kills/Versuche je Boss** (C): Best-Abfrage ohne `LIMIT 1` liefert alle Kämpfe der Woche (≈ 50 Zeilen), Auswertung in `weekly-core.ts`.
- **Bosse mit Trend, größter Sprung** (C): perBoss-Abfrage liefert die Werte je Boss schon; nur `MAX(ps.boss)` als Name dazu.
- **Bosskämpfe/Kills + Vorwoche** (alle): unverändert.
