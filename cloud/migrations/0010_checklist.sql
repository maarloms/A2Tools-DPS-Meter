-- Reset-Checkliste (täglich / wöchentlich) je Spieler, im Dashboard abgehakt.
-- Die Aufgaben selbst stehen im Dashboard (public/js/checklist.js); hier nur Zählerstände.
-- period = Kennung des Reset-Zeitraums, in dem gezählt wurde ("d2026-10-06", "w2026-09-30" …).
-- Gehört der Stand zu einem alten Zeitraum, zeigt das Dashboard 0 – aufgeräumt wird beim Schreiben.

-- Charaktere eines Spielers: [{ "id": "main", "name": "Main" }, { "id": "t1a2b", "name": "Twink" }]
CREATE TABLE checklist_chars (
  room       TEXT    NOT NULL,
  player_lc  TEXT    NOT NULL,
  chars      TEXT    NOT NULL,
  updated_ms INTEGER NOT NULL,
  PRIMARY KEY (room, player_lc)
);

CREATE TABLE checklist_items (
  room       TEXT    NOT NULL,
  player_lc  TEXT    NOT NULL,
  char_id    TEXT    NOT NULL,
  task       TEXT    NOT NULL,
  count      INTEGER NOT NULL,
  period     TEXT    NOT NULL,
  updated_ms INTEGER NOT NULL,
  PRIMARY KEY (room, player_lc, char_id, task)
);
