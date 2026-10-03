-- Mitglieder ausblenden (Testnamen, Tippfehler), ohne ihre Daten zu loeschen.
ALTER TABLE members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
