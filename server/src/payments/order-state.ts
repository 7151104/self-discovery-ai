/**
 * Заказ как состояние (E8-02).
 *
 * Доступ к платному блоку определяется состоянием заказа, а не доверием к
 * клиенту (`docs/12-target-state.md`, слой 6). Состояний четыре, переходы
 * заданы таблицей: недопустимый отклоняется, а не выполняется молча.
 *
 *   created ──оплата──▶ paid ──возврат──▶ refunded
 *      │
 *      └───отказ──────▶ failed
 *
 * `failed` и `refunded` — конечные. Новая попытка оплаты после отказа — это
 * новый заказ, а не оживление старого: у провайдера ей соответствует новый
 * платёж, и смешивать их в одной записи значит потерять историю.
 */

import type { OrderStatus } from "../contract/index.js";

export const ORDER_STATUSES: OrderStatus[] = ["created", "paid", "failed", "refunded"];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ["paid", "failed"],
  paid: ["refunded"],
  failed: [],
  refunded: [],
};

/** Состояния, в которых срез считается занятым: повторная покупка невозможна. */
export const ACTIVE_STATUSES: OrderStatus[] = ["created", "paid"];

export const isActive = (status: OrderStatus): boolean => ACTIVE_STATUSES.includes(status);

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  (TRANSITIONS[from] ?? []).includes(to);

export class InvalidTransition extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`invalid-order-transition:${from}->${to}`);
    this.name = "InvalidTransition";
  }
}

/** Почему заказ сменил состояние. Попадает в журнал заказа. */
export type TransitionReason = "webhook" | "refund_requested" | "provider_declined";
