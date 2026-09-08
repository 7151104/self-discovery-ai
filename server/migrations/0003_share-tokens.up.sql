-- E3-09 · Приватность по умолчанию и токен шеринга.
--
-- Отдельная таблица, а не колонка в профиле: токенов за жизнь страницы бывает
-- несколько, и отзыв обязан оставлять след, а не затирать прошлый токен.
-- Пока строки нет, публичной ссылки не существует — приватность держится
-- отсутствием записи, а не флагом, который можно забыть проверить.
--
-- Токен не выводится из profile_id: публичная ссылка не должна давать доступ
-- к личной.

CREATE TABLE share_tokens (
  token       TEXT NOT NULL PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  -- Заполняется при отзыве. Отозванный токен остаётся строкой и больше не работает.
  revoked_at  TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE
);

CREATE INDEX share_tokens_profile_idx ON share_tokens (profile_id, revoked_at);
