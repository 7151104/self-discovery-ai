/**
 * Курсор порции и пауза «собираю»: без сервера, на состоянии страницы.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { pageStates } from "../showcase/page-states.js";
import {
  acceptAnswer,
  choiceAnswer,
  declineOffer,
  emptySession,
  firstUnanswered,
  goBack,
  markPaymentFailed,
  portionComplete,
  portionRequest,
  replacePage,
  setDisagreeing,
  showPage,
} from "./session.js";

const s0 = () => showPage(emptySession(), pageStates.s0, "load");

test("курсор стоит на первом неотвеченном вопросе порции", () => {
  const session = s0();
  assert.equal(session.questionIndex, 0);
  assert.equal(firstUnanswered(pageStates.s0), 0);
});

test("выбор двигает курсор без кнопки «далее»", () => {
  const session = s0();
  const question = pageStates.s0.nextPortion?.questions[0];
  assert.ok(question);
  const next = acceptAnswer(session, choiceAnswer(question, question.options[0]?.key ?? "A")!);
  assert.equal(next.collecting, false);
  assert.equal(next.questionIndex, 1);
  assert.equal(next.answers.length, 1);
});

test("назад возвращает к предыдущему вопросу порции", () => {
  const session = s0();
  const first = pageStates.s0.nextPortion?.questions[0];
  assert.ok(first);
  const answered = acceptAnswer(session, choiceAnswer(first, first.options[0]?.key ?? "A")!);
  const back = goBack(answered);
  assert.equal(back.questionIndex, 0);
  assert.equal(back.answers.length, 1);
});

test("последний ответ порции включает паузу «собираю»", () => {
  let session = s0();
  const portion = pageStates.s0.nextPortion;
  assert.ok(portion);
  for (const question of portion.questions) {
    const input = choiceAnswer(question, question.options[0]?.key ?? "A") ?? {
      questionId: question.id,
      kind: "шкала" as const,
      scale: 4 as const,
    };
    session = acceptAnswer(session, input);
  }
  assert.equal(portionComplete(session.page!, session.answers), true);
  assert.equal(session.collecting, true);
  const payload = portionRequest(session, "req-1");
  assert.equal(payload?.portion, "step:1");
  assert.equal(payload?.answers.length, portion.questions.length);
});

test("возврат на порцию с сохранёнными ответами ставит returned", () => {
  const portion = pageStates.s1.nextPortion;
  assert.ok(portion);
  const first = portion.questions[0];
  assert.ok(first);
  const page = { ...pageStates.s1, nextPortion: { ...portion, answered: [first.id] } };
  const session = showPage(emptySession(), page, "load");
  assert.equal(session.returned, true);
  assert.equal(session.questionIndex, 1);
});

test("перезагрузка во время сборки ставит waitResumed и не считает ожидание увиденным блоком", () => {
  const session = showPage(emptySession(), pageStates.s4Waiting, "load");
  assert.equal(session.waitResumed, true);
  assert.equal(session.seenBlocks.has("step4"), false);
});

test("несогласие не сбрасывает курсор порции", () => {
  const session = { ...s0(), questionIndex: 2 };
  const next = replacePage(setDisagreeing(session, "step1"), pageStates.s1);
  assert.equal(next.questionIndex, 2);
  assert.equal(next.disagreeing, null);
  assert.equal(next.page, pageStates.s1);
});

test("отказ от оплаты запоминается на визит", () => {
  const session = showPage(emptySession(), pageStates.s4, "load");
  const declined = declineOffer(session);
  assert.equal(declined.offerDeclined, true);
  assert.equal(markPaymentFailed(session).paymentFailed, true);
});
