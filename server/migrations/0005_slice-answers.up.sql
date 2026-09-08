-- E8-04 · Ответы доборов платных срезов.
--
-- Доборы приносят четвёртый тип вопроса — 'число': вопрос спрашивает сразу две
-- величины («сколько начал и сколько довёл»). Список типов в CHECK повторяет
-- `QuestionKind` из контракта, поэтому его приходится расширять вместе с ним.
--
-- В таблице `answers` есть CHECK, а изменить условие CHECK на месте нельзя ни
-- в SQLite, ни где-либо ещё переносимо. Общий для всех баз способ — пересобрать
-- таблицу: новая, перенос строк, замена. Это по-прежнему обычный SQL.

CREATE TABLE answers_next (
  profile_id     TEXT NOT NULL,
  question_id    TEXT NOT NULL,
  question_kind  TEXT NOT NULL,
  -- 'step:1'..'step:4' для лестницы, 'slice:<id>:<порция>' для добора.
  portion        TEXT NOT NULL,
  payload        TEXT NOT NULL,
  payload_enc    TEXT NOT NULL DEFAULT 'none',
  revision       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (profile_id, question_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (question_kind IN ('выбор', 'шкала', 'открытый', 'число'))
);

INSERT INTO answers_next
  (profile_id, question_id, question_kind, portion, payload, payload_enc, revision, created_at, updated_at)
SELECT profile_id, question_id, question_kind, portion, payload, payload_enc, revision, created_at, updated_at
  FROM answers;

DROP INDEX answers_portion_idx;
DROP TABLE answers;
ALTER TABLE answers_next RENAME TO answers;

CREATE INDEX answers_portion_idx ON answers (profile_id, portion);
