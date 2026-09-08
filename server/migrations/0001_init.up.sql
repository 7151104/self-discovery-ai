-- E3-03 · Начальная схема хранения личной страницы.
--
-- Диалект. Используется только общий SQL: TEXT, INTEGER, PRIMARY KEY, UNIQUE,
-- CHECK, FOREIGN KEY, CREATE INDEX. Ни AUTOINCREMENT, ни WITHOUT ROWID, ни
-- функций конкретной базы. Времена — строки ISO-8601, логические значения —
-- 0 и 1. Перевод схемы на другую базу остаётся переводом текста, а не
-- перепроектированием.
--
-- Чувствительные поля. Каждое хранится парой колонок: `*_payload` — сама
-- строка, `*_enc` — метка того, как она записана. Сейчас везде 'none'.
-- Включение шифрования (открытый вопрос 8, задача E9-08) меняет содержимое
-- обеих колонок и не трогает схему.

CREATE TABLE profiles (
  profile_id          TEXT NOT NULL PRIMARY KEY,
  -- Персональные данные: только имя и дата рождения. Почты нет.
  name_payload        TEXT NOT NULL,
  name_enc            TEXT NOT NULL DEFAULT 'none',
  birth_date_payload  TEXT,
  birth_date_enc      TEXT NOT NULL DEFAULT 'none',
  -- Растёт на каждом пересчёте профиля; указывает на последнюю запись в profile_versions.
  version             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE answers (
  profile_id     TEXT NOT NULL,
  question_id    TEXT NOT NULL,
  question_kind  TEXT NOT NULL,
  -- Порция, в которой был задан вопрос: 'step:1'..'step:4' или 'slice:<id>'.
  portion        TEXT NOT NULL,
  payload        TEXT NOT NULL,
  payload_enc    TEXT NOT NULL DEFAULT 'none',
  -- Растёт при правке ответа.
  revision       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (profile_id, question_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (question_kind IN ('выбор', 'шкала', 'открытый'))
);

CREATE INDEX answers_portion_idx ON answers (profile_id, portion);

CREATE TABLE profile_versions (
  version_id    TEXT NOT NULL PRIMARY KEY,
  profile_id    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  -- Почему пересчитали: 'portion', 'answer_edit', 'purchase'.
  reason        TEXT NOT NULL,
  -- Снимок внутреннего профиля. Наружу не отдаётся ни одним эндпоинтом.
  snapshot      TEXT NOT NULL,
  snapshot_enc  TEXT NOT NULL DEFAULT 'none',
  created_at    TEXT NOT NULL,
  UNIQUE (profile_id, version),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE
);

-- Блоки хранятся те, которые пересчитать нельзя: тексты LLM и купленные срезы.
-- Блоки ступеней 1–3 движок собирает из контента заново на каждом запросе.
CREATE TABLE blocks (
  block_id         TEXT NOT NULL PRIMARY KEY,
  profile_id       TEXT NOT NULL,
  -- Место блока на странице: 'step4' или 'slice:<id>'.
  slot             TEXT NOT NULL,
  -- Версия профиля, на которой блок собран.
  profile_version  INTEGER NOT NULL,
  status           TEXT NOT NULL,
  origin           TEXT NOT NULL,
  purchased        INTEGER NOT NULL DEFAULT 0,
  -- Ответы изменились после сборки: блок помечается расхождением, а не переписывается.
  stale            INTEGER NOT NULL DEFAULT 0,
  heading_payload  TEXT NOT NULL DEFAULT '',
  heading_enc      TEXT NOT NULL DEFAULT 'none',
  -- Абзацы и фраза-сшивка одной строкой JSON.
  body_payload     TEXT NOT NULL DEFAULT '',
  body_enc         TEXT NOT NULL DEFAULT 'none',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (profile_id, slot),
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'ready', 'failed')),
  CHECK (origin IN ('lookup', 'llm')),
  CHECK (purchased IN (0, 1)),
  CHECK (stale IN (0, 1))
);

CREATE TABLE orders (
  order_id      TEXT NOT NULL PRIMARY KEY,
  profile_id    TEXT NOT NULL,
  slice         TEXT NOT NULL,
  -- Цена в рублях целым числом: копеек в маршруте нет.
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'RUB',
  status        TEXT NOT NULL,
  provider      TEXT,
  provider_ref  TEXT,
  -- Ключ отправки: повторная покупка с тем же ключом не создаёт второй заказ.
  request_id    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  CHECK (status IN ('created', 'paid', 'failed', 'refunded'))
);

CREATE UNIQUE INDEX orders_request_idx ON orders (profile_id, request_id);
CREATE INDEX orders_profile_idx ON orders (profile_id, status);

-- Несогласие — данные, а не жалоба (docs/08-legal-safety.md).
CREATE TABLE disagreements (
  disagreement_id  TEXT NOT NULL PRIMARY KEY,
  profile_id       TEXT NOT NULL,
  slot             TEXT NOT NULL,
  -- Заполняется, когда несогласие относится к сохранённому блоку.
  block_id         TEXT,
  kind             TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE,
  FOREIGN KEY (block_id) REFERENCES blocks (block_id) ON DELETE SET NULL,
  CHECK (kind IN ('not_about_me', 'partly', 'too_general'))
);

CREATE INDEX disagreements_profile_idx ON disagreements (profile_id, slot);

-- События воронки и работы сервиса. Персональных данных и открытых ответов
-- в payload быть не должно: там только идентификаторы и машинные коды.
CREATE TABLE events (
  event_id    TEXT NOT NULL PRIMARY KEY,
  profile_id  TEXT,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE SET NULL
);

CREATE INDEX events_profile_idx ON events (profile_id, created_at);
CREATE INDEX events_type_idx ON events (type, created_at);
