-- Diagnose-Pakete aus der App (Logs, Einstellungen ohne Passwörter, letzte Kämpfe) als gzip.
-- D1 erlaubt höchstens 2 MB je Zeile, deshalb in Stücken. Je Raum bleiben die neuesten 20.
CREATE TABLE diagnostics (
  id         TEXT    PRIMARY KEY,
  room       TEXT    NOT NULL,
  uploader   TEXT    NOT NULL,
  note       TEXT    NOT NULL,
  bytes      INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE INDEX diagnostics_room ON diagnostics (room, created_ms DESC);
CREATE TABLE diagnostic_chunks (
  diag_id TEXT    NOT NULL,
  seq     INTEGER NOT NULL,
  data    BLOB    NOT NULL,
  PRIMARY KEY (diag_id, seq)
);
