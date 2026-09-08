/**
 * Выдача доступа, Закон 2 и возвраты (E8-04, E8-06).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSlicePortions,
  answersForPortion,
  call,
  deliverWebhook,
  profileAtPaidState,
  profileAtStep,
  purchaseSlice,
  startTestServer,
} from "./test-support.js";
import { listAnswers, listBlocks, listOrders, saveBlockContent } from "./store.js";
import { rawContent } from "./engine.js";
import type { BlockResponse, ErrorDto, OrderResponse, PageStateDto } from "./contract/index.js";

// ── Закон 2: платим за новые ответы (E8-04) ───────────────────────────────────

test("после оплаты первым экраном идут вопросы, а не отчёт", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = await profileAtStep(server.origin, 4);
  assert.equal(before.state, "s4");
  const slice = before.offer?.slice ?? "slice_node_finish";

  const paid = await purchaseSlice(server.origin, slice);
  const page = paid.page;

  // Первое, что видит человек, — порция добора этого среза.
  assert.equal(page.state, "paid_pending");
  assert.ok(page.nextPortion, "после оплаты нет порции вопросов");
  assert.equal(page.nextPortion?.key, `slice:${slice}:1`);
  assert.ok((page.nextPortion?.questions.length ?? 0) > 0);

  // Вопросы — из файла среза, не из кода сервера.
  const content = rawContent.slices.find((candidate) => candidate.id === slice);
  const first = content?.questions.filter((question) => question.portion === 1) ?? [];
  assert.deepEqual(
    page.nextPortion?.questions.map((question) => question.id),
    first.map((question) => `${slice}:${question.id}`),
  );
  assert.equal(page.nextPortion?.lead, content?.promise);

  // Отчёта нет: блока среза не существует, пока не отвечены вопросы.
  assert.equal(
    page.blocks.find((block) => block.id === `slice:${slice}`),
    undefined,
  );
  assert.equal(listBlocks(server.db, page.profileId).some((block) => block.slot === `slice:${slice}`), false);
});

test("блок среза появляется только после пройденного добора", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin, "slice_work");
  const profileId = paid.page.profileId;

  // У дорогого среза две порции: после первой человек снова видит вопросы.
  assert.equal(paid.page.nextPortion?.key, "slice:slice_work:1");
  const firstPortion = paid.page.nextPortion;
  assert.ok(firstPortion);

  const afterFirst = await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: firstPortion.key,
    answers: answersForPortion(firstPortion),
    requestId: "portion-1",
  });
  assert.equal(afterFirst.body.nextPortion?.key, "slice:slice_work:2");
  assert.equal(afterFirst.body.blocks.some((block) => block.id === "slice:slice_work"), false);
  const interlude = afterFirst.body.blocks.find((block) => block.id === "slice:slice_work:interlude");
  assert.ok(interlude, "после первой порции нет промежуточного блока");
  assert.ok(interlude.paragraphs.length > 0);
  assert.equal(interlude.generation, null);

  const done = await answerSlicePortions(server.origin, profileId);
  assert.equal(done.nextPortion, null);

  const block = done.blocks.find((candidate) => candidate.id === "slice:slice_work");
  assert.ok(block, "после добора блока среза нет");
  assert.equal(block.generation?.status, "pending");
  assert.equal(block.purchased, true);
  // Текста ещё нет: его пишет LLM (E4). Отчёт не подменяется старым текстом.
  assert.deepEqual(block.paragraphs, []);
  assert.equal(done.state, "paid_pending");
});

test("после готового среза следующее предложение одно и из таблицы этого среза", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtPaidState(server.origin, server.db, { delivered: true });
  assert.equal(page.state, "paid_done");
  assert.ok(page.offer, "предложения после закрытого среза нет");
  const priced = page.doors.filter((door) => door.price !== null);
  assert.equal(priced.length, 1, "на экране должна быть одна цена следующего предложения");
  assert.equal(priced[0]?.slice, page.offer.slice);
});

test("прямой запрос платного блока без оплаченного заказа отклоняется", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const slot = encodeURIComponent("slice:slice_node_finish");

  const closed = await call<ErrorDto>(server.origin, "GET", `/api/p/${page.profileId}/blocks/${slot}`);
  assert.equal(closed.status, 402);
  assert.equal(closed.body.error.code, "payment_required");

  // Бесплатные блоки открыты владельцу страницы.
  const free = await call<BlockResponse>(server.origin, "GET", `/api/p/${page.profileId}/blocks/step1`);
  assert.equal(free.status, 200);
  assert.ok(free.body.block.paragraphs.length);

  // После оплаты и добора тот же адрес отвечает блоком.
  const paid = await purchaseSlice(server.origin, "slice_node_finish");
  await answerSlicePortions(server.origin, paid.page.profileId);
  const opened = await call<BlockResponse>(
    server.origin,
    "GET",
    `/api/p/${paid.page.profileId}/blocks/${slot}`,
  );
  assert.equal(opened.status, 200);
  assert.equal(opened.body.block.id, "slice:slice_node_finish");
});

test("текст среза в базе не открывает доступ без оплаченного заказа", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin, "slice_node_finish");
  const profileId = paid.page.profileId;
  await answerSlicePortions(server.origin, profileId);

  saveBlockContent(server.db, profileId, {
    slot: "slice:slice_node_finish",
    profileVersion: 1,
    purchased: true,
    heading: "Почему ты останавливаешься у финиша",
    paragraphs: ["Механизм включается на восьмидесяти процентах пути."],
    highlight: null,
  });

  // Возврат отзывает доступ; текст блока при этом уходит.
  const refund = await call<OrderResponse>(
    server.origin,
    "POST",
    `/api/p/${profileId}/orders/${paid.orderId}/refunds`,
  );
  assert.equal(refund.status, 409, "текст собран — автоматического возврата быть не должно");
  assert.equal((refund.body as unknown as ErrorDto).error.code, "refund_unavailable");
});

// ── Возвраты (E8-06) ──────────────────────────────────────────────────────────

test("возврат до сборки текста отзывает доступ и возвращает страницу к s4", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin, "slice_node_finish");
  const profileId = paid.page.profileId;
  await answerSlicePortions(server.origin, profileId);

  const before = await call<PageStateDto>(server.origin, "GET", `/api/p/${profileId}`);
  assert.equal(before.body.state, "paid_pending");
  assert.ok(before.body.blocks.some((block) => block.id === "slice:slice_node_finish"));

  const refund = await call<OrderResponse>(
    server.origin,
    "POST",
    `/api/p/${profileId}/orders/${paid.orderId}/refunds`,
  );
  assert.equal(refund.status, 200);
  assert.equal(refund.body.order.status, "refunded");
  // Возврат полный: сумма заказа не уменьшается.
  assert.equal(refund.body.order.price, paid.price);

  const after = refund.body.page;
  assert.equal(after.state, "s4");
  assert.equal(after.blocks.some((block) => block.id === "slice:slice_node_finish"), false);
  assert.equal(after.nextPortion, null);

  const slot = encodeURIComponent("slice:slice_node_finish");
  const closed = await call<ErrorDto>(server.origin, "GET", `/api/p/${profileId}/blocks/${slot}`);
  assert.equal(closed.status, 402);

  // Ответы добора человеку оставлены: их дал он.
  const answers = listAnswers(server.db, profileId).filter((answer) =>
    answer.questionId.startsWith("slice_node_finish:"),
  );
  assert.ok(answers.length > 0);
});

test("возврат по уведомлению провайдера тоже отзывает доступ", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin, "slice_node_finish");
  await answerSlicePortions(server.origin, paid.page.profileId);

  const reply = await deliverWebhook(server.origin, {
    kind: "refund.succeeded",
    orderId: paid.orderId,
    reference: paid.reference,
    amount: paid.price,
  });
  assert.equal(reply.body.result, "applied");

  const page = await call<PageStateDto>(server.origin, "GET", `/api/p/${paid.page.profileId}`);
  assert.equal(page.body.state, "s4");
  assert.equal(listOrders(server.db, paid.page.profileId)[0]?.status, "refunded");
  assert.equal(listBlocks(server.db, paid.page.profileId).some((block) => block.slot.startsWith("slice:")), false);
});

test("возврат по неоплаченному заказу отклоняется как недопустимый переход", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const order = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice: "slice_node_finish",
    requestId: "buy-1",
  });

  const refund = await call<ErrorDto>(
    server.origin,
    "POST",
    `/api/p/${page.profileId}/orders/${order.body.order.orderId}/refunds`,
  );
  assert.equal(refund.status, 409);
  assert.equal(refund.body.error.code, "invalid_transition");

  const missing = await call<ErrorDto>(server.origin, "POST", `/api/p/${page.profileId}/orders/нет/refunds`);
  assert.equal(missing.status, 404);
});

test("после возврата срез можно купить заново", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin, "slice_node_finish");
  const profileId = paid.page.profileId;
  await call(server.origin, "POST", `/api/p/${profileId}/orders/${paid.orderId}/refunds`);

  const again = await call<OrderResponse>(server.origin, "POST", `/api/p/${profileId}/orders`, {
    slice: "slice_node_finish",
    requestId: "buy-2",
  });
  assert.equal(again.status, 201);
  assert.notEqual(again.body.order.orderId, paid.orderId);
  assert.equal(listOrders(server.db, profileId).length, 2);
});
