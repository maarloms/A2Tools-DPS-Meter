-- Weniger gelesene Zeilen (D1-Tageslimit „rows read“, 17.10.2026):
-- Kampfsuche beim Upload (findEncounter) las alle Kämpfe des Raums, die Rekordprüfung (newRecords)
-- alle Kämpfe des Spielers. Jeder Index liest die Tabelle beim Anlegen einmal komplett.
CREATE INDEX IF NOT EXISTS enc_room_mob_start ON encounters (room, mob_code, start_ms);
CREATE INDEX IF NOT EXISTS enc_room_mob_target ON encounters (room, mob_code, target_id);
CREATE INDEX IF NOT EXISTS ps_room_player_boss ON player_stats (room, player_lc, mob_code, dungeon_id);
