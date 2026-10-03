-- AION2 Gruppen-Meter: Kampf-Historie, Bestenliste, Trends (Cloudflare D1)
-- Ein "Kampf" (encounter) fasst alle Uploads desselben Bosskampfs zusammen
-- (gleicher Raum, Boss, Instanz, Start innerhalb weniger Sekunden).

CREATE TABLE IF NOT EXISTS encounters (
  id           TEXT PRIMARY KEY,
  room         TEXT    NOT NULL,
  mob_code     INTEGER NOT NULL,
  target_id    INTEGER NOT NULL,
  boss         TEXT    NOT NULL,
  dungeon_id   INTEGER NOT NULL,
  start_ms     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  total_damage INTEGER NOT NULL,
  max_hp       INTEGER NOT NULL,
  is_train     INTEGER NOT NULL,
  actor_count  INTEGER NOT NULL,
  uploaders    TEXT    NOT NULL,  -- JSON-Array der Uploader-Namen
  top          TEXT    NOT NULL,  -- JSON: Top 5 (Name, Klasse, DPS, Anteil)
  detail       TEXT    NOT NULL,  -- base64(gzip(JSON)) zusammengefuehrtes Detail
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS enc_room_start ON encounters(room, start_ms);
CREATE INDEX IF NOT EXISTS enc_room_boss  ON encounters(room, mob_code, dungeon_id, start_ms);

CREATE TABLE IF NOT EXISTS uploads (
  id           TEXT PRIMARY KEY,   -- hash(raum|uploader|FightRecord.id) → idempotent
  room         TEXT    NOT NULL,
  encounter_id TEXT    NOT NULL,
  uploader     TEXT    NOT NULL,
  record_id    TEXT    NOT NULL,
  start_ms     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  uploaded_at  INTEGER NOT NULL,
  raw_bytes    INTEGER NOT NULL,
  detail       TEXT    NOT NULL    -- base64(gzip(JSON)) Detail dieser Perspektive
);
CREATE INDEX IF NOT EXISTS up_enc ON uploads(encounter_id);

-- Eine Zeile pro Spieler und Kampf: Grundlage fuer Bestenliste, Rekorde, Trends.
CREATE TABLE IF NOT EXISTS player_stats (
  encounter_id TEXT    NOT NULL,
  room         TEXT    NOT NULL,
  player       TEXT    NOT NULL,
  player_lc    TEXT    NOT NULL,
  job          TEXT    NOT NULL,
  job_id       INTEGER NOT NULL,
  source       TEXT    NOT NULL,   -- Uploader, dessen Meter den Wert lieferte
  self_report  INTEGER NOT NULL,   -- 1 = Spieler hat selbst hochgeladen
  dps          REAL    NOT NULL,
  dmg          INTEGER NOT NULL,
  share        REAL    NOT NULL,
  crit_rate    REAL    NOT NULL,
  back_rate    REAL    NOT NULL,
  hits         INTEGER NOT NULL,
  heal         INTEGER NOT NULL,
  cp           INTEGER NOT NULL,
  mob_code     INTEGER NOT NULL,
  boss         TEXT    NOT NULL,
  dungeon_id   INTEGER NOT NULL,
  start_ms     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  is_train     INTEGER NOT NULL,
  PRIMARY KEY (encounter_id, player_lc)
);
CREATE INDEX IF NOT EXISTS ps_room_boss   ON player_stats(room, mob_code, dungeon_id, dps);
CREATE INDEX IF NOT EXISTS ps_room_player ON player_stats(room, player_lc, start_ms);
CREATE INDEX IF NOT EXISTS ps_room_start  ON player_stats(room, start_ms);

-- Gruppenmitglieder (App-Namen und Uploader). Nur sie erscheinen in Bestenliste/Trends.
CREATE TABLE IF NOT EXISTS members (
  room      TEXT    NOT NULL,
  name_lc   TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (room, name_lc)
);
