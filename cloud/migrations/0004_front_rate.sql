-- Frontal-Quote (Treffer von vorn) je Spieler und Kampf, analog back_rate. NULL = noch nicht berechnet.
ALTER TABLE player_stats ADD COLUMN front_rate REAL;
