/**
 * Поддельный платёжный провайдер (E8-01, E8-09).
 *
 * Проходит весь маршрут оплаты, не трогая денег: заводит платёж, подписывает
 * уведомления тем же способом, что и настоящий провайдер (HMAC-SHA256 по телу
 * запроса), и умеет возврат. Нужен для тестов, для сквозных прогонов и для
 * того, чтобы платный путь можно было пройти руками до выбора провайдера.
 *
 * Режим у него всегда `test`. Включить его в рабочем окружении нельзя: такое
 * сочетание переменных не проходит проверку конфигурации (`server/src/config.ts`).
 */

import { createHmac } from "node:crypto";
import { equalSignatures } from "../db/crypto.js";
import { newRecordId } from "../ids.js";
import type {
  PaymentHandle,
  PaymentProvider,
  PaymentRequest,
  RefundHandle,
  RefundRequest,
  WebhookEvent,
  WebhookHeaders,
  WebhookKind,
} from "./provider.js";

export const FAKE_SIGNATURE_HEADER = "x-payment-signature";

/** Подпись тела уведомления. Та же функция считает её и на отправке, и на приёме. */
export const signWebhook = (secret: string, raw: string): string =>
  createHmac("sha256", secret).update(raw).digest("hex");

/** Тело уведомления. Форма своя у каждого провайдера; у поддельного — эта. */
interface FakeWebhookBody {
  event_id: string;
  type: WebhookKind;
  order_id: string;
  payment_id: string;
  amount: number;
  currency: string;
}

const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

const KINDS: WebhookKind[] = ["payment.succeeded", "payment.failed", "refund.succeeded"];

export interface FakeOptions {
  secret: string;
  /** Внешний адрес сервиса: из него собирается ссылка на «страницу оплаты». */
  publicOrigin: string;
}

export function createFakeProvider({ secret, publicOrigin }: FakeOptions): PaymentProvider {
  return {
    name: "fake",
    mode: "test",

    createPayment(request: PaymentRequest): PaymentHandle {
      const reference = `fake_${newRecordId()}`;
      // Настоящий провайдер отдаёт свою страницу оплаты; поддельный —
      // адрес, по которому её изображает сквозной прогон (`npm run pay`).
      const url = `${publicOrigin}/pay/fake/${reference}?return=${encodeURIComponent(request.returnUrl)}`;
      return { reference, url };
    },

    parseWebhook(raw: string, headers: WebhookHeaders): WebhookEvent | null {
      const header = headers[FAKE_SIGNATURE_HEADER];
      const signature = Array.isArray(header) ? header[0] : header;
      if (!signature || !equalSignatures(signature, signWebhook(secret, raw))) return null;

      let body: FakeWebhookBody;
      try {
        body = JSON.parse(raw) as FakeWebhookBody;
      } catch {
        return null;
      }

      const eventId = asString(body.event_id);
      const orderId = asString(body.order_id);
      const reference = asString(body.payment_id);
      const kind = KINDS.find((candidate) => candidate === body.type);
      if (!eventId || !orderId || !reference || !kind) return null;
      if (typeof body.amount !== "number" || !Number.isInteger(body.amount)) return null;

      return { eventId, kind, orderId, reference, amount: body.amount, currency: body.currency || "RUB" };
    },

    refund(request: RefundRequest): RefundHandle {
      return { reference: `fake_refund_${newRecordId()}` };
    },
  };
}

/**
 * Тело и подпись уведомления, какие прислал бы провайдер.
 * Ими пользуются тесты и команда сквозного прогона; сервер их не вызывает.
 */
export function fakeWebhook(
  secret: string,
  input: { kind: WebhookKind; orderId: string; reference: string; amount: number; eventId?: string },
): { raw: string; signature: string; eventId: string } {
  const eventId = input.eventId ?? `evt_${newRecordId()}`;
  const body: FakeWebhookBody = {
    event_id: eventId,
    type: input.kind,
    order_id: input.orderId,
    payment_id: input.reference,
    amount: input.amount,
    currency: "RUB",
  };
  const raw = JSON.stringify(body);
  return { raw, signature: signWebhook(secret, raw), eventId };
}
