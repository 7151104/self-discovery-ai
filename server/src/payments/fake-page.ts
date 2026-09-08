/**
 * Страница оплаты поддельного провайдера (E8-09, ручная половина).
 *
 * Настоящий провайдер уводит человека на свою страницу и возвращает обратно.
 * У поддельного такой страницы не было: `createPayment` выдавал адрес
 * `/pay/fake/{reference}`, которого сервер не отдавал, и кнопка с ценой вела в
 * пустоту. Сквозной прогон в CI это не замечал — он доставляет уведомление
 * скриптом (`npm run pay`), минуя браузер. Ручной прогон платного пути был
 * невозможен вовсе, а он нужен и для проверки интерфейса, и для этапа E12.
 *
 * Здесь эта страница есть. Она изображает чужой сервис, а не наш продукт:
 * её текст намеренно не заведён в `content/ui-copy.md`. Реестр микрокопии —
 * голос продукта, и строки платёжной формы провайдера в нём читались бы как
 * наши. Оформления у неё тоже нет: чем меньше она похожа на продукт, тем
 * меньше шансов принять её за него.
 *
 * Обхода оплаты здесь не появляется. Кнопка не переводит заказ в оплаченный —
 * она собирает подписанное уведомление тем же `fakeWebhook` и отдаёт его
 * обычному обработчику уведомлений. Другого пути к доступу нет ни у кого.
 *
 * Маршрут поднимается только при поддельном провайдере, а он запрещён в
 * рабочем окружении проверкой настроек (`server/src/config.ts`).
 */

import type { OrderRecord } from "../store.js";
import { fakeWebhook, FAKE_SIGNATURE_HEADER } from "./fake.js";
import type { WebhookKind } from "./provider.js";

/** Исход, который изображает человек нажатием кнопки. */
export type FakeOutcome = "succeeded" | "failed";

const KIND: Record<FakeOutcome, WebhookKind> = {
  succeeded: "payment.succeeded",
  failed: "payment.failed",
};

export interface FakePaymentRoute {
  reference: string;
  /** POST того же адреса: человек нажал кнопку. */
  settle: boolean;
}

const PREFIX = "/pay/fake/";

/** Адрес страницы оплаты. Идентификатор платежа — последний отрезок пути. */
export function matchFakePayment(pathname: string): FakePaymentRoute | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  const settle = rest.endsWith("/settle");
  const reference = settle ? rest.slice(0, -"/settle".length) : rest;
  if (!reference || reference.includes("/")) return null;
  return { reference, settle };
}

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

/**
 * Куда вернуть человека после нажатия. Адрес приходит параметром, поэтому
 * принимается только свой: чужой сделал бы из страницы открытый переход на
 * любой сайт. Свой — это либо путь от корня, либо полный адрес с тем же
 * происхождением, что у сервиса. Полный нужен потому, что настоящему
 * провайдеру относительный путь отдать нельзя: он на чужом домене, и
 * `returnUrl` заказа собирается абсолютным.
 */
export function safeReturn(raw: string | null, publicOrigin = ""): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (!publicOrigin) return "/";
  try {
    const target = new URL(raw);
    if (target.origin !== new URL(publicOrigin).origin) return "/";
    return `${target.pathname}${target.search}`;
  } catch {
    return "/";
  }
}

const RUBLE = (kopecks: number): string => `${kopecks} ₽`;

/** Страница провайдера: что оплачивается, сколько стоит и две кнопки исхода. */
export function renderFakePaymentPage(order: OrderRecord, returnUrl: string): string {
  const action = `${PREFIX}${escape(order.providerRef ?? "")}/settle`;
  const back = escape(returnUrl);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Поддельный провайдер</title>
</head>
<body>
<h1>Страница оплаты поддельного провайдера</h1>
<p>Это не платёжный сервис и не часть продукта. Настоящего провайдера ещё нет,
и эта страница стоит на его месте, чтобы платный путь можно было пройти руками.
Денег она не трогает.</p>
<dl>
<dt>Заказ</dt><dd>${escape(order.orderId)}</dd>
<dt>Срез</dt><dd>${escape(order.slice)}</dd>
<dt>Сумма</dt><dd>${escape(RUBLE(order.price))}</dd>
<dt>Состояние</dt><dd>${escape(order.status)}</dd>
</dl>
<form method="post" action="${action}">
<input type="hidden" name="return" value="${back}">
<button type="submit" name="outcome" value="succeeded">Изобразить успешную оплату</button>
<button type="submit" name="outcome" value="failed">Изобразить отказ оплаты</button>
</form>
<p><a href="${back}">Вернуться, ничего не изображая</a></p>
</body>
</html>
`;
}

/** Заказа с таким платежом нет. Подробностей не даём: идентификатор перебираем. */
export function renderFakePaymentMissing(): string {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>Поддельный провайдер</title></head>
<body><p>Такого платежа нет.</p></body>
</html>
`;
}

export interface SettleRequest {
  raw: string;
  headers: Record<string, string>;
}

/**
 * Уведомление, какое прислал бы провайдер после нажатия. Отдаётся обычному
 * обработчику: страница ничего не решает о доступе сама.
 */
export function settleRequest(order: OrderRecord, outcome: FakeOutcome, secret: string): SettleRequest {
  const { raw, signature } = fakeWebhook(secret, {
    kind: KIND[outcome],
    orderId: order.orderId,
    reference: order.providerRef ?? "",
    amount: order.price,
  });
  return { raw, headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signature } };
}

/** Исход из тела формы. Неизвестное значение — отказ, а не успех. */
export const outcomeOf = (body: string): FakeOutcome =>
  new URLSearchParams(body).get("outcome") === "succeeded" ? "succeeded" : "failed";

/** Адрес возврата из тела формы. */
export const returnOf = (body: string, publicOrigin = ""): string =>
  safeReturn(new URLSearchParams(body).get("return"), publicOrigin);
