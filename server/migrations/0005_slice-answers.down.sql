-- Откат 0005: та же пересборка обратно, к трём типам вопроса.
-- Ответы доборов типа 'число' при откате не переносятся: старое условие CHECK
-- их не принимает. Это честнее, чем менять их тип и получить в базе строку,
-- которую никто не сможет прочитать.

CREATE TABLE answers_prev (
  profile_id     TEXT NOT NULL,
  question_id    TEXT NOT NULL,
  question_kind  TEXT NOT NULL,
  portion        TEXT NOT NULL,
  payload        TEXT NOT NULL,
  payload_enc    TEXT NOT NULL DEFAULT 'none',
  revision       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (profile_id, question_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (question_kind IN ('выбор', 'шкала', 'открытый'))
);

INSERT INTO answers_prev
  (profile_id, question_id, question_kind, portion, payload, payload_enc, revision, created_at, updated_at)
SELECT profile_id, question_id, question_kind, portion, payload, payload_enc, revision, created_at, updated_at
  FROM answers WHERE question_kind <> 'число';

DROP INDEX answers_portion_idx;
DROP TABLE answers;
ALTER TABLE answers_prev RENAME TO answers;

CREATE INDEX answers_portion_idx ON answers (profile_id, portion);
