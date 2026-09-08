/**
 * Страница оплаты поддельного провайдера (E8-09, ручная половина).
 *
 * Проверяется не оформление, а три вещи, в которых легко ошибиться: что доступ
 * по-прежнему выдаёт только уведомление, что чужой адрес возврата не проходит и
 * что при настоящем провайдере этого маршрута нет вовсе.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { call, profileBody, startTestServer, TEST_WEBHOOK_SECRET } from "./test-support.js";
import { ConfigError, loadConfig } from "./config.js";
import { matchFakePayment, outcomeOf, returnOf, safeReturn } from "./payments/fake-page.js";
import { findOrderByReference, listOrders } from "./store.js";
import type { PageStateDto } from "./contract/index.js";

type OrderReply = { order: { orderId: string; price: number; payment: { url: string } | null } };

/** Профиль на конце лестницы с созданным заказом. */
async function ordered(origin: string): Promise<{ profileId: string; orderId: string; reference: string; returnUrl: string }> {
  const created = await call<PageStateDto>(origin, "POST", "/api/profiles", profileBody("Пётр", null));
  let page = created.body;
  for (const step of [1, 2, 3, 4] as const) {
    const { answersForStep } = await import("./test-support.js");
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: answersForStep(step),
      requestId: `fakepage-${step}`,
    });
    page = reply.body;
  }
  const slice = page.offer?.slice ?? "slice_node_finish";
  const order = await call<OrderReply>(origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: `fakepage-buy-${slice}`,
  });
  const url = order.body.order.payment?.url ?? "";
  const reference = url.split("/pay/fake/")[1]?.split("?")[0] ?? "";
  // Адрес возврата берётся из выданного заказа, а не собирается в тесте: сервер
  // отдаёт его абсолютным, и проверять надо ровно то, что придёт из браузера.
  const returnUrl = new URL(url, "http://localhost").searchParams.get("return") ?? "";
  return { profileId: page.profileId, orderId: order.body.order.orderId, reference, returnUrl };
}

test("адрес страницы разбирается: сама страница и нажатие кнопки", () => {
  assert.deepEqual(matchFakePayment("/pay/fake/fake_abc"), { reference: "fake_abc", settle: false });
  assert.deepEqual(matchFakePayment("/pay/fake/fake_abc/settle"), { reference: "fake_abc", settle: true });
  assert.equal(matchFakePayment("/pay/fake/"), null);
  assert.equal(matchFakePayment("/pay/fake/a/b"), null);
  assert.equal(matchFakePayment("/pay/other/fake_abc"), null);
});

test("возврат принимается только на собственный адрес", () => {
  const own = "https://example.com";
  assert.equal(safeReturn("/p/abc"), "/p/abc");
  assert.equal(safeReturn("//example.com"), "/");
  assert.equal(safeReturn(null), "/");
  // Полный адрес заказа приходит абсолютным: своё происхождение принимается,
  // чужое — нет, иначе страница уводила бы с сайта.
  assert.equal(safeReturn("https://example.com/p/abc?x=1", own), "/p/abc?x=1");
  assert.equal(safeReturn("https://зло.example/p/abc", own), "/");
  assert.equal(safeReturn("https://example.com.зло/p/abc", own), "/");
  assert.equal(safeReturn("https://example.com/p/abc"), "/", "без своего адреса полный не принимается");
  assert.equal(returnOf("outcome=succeeded&return=%2Fp%2Fabc"), "/p/abc");
  assert.equal(returnOf("outcome=succeeded&return=https%3A%2F%2Fexample.com%2Fp%2Fabc", own), "/p/abc");
  assert.equal(returnOf("outcome=succeeded&return=https%3A%2F%2Fexample.com", "https://other.example"), "/");
});

test("неизвестный исход считается отказом, а не успехом", () => {
  assert.equal(outcomeOf("outcome=succeeded"), "succeeded");
  assert.equal(outcomeOf("outcome=failed"), "failed");
  assert.equal(outcomeOf("outcome=что-угодно"), "failed");
  assert.equal(outcomeOf(""), "failed");
});

