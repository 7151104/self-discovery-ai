/**
 * Сквозной прогон платного пути без денег (E8-09): `npm run pay`.
 *
 * Изображает то, что делает провайдер после оплаты, — присылает подписанное
 * уведомление. Отдельного эндпоинта «считать заказ оплаченным» в сервере нет и
 * быть не должно: тогда доступ выдавался бы по просьбе клиента.
 *
 * Использование:
 *   npm run pay -- <адрес> <идентификатор заказа> <идентификатор платежа> <сумма> [исход]
 *
 * Исход: succeeded (по умолчанию), failed, refunded. Секрет подписи берётся из
 * SDAI_PAYMENT_WEBHOOK_SECRET — того же, с которым запущен сервер.
 */

import { loadConfig } from "../config.js";
import { fakeWebhook, FAKE_SIGNATURE_HEADER } from "./fake.js";
import type { WebhookKind } from "./provider.js";

const KINDS: Record<string, WebhookKind> = {
  succeeded: "payment.succeeded",
  failed: "payment.failed",
  refunded: "refund.succeeded",
};

const [origin, orderId, reference, amount, outcome = "succeeded"] = process.argv.slice(2);
const kind = KINDS[outcome];

if (!origin || !orderId || !reference || !amount || !kind) {
  process.stderr.write("usage: npm run pay -- <origin> <orderId> <paymentId> <amount> [succeeded|failed|refunded]\n");
  process.exit(1);
}

const config = loadConfig();
if (config.payments.provider !== "fake") {
  process.stderr.write(`${JSON.stringify({ event: "pay.refused", provider: config.payments.provider })}\n`);
  process.exit(1);
}

const { raw, signature } = fakeWebhook(config.payments.webhookSecret, {
  kind,
  orderId,
  reference,
  amount: Number(amount),
});

const response = await fetch(`${origin}/api/payments/fake/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signature },
  body: raw,
});

process.stdout.write(`${await response.text()}\n`);
process.exit(response.ok ? 0 : 1);
