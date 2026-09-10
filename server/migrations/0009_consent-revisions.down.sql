-- Откат к одной актуальной отметке на профиль: остаётся последняя строка.

CREATE TABLE consents_v1 (
  profile_id    TEXT NOT NULL PRIMARY KEY,
  version       TEXT NOT NULL,
  consented_at  TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (length(version) = 64)
);

INSERT INTO consents_v1 (profile_id, version, consented_at)
SELECT profile_id, version, consented_at
  FROM consents AS current
 WHERE consented_at = (
   SELECT MAX(consented_at) FROM consents WHERE profile_id = current.profile_id
 );

DROP TABLE consents;
ALTER TABLE consents_v1 RENAME TO consents;