test("страница показывает заказ и не выдаёт доступ сама", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { orderId, reference, returnUrl } = await ordered(server.origin);
  const page = await fetch(`${server.origin}/pay/fake/${reference}?return=${encodeURIComponent(returnUrl)}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);

  const html = await page.text();
  assert.ok(html.includes(orderId), "на странице нет заказа");
  assert.ok(html.includes(`/pay/fake/${reference}/settle`), "на странице нет действия формы");

  const order = findOrderByReference(server.db, reference);
  assert.equal(order?.status, "created", "простой показ страницы изменил состояние заказа");
});

/**
 * Адрес сервиса задан: тогда `returnUrl` заказа собирается абсолютным — так же,
 * как он уйдёт настоящему провайдеру. Без него путь остаётся относительным, и
 * разбор чужого происхождения не проверялся бы вовсе.
 */
test("нажатие кнопки проводит оплату уведомлением и возвращает на страницу", async (t) => {
  const server = await startTestServer({ SDAI_PUBLIC_ORIGIN: "http://пример.рф" });
  t.after(() => server.close());

  const { profileId, reference, returnUrl } = await ordered(server.origin);
  const settled = await fetch(`${server.origin}/pay/fake/${reference}/settle`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ outcome: "succeeded", return: returnUrl }).toString(),
    redirect: "manual",
  });

  assert.equal(settled.status, 303);
  assert.ok(returnUrl.startsWith("http"), "заказ отдал не абсолютный адрес возврата");
  assert.equal(settled.headers.get("location"), `/p/${profileId}`, "после оплаты человек попал не на свою страницу");
  assert.equal(findOrderByReference(server.db, reference)?.status, "paid");
  assert.equal(listOrders(server.db, profileId).filter((order) => order.status === "paid").length, 1);

  const state = await call<PageStateDto>(server.origin, "GET", `/api/p/${profileId}`);
  assert.ok(state.body.nextPortion?.key.startsWith("slice:"), "после оплаты не пришла порция доборов");
});

test("отказ оплаты доступа не открывает", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { profileId, reference, returnUrl } = await ordered(server.origin);
  await fetch(`${server.origin}/pay/fake/${reference}/settle`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ outcome: "failed", return: returnUrl }).toString(),
    redirect: "manual",
  });

  assert.notEqual(findOrderByReference(server.db, reference)?.status, "paid");
  const state = await call<PageStateDto>(server.origin, "GET", `/api/p/${profileId}`);
  assert.ok(!state.body.nextPortion?.key.startsWith("slice:"), "отказ оплаты открыл доборы");
});

test("чужой адрес возврата не уводит с сайта", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { reference } = await ordered(server.origin);
  const settled = await fetch(`${server.origin}/pay/fake/${reference}/settle`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ outcome: "succeeded", return: "https://example.com/забрать" }).toString(),
    redirect: "manual",
  });

  assert.equal(settled.headers.get("location"), "/");
});

test("несуществующий платёж не рассказывает о себе ничего", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const missing = await fetch(`${server.origin}/pay/fake/fake_нетакого`);
  assert.equal(missing.status, 404);
});

/**
 * Настоящего провайдера в репозитории ещё нет (E8-01a ждёт ответа основателя),
 * поэтому «маршрута нет с настоящим провайдером» проверяется с той стороны, с
 * которой это и обеспечено: в рабочем окружении поддельный провайдер не
 * поднимается вовсе, а значит и страница не появляется.
 */
test("в рабочем окружении поддельный провайдер не поднимается, страницы нет", () => {
  assert.throws(
    () =>
      loadConfig({
        SDAI_ENV: "production",
        SDAI_PAYMENT_PROVIDER: "fake",
        SDAI_PAYMENT_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
        SDAI_DB_PATH: "/tmp/never.db",
        SDAI_PUBLIC_ORIGIN: "https://example.com",
        SDAI_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        SDAI_BACKUP_DIR: "/tmp/never-backups",
      }),
    (error: unknown) => error instanceof ConfigError && error.variables.includes("SDAI_PAYMENT_PROVIDER"),
  );
});
