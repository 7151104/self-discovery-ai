/**
 * Состояния страницы, которые снимаем и проверяем на доступность.
 *
 * Состав сверяется с таблицей «Состояния страницы» в `docs/11-ui-page-spec.md`.
 * Краевые и ожидание сборки в этот набор не входят: это не отдельные состояния
 * страницы (решение E6-12).
 */

export const PAGE_STATES = ["s0", "s1", "s2", "s3", "s4", "paid_pending", "paid_done"] as const;

export type PageStateId = (typeof PAGE_STATES)[number];

export const SHOWCASE_KEYS = {
  s0: "s0",
  s1: "s1",
  s2: "s2",
  s3: "s3",
  s4: "s4",
  paid_pending: "paidPending",
  paid_done: "paidDone",
} as const;
