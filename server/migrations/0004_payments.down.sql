-- Откат 0004.

DROP INDEX webhook_deliveries_order_idx;
DROP TABLE webhook_deliveries;

DROP INDEX order_events_order_idx;
DROP TABLE order_events;

DROP INDEX orders_active_slice_idx;

ALTER TABLE orders DROP COLUMN refunded_at;
ALTER TABLE orders DROP COLUMN paid_at;
ALTER TABLE orders DROP COLUMN active_slice;
ALTER TABLE orders DROP COLUMN provider_mode;
