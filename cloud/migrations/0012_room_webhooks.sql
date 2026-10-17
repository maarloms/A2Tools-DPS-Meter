-- Wochenrückblick per Discord-Webhook (Opt-in je Raum, im Dashboard unter Einstellungen).
-- url ist ein Geheimnis: der Worker gibt sie nie an Clients zurück (nur die letzten 4 Zeichen).
CREATE TABLE room_webhooks (
  room          TEXT    PRIMARY KEY,
  url           TEXT    NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'ok',  -- ok | invalid (401/403/404, nicht mehr senden) | error
  last_code     INTEGER,                         -- letzter HTTP-Status von Discord
  last_error    TEXT,
  origin        TEXT    NOT NULL,                -- Dashboard-Adresse für Links in der Karte
  last_week     TEXT,                            -- zuletzt erledigte Woche ("w2026-10-21"), auch wenn ohne Kämpfe übersprungen
  last_post_ms  INTEGER,
  last_test_ms  INTEGER,
  updated_ms    INTEGER NOT NULL
);
