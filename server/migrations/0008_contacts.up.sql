-- Сбор контакта после первой порции. Почта и канал шифруются той же
-- парой payload/enc, что имя. status: saved | skipped. Нет строки —
-- ещё не спрашивали.

CREATE TABLE profile_contacts (
  profile_id       TEXT NOT NULL PRIMARY KEY,
  email_payload    TEXT,
  email_enc        TEXT NOT NULL DEFAULT 'none',
  channel_payload  TEXT,
  channel_enc      TEXT NOT NULL DEFAULT 'none',
  status           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (status IN ('saved', 'skipped'))
);
