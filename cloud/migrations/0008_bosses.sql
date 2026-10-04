-- Welche Bosse zählen? Je Raum und Boss die höchste je gesehene Max-HP (ein einzelner Kampf kann
-- sie zu niedrig melden) und eine optionale Vorgabe aus dem Dashboard. Ohne Vorgabe zählen Bosse ab
-- 4M HP (Dungeon- und Großbosse); kleinere (Quest-Minibosse, Lowlevel-Dungeons) werden ausgeblendet.
-- Gelöscht wird nichts: ausgeblendete Kämpfe bleiben gespeichert.
CREATE TABLE bosses (
  room     TEXT    NOT NULL,
  mob_code INTEGER NOT NULL,
  boss     TEXT    NOT NULL,
  max_hp   INTEGER NOT NULL,
  mode     TEXT,                  -- NULL = automatisch nach HP, 'show' | 'hide' = Vorgabe
  PRIMARY KEY (room, mob_code)
);
INSERT INTO bosses (room, mob_code, boss, max_hp)
  SELECT room, mob_code, MAX(boss), MAX(max_hp) FROM encounters GROUP BY room, mob_code;
