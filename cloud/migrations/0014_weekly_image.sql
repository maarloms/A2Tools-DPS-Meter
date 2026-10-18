-- Wochenbild: lokal gerendertes PNG (tools/wochenbild) statt bzw. vor der Text-Karte.
-- recap_*: Auswertung der abgelaufenen Woche einmal berechnet (Cron, GET /api/weekly/pending und
--          Bild-Upload lesen sie von hier, statt D1 mehrfach abzufragen).
-- claim_ms: Versand-Sperre je Raum (Cron und Bild-Upload gleichzeitig → nur einer sendet).
-- image_*: Woche, für die ein Bild gepostet (ok) oder von Discord abgelehnt wurde (rejected → Text-Karte sofort).
ALTER TABLE room_webhooks ADD COLUMN recap_week TEXT;
ALTER TABLE room_webhooks ADD COLUMN recap_json TEXT;
ALTER TABLE room_webhooks ADD COLUMN claim_ms INTEGER;
ALTER TABLE room_webhooks ADD COLUMN image_week TEXT;
ALTER TABLE room_webhooks ADD COLUMN image_status TEXT;
