/**
 * Сквозной тест платного пути (E11-02).
 *
 * Предложение → оплата в тестовом режиме → доборы → порог → отчёт → новая дверь.
 * Настоящий сервер, настоящий клиент (`createPageApp`). Оплата — поддельный
 * провайдер и подписанный вебхук, как в живом продукте: страница
 * `/pay/fake/…/settle` сама доступ не выдаёт.
 *
 * Два среза разных машинных типов: узловой `slice_node_finish` (одна порция)
 * и прикладной `slice_work` (две порции и промежуточный блок). Разбор развилки
 * сюда не входит: его порог требует подтип координаты 14, который ставит
 * другой срез.
 *
 * Ожидания читаются из таблицы `docs/11-ui-page-spec.md` и из контента среза,
 * русские строки продукта в тесте не зашиты. Текст отчёта проверяется
 * валидатором явно и обязан дойти до дерева страницы — не «блок присутствует».
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { hostOf as baseHost } from "../host.js";
import { loadKit } from "../kit.js";
import { demoAnswerFor, demoPerson, sliceAnswerFor } from "../ladder.js";
import { load, server, web } from "../load.js";
import type { Child } from "../visual/capture.js";
import { specLadderBlocks, specPageStates, uiSpecDoc } from "../states.js";
import { blockOrder } from "./inspect.js";

type PageStateDto = {
  profileId: string;
  state: string;
  offer: { slice: string; price: number } | null;
  nextPortion: { key: string; questions: { id: string; kind: string }[] } | null;
  blocks: {
    id: string;
    heading: string;
    paragraphs: string[];
    generation: { status: string } | null;
  }[];
  doors: { slice: string; price: number | null }[];
  clarifications: { slice: string; questions: string[] } | null;
};

type Session = {
  screen: string;
  page: PageStateDto | null;
};

type PageApp = {
  tree: () => Child;
  session: () => Session;
  start: () => Promise<void>;
  accept: (input: unknown) => Promise<void>;
  intro: (name: string, birthDate: string | null) => Promise<void>;
  consent: (checked: boolean) => void;
  buy: () => Promise<void>;
  stop: () => void;
  flushWatch: () => Promise<void>;
};

type ManualTimer = {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  flush: () => void;
};

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

type Support = {
  startTestServer: (env?: NodeJS.ProcessEnv) => Promise<TestServer>;
  drainServer: (server: TestServer) => Promise<void>;
  call: <T>(origin: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
};

type OrderDto = {
  orderId: string;
  slice: string;
  price: number;
  payment: { url: string } | null;
};

type Engine = {
  buildSliceInterludeBlock: (
    slice: string,
    answers: Record<string, unknown>,
  ) => { heading: string; paragraphs: string[] } | null;
};

type Llm = {
  validateText: (text: string, options: { type: string }) => { ok: boolean; violations: { detail: string }[] };
  describeViolation: (violation: { detail: string }) => string;
  reportTypeOfSlice: (slice: string) => string;
};

type SliceFixtures = { sliceAnswers: (id: string) => Record<string, unknown> };

const NODE = "slice_node_finish";
const WORK = "slice_work";

const INTERLUDE = (slice: string): string => `slice:${slice}:interlude`;
const REPORT = (slice: string): string => `slice:${slice}`;

const isSlicePortion = (key: string | undefined): boolean => key?.startsWith("slice:") === true;

const referenceOf = (order: OrderDto): string => order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "";

const localSliceQuestionId = (slice: string, questionId: string): string =>
  questionId.startsWith(`${slice}:`) ? questionId.slice(slice.length + 1) : questionId;

test("таблица состояний называет платные экраны после лестницы", () => {
  const doc = uiSpecDoc();
  const states = specPageStates(doc);
  assert.ok(states.includes("paid_pending"), "в таблице нет paid_pending");
  assert.ok(states.includes("paid_done"), "в таблице нет paid_done");

  const blocks = specLadderBlocks(doc);
  assert.deepEqual(blocks.paid_pending, ["step1", "step2", "step3", "step4"]);
  assert.deepEqual(blocks.paid_done, ["step1", "step2", "step3", "step4"]);
});

test("платный путь: оплата, доборы, отчёт, новая дверь — узел и работа", async (t) => {
  const kit = await loadKit();
  const support = await server<Support>("test-support.js");
  const engine = await load<Engine>("engine/dist/index.js");
  const llm = await load<Llm>("server/llm/dist/index.js");
  const fixtures = await load<SliceFixtures>("engine/dist/slice-fixtures.js");
  const { createPageApp } = await web<{
    createPageApp: (host: ReturnType<typeof baseHost> & { timer: ManualTimer; fetch: typeof fetch }) => PageApp;
  }>("src/app.js");
  const { createManualTimer } = await web<{ createManualTimer: () => ManualTimer }>("src/test-support.js");

  const testServer = await support.startTestServer();
  t.after(() => testServer.close());

  const capture: { order: OrderDto | null } = { order: null };
  const capturingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.includes("/orders")) {
      const body = (await response.clone().json()) as { order?: OrderDto };
      if (body.order) capture.order = body.order;
    }
    return response;
  };

  const timer = createManualTimer();
  const host = { ...baseHost(testServer.origin, "/"), timer, fetch: capturingFetch };
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const person = await demoPerson();
  app.consent(true);
  await app.intro(person.name, person.birthDate);

  const pulse = async () => {
    timer.flush();
    await app.flushWatch();
  };

  const current = (): PageStateDto => {
    const page = app.session().page;
    assert.ok(page, "страницы нет");
    return page;
  };

  const reload = async () => {
    await app.start();
  };

  const pageViaApi = async (): Promise<PageStateDto> => {
    const reply = await support.call<PageStateDto>(testServer.origin, "GET", `/api/p/${current().profileId}`);
    assert.equal(reply.status, 200, `состояние страницы: ${reply.status}`);
    return reply.body;
  };

  const hasSliceAccess = (page: PageStateDto, slice: string): boolean =>
    page.nextPortion?.key.startsWith(`slice:${slice}:`) === true ||
    page.blocks.some((block) => block.id === REPORT(slice) || block.id === INTERLUDE(slice));

  const assertNoSliceAccess = async (slice: string, when: string) => {
    const viaApi = await pageViaApi();
    assert.equal(hasSliceAccess(viaApi, slice), false, `${when}: API уже отдаёт добор или блок среза`);
    assert.equal(isSlicePortion(current().nextPortion?.key), false, `${when}: клиент уже показывает добор`);
    assert.equal(
      kit.byClass(app.tree(), "block").some((node) => String(node.attrs["data-block"] ?? "").startsWith(`slice:${slice}`)),
      false,
      `${when}: на дереве уже есть блок среза`,
    );
  };

  for (const step of [1, 2, 3] as const) {
    const questions = current().nextPortion?.questions ?? [];
    for (const question of questions) {
      await app.accept(await demoAnswerFor(question));
    }
  }

  const open = current().nextPortion?.questions[0];
  assert.ok(open && open.kind === "открытый", "после ступени 3 нет открытого вопроса");
  await app.accept(await demoAnswerFor(open));
  await support.drainServer(testServer);
  await pulse();

  assert.equal(current().state, "s4");
  assert.equal(current().offer?.slice, NODE, "после лестницы демо-человека первое предложение не узловой срез");
  assert.equal(kit.byClass(app.tree(), "offer").length, 1);

  const payOfferedSlice = async (slice: string) => {
    await app.buy();
    const order = capture.order;
    assert.ok(order, "заказ после нажатия «купить» не создался");
    assert.equal(order.slice, slice, "создан заказ на другой срез");
    assert.match(host.assigned.at(-1) ?? "", /\/pay\/fake\//, "клиент не ушёл на страницу оплаты");
    const reference = referenceOf(order);
    assert.ok(reference, "у заказа нет идентификатора платежа");

    await assertNoSliceAccess(slice, "после заказа, до уведомления");

    const unsigned = await fetch(`${testServer.origin}/api/payments/fake/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: `evt_unsigned_${order.orderId}`,
        type: "payment.succeeded",
        order_id: order.orderId,
        payment_id: reference,
        amount: order.price,
        currency: "RUB",
      }),
    });
    assert.notEqual(unsigned.status, 200, "вебхук без подписи принят как успешный");
    await reload();
    await assertNoSliceAccess(slice, "после вебхука без подписи");

    const paymentUrl = order.payment?.url ?? "";
    const returnUrl = new URL(paymentUrl, testServer.origin).searchParams.get("return") ?? `/p/${current().profileId}`;
    const settled = await fetch(`${testServer.origin}/pay/fake/${reference}/settle`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ outcome: "succeeded", return: returnUrl }).toString(),
      redirect: "manual",
    });
    assert.equal(settled.status, 303, `settle: ${settled.status}`);

    await reload();
    const viaApi = await pageViaApi();
    assert.equal(viaApi.state, "paid_pending", "после подписанной оплаты страница не в paid_pending");
    assert.equal(viaApi.nextPortion?.key, `slice:${slice}:1`, "после оплаты нет первой порции добора");
    assert.equal(current().nextPortion?.key, `slice:${slice}:1`);
    assert.equal(kit.byClass(app.tree(), "portion").length, 1, "порции добора нет на дереве");
    assert.equal(kit.byClass(app.tree(), "offer").length, 0, "предложение осталось на экране добора");
    assert.equal(
      kit.byClass(app.tree(), "block").some((node) => node.attrs["data-block"] === REPORT(slice)),
      false,
      "отчёт среза показан до ответов",
    );
  };

  const answerSlicePortion = async (slice: string): Promise<{ key: string; questions: { id: string; kind: string }[] }> => {
    const portion = current().nextPortion;
    assert.ok(portion && portion.key.startsWith(`slice:${slice}:`), `нет порции добора ${slice}`);
    const snapshot = { key: portion.key, questions: portion.questions.slice() };
    for (const question of snapshot.questions) {
      await app.accept(await sliceAnswerFor(slice, question));
    }
    assert.notEqual(current().nextPortion?.key, snapshot.key, `порция ${snapshot.key} не ушла`);
    return snapshot;
  };

  const assertSliceReport = async (slice: string) => {
    await support.drainServer(testServer);
    await pulse();
    await reload();
    await pulse();

    const page = current();
    assert.equal(page.clarifications, null, `у ${slice} уточняющие вместо отчёта`);
    assert.equal(page.state, "paid_done", `${slice}: страница не закрыла срез`);

    const block = page.blocks.find((item) => item.id === REPORT(slice));
    assert.ok(block, `${slice}: блока среза нет в состоянии`);
    assert.equal(block.generation?.status, "ready", block.generation?.status ?? "блока генерации нет");
    assert.ok(block.heading.length > 0, `${slice}: у отчёта нет заголовка`);
    assert.ok(block.paragraphs.length > 0, `${slice}: текст отчёта пуст`);
    assert.ok(
      block.paragraphs.some((paragraph) => paragraph.trim().length > 0),
      `${slice}: абзацы отчёта пустые`,
    );

    const tree = app.tree();
    assert.ok(blockOrder(tree, kit).includes(REPORT(slice)), `${slice}: блока нет на дереве`);
    const sample = block.paragraphs.find((paragraph) => paragraph.trim().length > 0) ?? "";
    assert.ok(
      kit.visibleText(tree).includes(sample.slice(0, 40)),
      `${slice}: текст отчёта не дошёл до страницы`,
    );

    const type = llm.reportTypeOfSlice(slice);
    const verdict = llm.validateText(block.paragraphs.join("\n\n"), { type });
    assert.equal(
      verdict.ok,
      true,
      `${slice}: валидатор отклонил отчёт: ${verdict.violations.map((item) => llm.describeViolation(item)).join("; ")}`,
    );

    assert.ok(page.offer, `${slice}: предложения после закрытого среза нет`);
    assert.notEqual(page.offer.slice, slice, `${slice}: следующее предложение — тот же срез`);
    assert.equal(kit.byClass(tree, "offer").length, 1, `${slice}: следующих предложений больше одного или нет`);
    const priced = page.doors.filter((door) => door.price !== null);
    assert.equal(priced.length, 1, `${slice}: на маршруте больше одной цены`);
    assert.equal(priced[0]?.slice, page.offer.slice);
  };

  await payOfferedSlice(NODE);
  assert.equal(
    kit.byClass(app.tree(), "block").some((node) => node.attrs["data-block"] === INTERLUDE(NODE)),
    false,
    "у узлового среза промежуточный блок появился до порций",
  );
  const nodePortion = await answerSlicePortion(NODE);
  assert.equal(nodePortion.key, `slice:${NODE}:1`);
  assert.equal(isSlicePortion(current().nextPortion?.key), false, "у узлового среза оказалась вторая порция");
  assert.equal(
    kit.byClass(app.tree(), "block").some((node) => node.attrs["data-block"] === INTERLUDE(NODE)),
    false,
    "у узлового среза появился промежуточный блок",
  );
  await assertSliceReport(NODE);

  assert.equal(current().offer?.slice, WORK, "после узлового среза следующее предложение не прикладной срез");
  await payOfferedSlice(WORK);

  const beforeFirst = blockOrder(app.tree(), kit);
  assert.equal(beforeFirst.includes(INTERLUDE(WORK)), false, "промежуточный блок до первой порции");

  const first = await answerSlicePortion(WORK);
  assert.equal(first.key, `slice:${WORK}:1`);
  assert.equal(current().nextPortion?.key, `slice:${WORK}:2`, "после первой порции нет второй");

  const partial = Object.fromEntries(
    first.questions.map((question) => [
      localSliceQuestionId(WORK, question.id),
      fixtures.sliceAnswers(WORK)[localSliceQuestionId(WORK, question.id)],
    ]),
  );
  const expectedInterlude = engine.buildSliceInterludeBlock(WORK, partial);
  assert.ok(expectedInterlude, "движок не собрал промежуточный блок на ответах первой порции");
  const interludeNode = kit.byClass(app.tree(), "block").find((node) => node.attrs["data-block"] === INTERLUDE(WORK));
  assert.ok(interludeNode, "промежуточного блока нет на дереве между порциями");
  const visible = kit.visibleText(app.tree());
  assert.ok(visible.includes(expectedInterlude.heading), "заголовок промежуточного блока не с контента");
  assert.ok(
    expectedInterlude.paragraphs[0] !== undefined && visible.includes(expectedInterlude.paragraphs[0]),
    "текст промежуточного блока не дошёл до страницы",
  );
  assert.equal(current().blocks.some((block) => block.id === REPORT(WORK)), false, "отчёт работы показан между порциями");

  const order = blockOrder(app.tree(), kit);
  const interludeAt = order.indexOf(INTERLUDE(WORK));
  assert.ok(interludeAt >= 0);
  assert.equal(order.includes(REPORT(WORK)), false);

  const second = await answerSlicePortion(WORK);
  assert.equal(second.key, `slice:${WORK}:2`);
  assert.equal(isSlicePortion(current().nextPortion?.key), false, "после двух порций остался добор");
  assert.equal(
    kit.byClass(app.tree(), "block").some((node) => node.attrs["data-block"] === INTERLUDE(WORK)),
    false,
    "промежуточный блок остался после последней порции — он должен стоять только между ними",
  );

  await assertSliceReport(WORK);
  assert.ok(blockOrder(app.tree(), kit).includes(REPORT(NODE)), "блок узлового среза пропал после работы");
});
