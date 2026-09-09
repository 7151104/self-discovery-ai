/**
 * Оплата: порт провайдера, состояние заказа, уведомления, доступ (E8).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { ConfigError, loadConfig } from "./config.js";
import { canTransition, InvalidTransition, ORDER_STATUSES } from "./payments/order-state.js";
import { createFakeProvider, fakeWebhook, FAKE_SIGNATURE_HEADER, signWebhook } from "./payments/fake.js";
import { createProvider, knownProviders, UnknownProvider } from "./payments/registry.js";
import { up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import {
  countDeliveries,
  findOrder,
  insertOrder,
  insertProfile,
  listOrderEvents,
  listOrders,
  transitionOrder,
} from "./store.js";
import {
  call,
  deliverWebhook,
  profileAtStep,
  purchaseSlice,
  startTestServer,
  TEST_KEY,
  TEST_WEBHOOK_SECRET,
} from "./test-support.js";
import { rawContent } from "./engine.js";
import type { ErrorDto, OrderResponse, PageStateDto } from "./contract/index.js";

// ── Порт и реализации (E8-01, E8-09) ──────────────────────────────────────────

test("реестр поднимает поддельного провайдера и отказывает незнакомому", () => {
  assert.deepEqual(knownProviders(), ["fake"]);

  const provider = createProvider({
    payments: { provider: "fake", webhookSecret: "s" },
    publicOrigin: "https://example.com",
  });
  assert.equal(provider.name, "fake");
  assert.equal(provider.mode, "test");

  assert.throws(
    () =>
      createProvider({
        payments: { provider: "будущий-провайдер", webhookSecret: "s" },
        publicOrigin: "",
      }),
    UnknownProvider,
  );
});

test("тестовый режим невозможно включить в рабочем окружении", () => {
  const production = {
    SDAI_ENV: "production",
    SDAI_PUBLIC_ORIGIN: "https://example.com",
    SDAI_ENCRYPTION_KEY: TEST_KEY,
    SDAI_PAYMENT_WEBHOOK_SECRET: "секрет",
    SDAI_DB_PATH: "/var/lib/sdai/production.db",
    SDAI_BACKUP_DIR: "/var/backups/sdai/production",
  };

  assert.throws(
    () => loadConfig({ ...production, SDAI_PAYMENT_PROVIDER: "fake" }),
    (error: unknown) =>
      error instanceof ConfigError && error.reason === "fake-provider-forbidden-in-production",
  );

  // По умолчанию тоже `fake`: в рабочем окружении не спасает и умолчание.
  assert.throws(() => loadConfig(production), ConfigError);

  // Названный провайдер проходит проверку; поднять его — уже дело реестра.
  const named = loadConfig({ ...production, SDAI_PAYMENT_PROVIDER: "будущий-провайдер" });
  assert.equal(named.payments.provider, "будущий-провайдер");
  assert.equal(loadConfig({}).payments.provider, "fake");
});

test("поддельный провайдер проверяет подпись уведомления", () => {
  const provider = createFakeProvider({ secret: "секрет", publicOrigin: "https://example.com" });
  const { raw, signature } = fakeWebhook("секрет", {
    kind: "payment.succeeded",
    orderId: "o1",
    reference: "fake_1",
    amount: 590,
  });

  const event = provider.parseWebhook(raw, { [FAKE_SIGNATURE_HEADER]: signature });
  assert.equal(event?.kind, "payment.succeeded");
  assert.equal(event?.orderId, "o1");
  assert.equal(event?.amount, 590);

  assert.equal(provider.parseWebhook(raw, {}), null);
  assert.equal(provider.parseWebhook(raw, { [FAKE_SIGNATURE_HEADER]: "0".repeat(64) }), null);
  // Подпись считается по телу: правка тела ломает её.
  const tampered = raw.replace("590", "1");
  assert.equal(provider.parseWebhook(tampered, { [FAKE_SIGNATURE_HEADER]: signature }), null);
  assert.equal(provider.parseWebhook(tampered, { [FAKE_SIGNATURE_HEADER]: signWebhook("секрет", tampered) })?.amount, 1);
});

// ── Заказ как состояние (E8-02) ───────────────────────────────────────────────

test("таблица переходов заказа: допустимые проходят, остальные отклоняются", () => {
  const allowed = new Set(["created->paid", "created->failed", "paid->refunded"]);

  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      assert.equal(canTransition(from, to), allowed.has(`${from}->${to}`), `${from}->${to}`);
    }
  }
});

test("переход пишется в журнал заказа, недопустимый не выполняется", () => {
  const db = openDatabase({ path: ":memory:" });
  try {
    up(db);
    insertProfile(db, { profileId: "p1", name: "Аня", birthDate: null });
    const order = insertOrder(db, "p1", {
      slice: "slice_node_finish",
      price: 590,
      requestId: "r1",
      provider: "fake",
      providerRef: "fake_1",
      mode: "test",
    });

    const paid = transitionOrder(db, order, "paid", "webhook");
    assert.equal(paid.status, "paid");

    assert.throws(() => transitionOrder(db, paid, "paid", "webhook"), InvalidTransition);
    assert.throws(() => transitionOrder(db, paid, "failed", "webhook"), InvalidTransition);

    const refunded = transitionOrder(db, paid, "refunded", "refund_requested");
    assert.throws(() => transitionOrder(db, refunded, "paid", "webhook"), InvalidTransition);

    assert.deepEqual(
      listOrderEvents(db, order.orderId).map((event) => `${event.from}->${event.to}`),
      ["created->paid", "paid->refunded"],
    );
    // Место среза освободилось: после возврата его снова можно купить.
    assert.equal(findOrder(db, "p1", order.orderId)?.status, "refunded");
    insertOrder(db, "p1", {
      slice: "slice_node_finish",
      price: 590,
      requestId: "r2",
      provider: "fake",
      providerRef: "fake_2",
      mode: "test",
    });
  } finally {
    db.close();
  }
});

// ── Вебхуки и идемпотентность (E8-03) ─────────────────────────────────────────

test("три доставки одного уведомления выдают доступ один раз", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const slice = page.offer?.slice ?? "slice_node_finish";
  const order = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: "buy-1",
  });
  const orderId = order.body.order.orderId;
  const reference = order.body.order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "";

  const results: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reply = await deliverWebhook(server.origin, {
      kind: "payment.succeeded",
      orderId,
      reference,
      amount: order.body.order.price,
      eventId: "evt-одно-и-то-же",
    });
    assert.equal(reply.status, 200);
    results.push(reply.body.result);
  }

  assert.deepEqual(results, ["applied", "duplicate", "duplicate"]);
  assert.equal(countDeliveries(server.db), 1);

  const orders = listOrders(server.db, page.profileId);
  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.status, "paid");
  // Переход был один: доступ выдан один раз.
  assert.deepEqual(
    listOrderEvents(server.db, orderId).map((event) => event.to),
    ["paid"],
  );
});

test("уведомление с неверной подписью отклоняется и ничего не меняет", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { page, orderId, reference, price } = await purchaseSlice(server.origin);
  const before = listOrders(server.db, page.profileId)[0]?.status;

  const { raw } = fakeWebhook("чужой-секрет", {
    kind: "payment.succeeded",
    orderId,
    reference,
    amount: price,
  });
  const response = await fetch(`${server.origin}/api/payments/fake/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signWebhook("чужой-секрет", raw) },
    body: raw,
  });

  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as ErrorDto).error.code, "invalid_signature");
  assert.equal(listOrders(server.db, page.profileId)[0]?.status, before);
});

test("уведомление с чужой суммой не выдаёт доступ", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const order = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice: "slice_node_finish",
    requestId: "buy-1",
  });
  const reference = order.body.order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "";

  const reply = await deliverWebhook(server.origin, {
    kind: "payment.succeeded",
    orderId: order.body.order.orderId,
    reference,
    amount: 1,
  });

  assert.equal(reply.body.result, "ignored");
  assert.equal(listOrders(server.db, page.profileId)[0]?.status, "created");
});

test("уведомление о неизвестном заказе принимается и остаётся без последствий", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const reply = await deliverWebhook(server.origin, {
    kind: "payment.succeeded",
    orderId: "заказа-нет",
    reference: "fake_нет",
    amount: 590,
  });

  // Успех — чтобы провайдер перестал повторять; результат — «не применено».
  assert.equal(reply.status, 200);
  assert.equal(reply.body.result, "ignored");
  assert.equal(countDeliveries(server.db), 1);
});

// ── Защита от повторной покупки (E8-07) ───────────────────────────────────────

test("две одновременные покупки одного среза дают один заказ и один доступ", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const slice = page.offer?.slice ?? "slice_node_finish";

  // Разные ключи отправки: ключ отправки такой случай не ловит, ловит база.
  const [first, second] = await Promise.all([
    call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, { slice, requestId: "a" }),
    call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, { slice, requestId: "b" }),
  ]);

  assert.equal(first?.body.order.orderId, second?.body.order.orderId);
  assert.equal(listOrders(server.db, page.profileId).length, 1);

  // Проигравший гонку отдаёт тот же заказ, но без адреса оплаты. Уведомление
  // без payment_id провайдер не разбирает — берём ответ, который заказ создал.
  const created = [first, second].find((reply) => reply.status === 201);
  assert.ok(created, "ровно один из двух запросов должен создать заказ");
  const orderId = created.body.order.orderId;
  const reference = created.body.order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "";
  assert.ok(reference.length > 0, "у созданного заказа нет адреса оплаты");
  const paid = await deliverWebhook(server.origin, {
    kind: "payment.succeeded",
    orderId,
    reference,
    amount: created.body.order.price,
  });
  assert.equal(paid.body.result, "applied");

  // Уже оплаченный срез второй раз не продаётся.
  const third = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: "c",
  });
  assert.equal(third.status, 200);
  assert.equal(third.body.order.orderId, orderId);
  assert.equal(third.body.order.status, "paid");
  assert.equal(listOrders(server.db, page.profileId).length, 1);
});

// ── Цены из контента (E8-08) ──────────────────────────────────────────────────

/** Цены из markdown напрямую: тест читает тот же файл, что и сборщик контента. */
function pricesFromMarkdown(): Record<string, number> {
  const source = readFileSync(new URL("../../content/slices/README.md", import.meta.url), "utf8");
  const prices: Record<string, number> = {};

  for (const line of source.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const id = cells.find((cell) => /^`?slice_[a-z_]+`?$/.test(cell))?.replace(/`/g, "");
    const price = cells.map((cell) => cell.replace(/\s/g, "")).find((cell) => /^\d{3,4}₽?$/.test(cell));
    if (id && price) prices[id] = Number(price.replace("₽", ""));
  }
  return prices;
}

test("цена заказа приходит из content/slices/README.md, а не из кода", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const fromMarkdown = pricesFromMarkdown();
  assert.ok(Object.keys(fromMarkdown).length >= 8, JSON.stringify(fromMarkdown));

  // Сборщик контента разобрал те же числа.
  for (const slice of rawContent.slices) {
    assert.equal(slice.price, fromMarkdown[slice.id], `${slice.id}: цена разошлась со сборщиком`);
  }

  // И они же доезжают до заказа.
  const page = await profileAtStep(server.origin, 4);
  for (const slice of ["slice_node_finish", "slice_work", "slice_decision_moment"]) {
    const order = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
      slice,
      requestId: `buy-${slice}`,
    });
    assert.equal(order.body.order.price, fromMarkdown[slice], slice);
  }
});

test("чисел цен в коде сервера нет", () => {
  const prices = new Set(rawContent.slices.map((slice) => String(slice.price)));
  const sources = readdirSync(new URL("../src/", import.meta.url), { recursive: true, encoding: "utf8" });

  for (const file of sources) {
    // Обвязка тестов не в счёт: её числа — даты рождения, а не цены.
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.endsWith("test-support.ts")) continue;
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    for (const price of prices) {
      assert.ok(!new RegExp(`\\b${price}\\b`).test(text), `${file}: цена ${price} зашита в код`);
    }
  }
});

// ── Тестовый режим виден клиенту (E8-09) ──────────────────────────────────────

test("заказ показывает, что деньги не настоящие", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const order = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice: "slice_node_finish",
    requestId: "buy-1",
  });

  assert.equal(order.body.order.payment?.mode, "test");
  assert.equal(server.db.get<{ mode: string }>("SELECT provider_mode AS mode FROM orders")?.mode, "test");

  const state = await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`);
  assert.equal(state.body.state, "s4");
});
