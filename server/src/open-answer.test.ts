/**
 * Порог открытого ответа лестницы на стороне сервера (E3-12).
 *
 * Порог записан в `content/questions-ladder.md` и до этой задачи жил только в
 * интерфейсе: движок на коротком ответе молча не собирал сюжет, а сервер такой
 * ответ сохранял. Страница оставалась без блока ступени 4, без предложения и без
 * следующей порции — состояние, из которого человеку некуда нажать.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { countWords, openMinWords, rawContent } from "./engine.js";
import { answersForStep, call, portionKey, profileAtStep, startTestServer } from "./test-support.js";
import type { AnswerInput, ErrorDto, PageStateDto } from "./contract/index.js";

const openQuestion = rawContent.questions.find((question) => question.type === "открытый");

const shortAnswers = (): AnswerInput[] =>
  answersForStep(4).map((answer) =>
    answer.kind === "открытый" ? { ...answer, text: "Всё повторяется." } : answer,
  );

test("порог открытого ответа читается из контента, а не зашит в код", () => {
  assert.ok(openQuestion, "на лестнице нет открытого вопроса");
  assert.ok(openMinWords() > 1, "порог не разобран из content/questions-ladder.md");
  assert.equal(countWords("Всё повторяется."), 2);
  assert.ok(countWords("Всё повторяется.") < openMinWords());
});

test("короткий открытый ответ порцией отбивается и ничего не сохраняет", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);
  const rejected = await call<ErrorDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
    portion: portionKey(4),
    answers: shortAnswers(),
    requestId: "short-1",
  });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, "answer_too_short");

  const after = await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`);
  assert.equal(after.body.state, "s3", "короткий ответ не должен двигать состояние страницы");
  assert.ok(after.body.nextPortion, "человеку осталось куда отвечать");
});

test("короткий открытый ответ правкой отбивается, прежний ответ остаётся", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  assert.ok(openQuestion);
  const questionId = openQuestion.id;

  const rejected = await call<ErrorDto>(server.origin, "PATCH", `/api/p/${page.profileId}/answers/${questionId}`, {
    answer: { questionId, kind: "открытый", text: "Коротко и всё." },
  });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, "answer_too_short");

  const exported = await call<{ answers: { questionId: string; answer: string }[] }>(
    server.origin,
    "GET",
    `/api/p/${page.profileId}/export`,
  );
  const stored = exported.body.answers.find((answer) => answer.questionId === questionId);
  assert.ok(stored, "открытый ответ пропал из выгрузки");
  assert.ok(countWords(stored.answer) >= openMinWords(), "в базе остался короткий ответ");
});

test("после длинного открытого ответа страница не оказывается в тупике", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  assert.equal(page.state, "s4");
  assert.equal(page.nextPortion, null, "порций на лестнице больше нет");
  assert.ok(
    page.blocks.some((block) => block.generation !== null) || page.offer !== null,
    "на ступени 4 должен быть либо идущий сюжет, либо предложение",
  );
});
