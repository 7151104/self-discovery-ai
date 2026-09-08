-- E4-03, E4-10, E4-11 · Очередь заданий генерации, журнал вызовов, кэш.
--
-- Диалект прежний: TEXT, INTEGER, PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY,
-- индексы. Времена — ISO-8601, логические — 0 и 1.
--
-- Защита от второй генерации того же слота — как у заказов (E8-07): колонка
-- `active_slot` равна слоту, пока задание живо (`pending`), и NULL после
-- завершения. Уникальный индекс по «профиль плюс живой слот» отбивает
-- одновременные постановки; NULL в уникальном индексе не сталкиваются.
--
-- В журнале вызовов нет ни промпта, ни открытого ответа (E9-04): только
-- токены, стоимость, время, имя модели и машинный исход.
--
-- Текст результата в задании и в кэше — чувствительное поле, пара колонок
-- «строка + метка записи» (E9-08).

CREATE TABLE generation_jobs (
  generation_id    TEXT NOT NULL PRIMARY KEY,
  profile_id       TEXT NOT NULL,
  -- Место блока: 'step4' или 'slice:<id>'.
  slot             TEXT NOT NULL,
  status           TEXT NOT NULL,
  -- Слот, пока задание живо; NULL после ready/failed.
  active_slot      TEXT,
  -- Хеш стабильного входа (промпт без одноразовой границы + версия контента).
  input_hash       TEXT NOT NULL,
  content_version  TEXT NOT NULL,
  regenerated      INTEGER NOT NULL DEFAULT 0,
  -- Ключ отправки ручной регенерации; у автоматической постановки NULL.
  request_id       TEXT,
  -- Готовый блок и сюжет. Шифруется: в нём текст разбора.
  result_payload   TEXT,
  result_enc       TEXT NOT NULL DEFAULT 'none',
  failure_code     TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  started_at       TEXT,
  finished_at      TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'ready', 'failed')),
  CHECK (regenerated IN (0, 1))
);

CREATE UNIQUE INDEX generation_jobs_active_slot_idx ON generation_jobs (profile_id, active_slot);
CREATE UNIQUE INDEX generation_jobs_request_idx ON generation_jobs (profile_id, request_id);
CREATE INDEX generation_jobs_due_idx ON generation_jobs (profile_id, status, next_attempt_at);
CREATE INDEX generation_jobs_slot_idx ON generation_jobs (profile_id, slot, created_at);

CREATE TABLE generation_calls (
  call_id        TEXT NOT NULL PRIMARY KEY,
  generation_id  TEXT,
  profile_id     TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  cost_kopecks   INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  outcome        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (generation_id) REFERENCES generation_jobs (generation_id) ON DELETE SET NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (outcome IN ('ok', 'temporary', 'permanent', 'timeout', 'cached')),
  CHECK (input_tokens >= 0),
  CHECK (output_tokens >= 0),
  CHECK (cost_kopecks >= 0),
  CHECK (duration_ms >= 0)
);

CREATE INDEX generation_calls_profile_idx ON generation_calls (profile_id, created_at);

CREATE TABLE generation_cache (
  profile_id       TEXT NOT NULL,
  input_hash       TEXT NOT NULL,
  content_version  TEXT NOT NULL,
  result_payload   TEXT NOT NULL,
  result_enc       TEXT NOT NULL DEFAULT 'none',
  created_at       TEXT NOT NULL,
  PRIMARY KEY (profile_id, input_hash),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE
);
