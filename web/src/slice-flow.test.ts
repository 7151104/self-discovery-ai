/**
 * Приёмка E7-10 и E7-11: доборы среза, промежуточный блок, уточняющие,
 * платный блок, карта и следующее предложение.
 *
 * Состав и отказ оплаты по-прежнему приходят полями предложения. Здесь —
 * живой сервер и сессия вкладки после настоящей оплаты (заказ + webhook).
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findAll, visibleText } from "./dom.js";
import { byClass } from "./test-support.js";
import { createPageApp, type AppHost } from "./app.js";
import { copy } from "./copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";
import type { AnswerInput, PageStateDto, PortionDto } from "./contract.js";

const { startTestServer, call, purchaseSlice, answersForPortion, profileAtPaidState, deliverPaidReady, profileAtDemo } =
  (await import(
    pathToFileURL(join(repoRoot, "server/dist/test-support.js")).href
  )) as typeof import("../../server/dist/test-support.js");

const engine = (await import(
  pathToFileURL(join(repoRoot, "engine/dist/index.js")).href
)) as typeof import("../../engine/dist/index.js");

const { sliceAnswers } = (await import(
  pathToFileURL(join(repoRoot, "engine/dist/slice-fixtures.js")).href
)) as typeof import("../../engine/dist/slice-fixtures.js");

const reducedMotion = (): MotionHost => ({
  matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION_QUERY }),
  setTimeout: (handler) => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
});

const hostOf = (origin: string, pathname: string): AppHost => {
  const location = { pathname };
  return {
    location,
    origin,
    fetch,
    history: {
      pushState: (_data, _title, url) => {
        location.pathname = new URL(String(url), origin).pathname;
      },
    },
    motion: reducedMotion(),
  };
};

async function openPage(origin: string, profileId: string) {
  const app = createPageApp(hostOf(origin, `/p/${profileId}`));
  await app.start();
  return app;
}

const localId = (slice: string, questionId: string): string =>
  questionId.startsWith(`${slice}:`) ? questionId.slice(slice.length + 1) : questionId;

const asSliceInput = (slice: string, portion: PortionDto, answers: ReturnType<typeof sliceAnswers>): AnswerInput[] =>
  portion.questions.map((question): AnswerInput => {
    const value = answers[localId(slice, question.id)];
    if (question.kind === "выбор") {
      return { questionId: question.id, kind: "выбор", option: String(value ?? question.options[0]?.key) };
    }
    if (question.kind === "шкала") {
      return { questionId: question.id, kind: "шкала", scale: Number(value ?? 4) as 1 | 2 | 3 | 4 | 5 };
    }
    if (question.kind === "число") {
      const numbers = Array.isArray(value) ? value : typeof value === "number" ? [value] : [5, 2];
      return { questionId: question.id, kind: "число", numbers };
    }
    return { questionId: question.id, kind: "открытый", text: String(value ?? "") };
  });

const sliceAnswersFromPortion = (slice: string, portion: PortionDto) =>
  Object.fromEntries(
    answersForPortion(portion).map((answer) => {
      const id = localId(slice, answer.questionId);
      if (answer.kind === "выбор") return [id, answer.option];
      if (answer.kind === "шкала") return [id, answer.scale];
      if (answer.kind === "число") return [id, answer.numbers];
      return [id, answer.text];
    }),
  );

async function answerSliceWith(
  origin: string,
  profileId: string,
  slice: string,
  answers: ReturnType<typeof sliceAnswers>,
): Promise<PageStateDto> {
  let page = (await call<PageStateDto>(origin, "GET", `/api/p/${profileId}`)).body;
  for (let guard = 0; guard < 5; guard += 1) {
    const portion = page.nextPortion;
    if (!portion || !portion.key.startsWith("slice:")) break;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${profileId}/portions`, {
      portion: portion.key,
      answers: asSliceInput(slice, portion, answers),
      requestId: `slice-flow-${portion.key}`,
    });
    page = reply.body;
  }
  return page;
}

test("сразу после оплаты на экране вопросы, а не отчёт и не предложение", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const paid = await purchaseSlice(server.origin);
  const app = await openPage(server.origin, paid.page.profileId);
  t.after(() => app.stop());

  assert.equal(app.session().page?.state, "paid_pending");
  assert.ok(app.session().page?.nextPortion?.key.startsWith("slice:"));
  assert.equal(byClass(app.tree(), "portion").length, 1);
  assert.equal(byClass(app.tree(), "offer").length, 0);
  assert.equal(byClass(app.tree(), "wait").length, 0);
  assert.equal(
    byClass(app.tree(), "block").some((item) => item.attrs["data-block"] === `slice:${paid.slice}`),
    false,
    "отчёт среза показан до ответов",
  );
});

test("прикладной срез: между порциями промежуточный блок и вторая порция", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const paid = await purchaseSlice(server.origin, "slice_work");
  const first = paid.page.nextPortion;
  assert.ok(first);
  assert.equal(first.key, "slice:slice_work:1");

  await call<PageStateDto>(server.origin, "POST", `/api/p/${paid.page.profileId}/portions`, {
    portion: first.key,
    answers: answersForPortion(first),
    requestId: "slice-work-1",
  });

  const fromEngine = engine.buildSliceInterludeBlock("slice_work", sliceAnswersFromPortion("slice_work", first));
  assert.ok(fromEngine, "движок не собрал промежуточный блок на ответах первой порции");

  const app = await openPage(server.origin, paid.page.profileId);
  t.after(() => app.stop());
  const interlude = byClass(app.tree(), "block").find(
    (item) => item.attrs["data-block"] === "slice:slice_work:interlude",
  );
  assert.ok(interlude, "промежуточного блока нет на экране");
  const text = visibleText(app.tree());
  assert.ok(text.includes(fromEngine.heading));
  assert.ok(text.includes(fromEngine.paragraphs[0]!));
  assert.equal(findAll(interlude, "button").length, 0, "у промежуточного блока не должно быть действий");
  assert.equal(app.session().page?.nextPortion?.key, "slice:slice_work:2");
  assert.equal(byClass(app.tree(), "portion").length, 1);
  assert.equal(byClass(app.tree(), "offer").length, 0);
});

test("непройденный порог даёт уточняющие вопросы, а не отчёт", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const paid = await purchaseSlice(server.origin, "slice_node_finish");
  const weak = { ...sliceAnswers("slice_node_finish"), S8: "мало слов", S9: "D" };
  await answerSliceWith(server.origin, paid.page.profileId, "slice_node_finish", weak);

  const app = await openPage(server.origin, paid.page.profileId);
  t.after(() => app.stop());
  const page = app.session().page;
  assert.ok(page?.clarifications);
  assert.equal(page.clarifications?.slice, "slice_node_finish");
  assert.ok((page.clarifications?.questions.length ?? 0) > 0);

  assert.equal(byClass(app.tree(), "wait").length, 0, "ожидание вместо уточняющих");
  assert.equal(byClass(app.tree(), "offer").length, 0);
  assert.equal(byClass(app.tree(), "portion").length, 0);
  const report = byClass(app.tree(), "block").find(
    (item) => item.attrs["data-block"] === "slice:slice_node_finish",
  );
  assert.equal(report, undefined, "показан отчёт при непройденном пороге");

  const section = findAll(app.tree(), "section").find((item) => item.attrs["data-clarifications"]);
  assert.ok(section, "блока уточняющих нет");
  const text = visibleText(app.tree());
  assert.ok(text.includes(copy("UI_PAY_QUESTIONS", { вопросов: String(page.clarifications!.questions.length) })));
  for (const question of page.clarifications!.questions) {
    assert.ok(text.includes(question), "текст уточняющего не с сервера");
  }
});

test("после закрытия среза ровно одно следующее предложение и купленный блок", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const ladder = await profileAtDemo(server.origin);
  const paid = await purchaseSlice(server.origin, "slice_node_finish", ladder);
  const mapBefore = paid.page.map.map((bar) => ({ id: bar.id, fill: bar.fill, position: bar.position }));
  await answerSliceWith(server.origin, paid.page.profileId, paid.slice, sliceAnswers(paid.slice));
  deliverPaidReady(server.db, paid.page.profileId, paid.slice);
  const page = (await call<PageStateDto>(server.origin, "GET", `/api/p/${paid.page.profileId}`)).body;
  const app = await openPage(server.origin, page.profileId);
  t.after(() => app.stop());

  assert.equal(byClass(app.tree(), "offer").length, 1, "следующих предложений больше одного или нет вовсе");
  assert.ok(page.offer, "предложения после среза нет");
  const priced = page.doors.filter((door) => door.price !== null);
  assert.equal(priced.length, 1);
  assert.equal(priced[0]?.slice, page.offer.slice);

  const purchased = byClass(app.tree(), "block").find((item) => {
    const id = String(item.attrs["data-block"] ?? "");
    return id.startsWith("slice:") && !id.includes(":interlude");
  });
  assert.ok(purchased);
  assert.equal(purchased.attrs["data-state"], "purchased");

  const mapAfter = page.map.map((bar) => ({ id: bar.id, fill: bar.fill, position: bar.position }));
  assert.notDeepEqual(mapAfter, mapBefore, "карта не изменилась после добора");
});

test("купленный блок не переписывается при правке ответа: отметка расхождения", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtPaidState(server.origin, server.db, { delivered: true });
  const slot = page.blocks.find((block) => block.purchased && block.id.startsWith("slice:") && !block.id.includes(":interlude"));
  assert.ok(slot);
  const paragraphs = slot.paragraphs.slice();

  await call(server.origin, "PATCH", `/api/p/${page.profileId}/answers/L1`, {
    answer: { questionId: "L1", kind: "выбор", option: "B" },
  });

  const app = await openPage(server.origin, page.profileId);
  t.after(() => app.stop());
  const after = app.session().page;
  assert.ok(after);
  const kept = after.blocks.find((block) => block.id === slot.id);
  assert.ok(kept);
  assert.equal(kept.purchased, true);
  assert.equal(kept.stale, true);
  assert.deepEqual(kept.paragraphs, paragraphs);
  const node = byClass(app.tree(), "block").find((item) => item.attrs["data-block"] === slot.id);
  assert.ok(node);
  assert.ok(visibleText(node).includes(copy("UI_EDGE_PAID_DIVERGED")));
});
