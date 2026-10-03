-- Neue Bestwerte von Mitgliedern gegen einen Boss (gleiche Instanz): einmal gemeldet, als Verlauf behalten.
CREATE TABLE records (
  encounter_id TEXT NOT NULL,
  room TEXT NOT NULL,
  player TEXT NOT NULL,
  player_lc TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'dps' (Kampfschnitt) | 'peak' (bestes 10-s-Fenster)
  value REAL NOT NULL,
  prev REAL NOT NULL,            -- bisheriger Bestwert
  mob_code INTEGER NOT NULL,
  boss TEXT NOT NULL,
  dungeon_id INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  PRIMARY KEY (encounter_id, player_lc, kind)
);
CREATE INDEX records_room_time ON records (room, start_ms DESC);
