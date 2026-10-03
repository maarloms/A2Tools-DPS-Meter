-- Boss besiegt (App ab 3.0.4 meldet killed im FightRecord). Ältere Kämpfe: 0 = unbekannt.
ALTER TABLE encounters ADD COLUMN killed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN killed INTEGER NOT NULL DEFAULT 0;
