-- Feldbosse (Hunderte Spieler): jedes Meter sieht nur einen Bruchteil des Schadens, Anteile und
-- Vergleich mit Instanzbossen taugen nicht. Erkannt an der höchsten je gesehenen Akteurszahl.
ALTER TABLE bosses ADD COLUMN max_actors INTEGER NOT NULL DEFAULT 0;
UPDATE bosses SET max_actors = COALESCE(
  (SELECT MAX(e.actor_count) FROM encounters e WHERE e.room = bosses.room AND e.mob_code = bosses.mob_code), 0);
