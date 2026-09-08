-- Откат 0001. Порядок обратный созданию: сначала таблицы со ссылками.

DROP INDEX events_type_idx;
DROP INDEX events_profile_idx;
DROP TABLE events;

DROP INDEX disagreements_profile_idx;
DROP TABLE disagreements;

DROP INDEX orders_profile_idx;
DROP INDEX orders_request_idx;
DROP TABLE orders;

DROP TABLE blocks;

DROP TABLE profile_versions;

DROP INDEX answers_portion_idx;
DROP TABLE answers;

DROP TABLE profiles;
