/**
 * Точка оплаты (E6-08, экран после ступени 4).
 *
 * Одно предложение и ничего больше. Запрещённое на этом экране —
 * таймеры, счётчики мест, зачёркнутые цены, вторая кнопка с другим продуктом,
 * отзывы, звёзды (`docs/11-ui-page-spec.md`) — сюда просто нечем передать:
 * компонент принимает одно предложение, одну цену и один отказ.
 *
 * Цена на экране одна: она печатается ровно в одном месте — на кнопке.
 */

import { h, type Handler, type VNode } from "../src/dom.js";
import type { OfferDto } from "../src/contract.js";

export interface OfferLabels {
  /** Подпись кнопки без цены: цену подставляет компонент. */
  buy: string;
  /** Что внутри: состав, не список выгод. */
  contents: string;
  /** Выход без давления. */
  decline: string;
}

export interface OfferProps {
  offer: OfferDto;
  labels: OfferLabels;
  /** Форматирование цены живёт снаружи компонента. */
  formatPrice: (price: number) => string;
  onBuy?: Handler;
  onDecline?: Handler;
}

export function renderOffer(props: OfferProps): VNode {
  return h(
    "section",
    { class: "offer", "data-slice": props.offer.slice },
    h("h2", { class: "offer__title" }, props.offer.title),
    h("p", { class: "offer__promise" }, props.offer.promise),
    h(
      "button",
      { class: "offer__buy", type: "button", onClick: props.onBuy },
      h("span", { class: "offer__buy-label" }, props.labels.buy),
      h("span", { class: "offer__buy-price" }, props.formatPrice(props.offer.price)),
    ),
    h("p", { class: "offer__contents" }, props.labels.contents),
    h("button", { class: "offer__decline", type: "button", onClick: props.onDecline }, props.labels.decline),
  );
}

/**
 * Экран первого шага оплаты целиком. Кроме предложения на нём ничего нет:
 * ни маршрута, ни второй двери, ни второй цены.
 */
export function renderPaymentStep(props: OfferProps): VNode {
  return h("div", { class: "payment" }, renderOffer(props));
}
