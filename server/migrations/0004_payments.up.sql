-- E8-02, E8-03, E8-07 · Заказ как состояние, журнал переходов, уведомления.
--
-- Заказ получает три новых свойства:
--
--   provider_mode  — 'test' или 'live'. Заказ, созданный тестовым провайдером,
--                    видно в базе навсегда: по нему нельзя выдать доступ, думая
--                    что деньги пришли.
--   active_slice   — тот же срез, пока заказ жив ('created' или 'paid'), и NULL
--                    после отказа или возврата. Вместе с уникальным индексом это
--                    и есть защита от повторной покупки (E8-07): две
--                    одновременные попытки купить один срез дают один заказ,
--                    вторую отбивает база, а не проверка в коде.
--                    NULL в уникальном индексе не сталкиваются ни в SQLite, ни в
--                    PostgreSQL, ни в MySQL — приём остаётся переносимым.
--   refunded_at    — когда доступ был отозван.
--
-- Диалект прежний: ALTER TABLE ADD COLUMN, CREATE UNIQUE INDEX и обычные типы.

ALTER TABLE orders ADD COLUMN provider_mode TEXT;
ALTER TABLE orders ADD COLUMN active_slice TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN refunded_at TEXT;

UPDATE orders SET active_slice = slice WHERE status IN ('created', 'paid');

CREATE UNIQUE INDEX orders_active_slice_idx ON orders (profile_id, active_slice);

-- Журнал переходов заказа. Отдельной таблицей, а не колонкой в заказе:
-- история переходов нужна целиком, а не только последний.
CREATE TABLE order_events (
  order_event_id  TEXT NOT NULL PRIMARY KEY,
  order_id        TEXT NOT NULL,
  profile_id      TEXT NOT NULL,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  -- Почему сменилось: 'webhook', 'refund_requested', 'provider_declined'.
  reason          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles (profile_id) ON DELETE CASCADE
);

CREATE INDEX order_events_order_idx ON order_events (order_id, created_at);

-- Доставленные уведомления провайдера (E8-03). Провайдеры повторяют доставку,
-- пока не получат подтверждение, поэтому идентификатор уведомления — первичный
-- ключ: вторая доставка того же уведомления не вставляется и доступ не выдаётся
-- второй раз. Тело уведомления не хранится: в нём нет ничего, чего не было бы
-- в заказе, а лишняя копия платёжных данных — лишний риск.
CREATE TABLE webhook_deliveries (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  order_id     TEXT,
  -- 'applied' — уведомление изменило заказ; 'ignored' — не изменило и почему.
  result       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX webhook_deliveries_order_idx ON webhook_deliveries (order_id, created_at);
