-- Bester 10-Sekunden-Schnitt je Spieler und Kampf (Burst). NULL = noch nicht berechnet.
ALTER TABLE player_stats ADD COLUMN peak_dps REAL;
