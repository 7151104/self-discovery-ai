-- Повторное согласие при смене отпечатка документа (вопрос 40).
--
-- Одна отметка на профиль больше не подходит: правка текста согласия должна
-- дать новую строку, а старая остаётся для доказуемости редакции.
-- Уникальность — пара (профиль, версия), не один профиль.

CREATE TABLE consents_v2 (
  profile_id    TEXT NOT NULL,
  version       TEXT NOT NULL,
  consented_at  TEXT NOT NULL,
  PRIMARY KEY (profile_id, version),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (length(version) = 64)
);

INSERT INTO consents_v2 (profile_id, version, consented_at)
SELECT profile_id, version, consented_at FROM consents;

DROP TABLE consents;
ALTER TABLE consents_v2 RENAME TO consents;
