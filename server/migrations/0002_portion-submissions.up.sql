-- E3-05 · Идемпотентность отправки порции.
--
-- Отправка порции — не «записать ответы», а «записать ответы ровно один раз».
-- Ключ отправки приходит от клиента и удерживается уникальным первичным ключом:
-- повтор при обрыве связи или двойном нажатии не создаёт ни второго набора
-- ответов, ни второго пересчёта профиля.
--
-- Хранится и версия профиля, полученная в тот раз: повтор отвечает тем же
-- состоянием, что и первая отправка, а не «уже отправлено».

CREATE TABLE portion_submissions (
  profile_id      TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  portion         TEXT NOT NULL,
  -- Сколько ответов записала эта отправка.
  answer_count    INTEGER NOT NULL,
  -- Версия профиля после пересчёта, вызванного этой отправкой.
  profile_version INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (profile_id, request_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE
);

CREATE INDEX portion_submissions_portion_idx ON portion_submissions (profile_id, portion);
