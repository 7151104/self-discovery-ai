/**
 * Порция вопросов (E6-12).
 *
 * Приёмка: один вопрос на экране, прогресс только внутри порции, у типа
 * «выбор» нет кнопки «дальше», «назад» есть со второго вопроса, все четыре
 * типа вопроса собираются. Общее число вопросов лестницы на карточке
 * заявить нечем: печатать его некуда.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { numberFields, PORTION_KIND, renderPortion, type PortionLabels, type PortionProps } from "./portion.js";
import { SUBMIT_FROM_WORDS } from "./open-field.js";
import { findAll, renderToString, visibleText } from "../src/dom.js";
import { portionTexts } from "../src/page-copy.js";
import * as mock from "../showcase/mocks.js";

const labels = (lead = mock.choiceQuestion.label): PortionLabels => ({
  lead,
  progress: portionTexts.progress(0, 4),
  back: portionTexts.back(),
  scaleMarks: [
    portionTexts.scaleMark(1),
    portionTexts.scaleMark(2),
    portionTexts.scaleMark(3),
    portionTexts.scaleMark(4),
    portionTexts.scaleMark(5),
  ],
  scaleHint: portionTexts.scaleHint(),
  openHint: portionTexts.openTooShort(),
  openSubmit: portionTexts.openSubmit(),
  counterText: (state) => portionTexts.counter(state, SUBMIT_FROM_WORDS),
});

const choiceQuestion = {
  id: "Q1",
  kind: "выбор" as const,
  text: mock.choiceQuestion.label,
  options: mock.choiceQuestion.options.map((option) => ({ key: option.value, text: option.text })),
  scale: null,
};

const scaleQuestion = {
  id: "Q2",
  kind: "шкала" as const,
  text: mock.scaleQuestion.label,
  options: [],
  scale: mock.scaleQuestion.poles,
};

const openQuestion = {
  id: "L12",
  kind: "открытый" as const,
  text: mock.openQuestion.label,
  options: [],
  scale: null,
};

const portion = (overrides: Partial<PortionProps> = {}) =>
  renderPortion({
    id: "step:1",
    question: choiceQuestion,
    index: 0,
    total: 3,
    labels: labels(mock.portionLead),
    ...overrides,
  });

test("на экране один вопрос, а не список из порции", () => {
  const node = portion({ total: 4 });
  assert.equal(findAll(node, "input").filter((item) => item.attrs["type"] === "radio").length, choiceQuestion.options.length);
  assert.equal(visibleText(node).includes(choiceQuestion.text), true);
  for (const other of ["Q2", "Q3", "Q4"]) {
    assert.equal(renderToString(node).includes(other), false, `на карточке просочился ${other}`);
  }
});

test("прогресс только внутри порции: точек столько, сколько вопросов в ней", () => {
  const node = portion({ index: 1, total: 4, labels: { ...labels(), progress: portionTexts.progress(1, 4) } });
  const dots = findAll(node, "span").filter((item) => item.attrs["class"] === "portion__dot");
  assert.equal(dots.length, 4);
  assert.equal(dots.filter((item) => item.attrs["data-state"] === "done").length, 1);
  assert.equal(dots.filter((item) => item.attrs["data-state"] === "current").length, 1);

  const text = visibleText(node);
  assert.equal(/вопрос\s+\d+\s+из\s+\d+/i.test(text), false, "числа прогресса видны человеку, а не только скринридеру");
});

test("у типа «выбор» нет кнопки «дальше»: выбор и есть переход", () => {
  const node = portion();
  const buttons = findAll(node, "button");
  assert.equal(buttons.length, 0);
  assert.equal(node.attrs["data-kind"], PORTION_KIND["выбор"]);
});

test("назад нет на первом вопросе и есть на каждом следующем", () => {
  const first = portion({ index: 0 });
  assert.equal(findAll(first, "button").length, 0);

  const next = portion({ index: 1, total: 3 });
  const buttons = findAll(next, "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]?.attrs["class"], "portion__back");
  assert.ok(visibleText(next).includes(portionTexts.back()));
});

test("шкала собирается группой радиокнопок с подписями полюсов", () => {
  const node = portion({ question: scaleQuestion });
  assert.equal(node.attrs["data-kind"], PORTION_KIND["шкала"]);
  const group = findAll(node, "fieldset")[0];
  assert.equal(group?.attrs["role"], "radiogroup");
  const text = visibleText(node);
  assert.ok(text.includes(mock.scaleQuestion.poles.low));
  assert.ok(text.includes(mock.scaleQuestion.poles.high));
});

test("открытый вопрос несёт порог пятнадцати слов и подсказку, которая не исчезает", () => {
  const short = portion({ question: openQuestion, value: mock.openQuestion.short });
  assert.equal(nodeKind(short), PORTION_KIND["открытый"]);
  const submit = findAll(short, "button").find((item) => item.attrs["class"] === "field__submit");
  assert.equal(submit?.attrs["disabled"], true);
  assert.ok(visibleText(short).includes(portionTexts.openTooShort()));

  const ready = portion({ question: openQuestion, value: mock.openQuestion.long });
  const readySubmit = findAll(ready, "button").find((item) => item.attrs["class"] === "field__submit");
  assert.equal(Boolean(readySubmit?.attrs["disabled"]), false);
});

test("числовой вопрос с двумя величинами даёт два поля, подписи — из options", () => {
  const question = mock.numberQuestion;
  assert.equal(numberFields(question).length, 2);
  const node = portion({ question, value: "4,1" });
  assert.equal(node.attrs["data-kind"], PORTION_KIND["число"]);
  const inputs = findAll(node, "input").filter((item) => item.attrs["class"] === "portion__number-input");
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0]?.attrs["value"], "4");
  assert.equal(inputs[1]?.attrs["value"], "1");
  const text = visibleText(node);
  for (const option of question.options) assert.ok(text.includes(option.text), `нет подписи «${option.text}»`);
});

test("числовой вопрос без options — одно поле с текстом вопроса", () => {
  const question = { id: "S5", kind: "число" as const, text: "Сколько раз за месяц ты соглашался?", options: [], scale: null };
  assert.equal(numberFields(question).length, 1);
  const node = portion({ question });
  assert.equal(findAll(node, "input").filter((item) => item.attrs["class"] === "portion__number-input").length, 1);
});

test("числовой вопрос несёт кнопку отправки, пока поля не заполнены — она выключена", () => {
  const question = { id: "S10", kind: "число" as const, text: "T", options: [], scale: null };
  const empty = portion({ question });
  const submit = findAll(empty, "button").find((item) => item.attrs["class"] === "portion__submit");
  assert.ok(submit);
  assert.equal(submit.attrs["disabled"], true);

  const ready = portion({ question, value: "8" });
  const readySubmit = findAll(ready, "button").find((item) => item.attrs["class"] === "portion__submit");
  assert.equal(Boolean(readySubmit?.attrs["disabled"]), false);
  assert.ok(visibleText(ready).includes(portionTexts.openSubmit()));
});

test("на порции добора открытый ответ можно отправить с одного слова", () => {
  const short = portion({
    id: "slice:slice_node_finish:1",
    question: openQuestion,
    value: "слово",
    labels: { ...labels(), submitFromWords: 1 },
  });
  const submit = findAll(short, "button").find((item) => item.attrs["class"] === "field__submit");
  assert.equal(Boolean(submit?.attrs["disabled"]), false);
});

test("общее число вопросов лестницы на карточке заявить нечем", () => {
  const markup = renderToString(portion({ total: 3 }));
  assert.equal(markup.includes("из 12"), false);
  assert.equal(markup.includes("8 из"), false);
  assert.equal(markup.includes("вопрос 8"), false);
});

function nodeKind(node: ReturnType<typeof portion>): string {
  return String(node.attrs["data-kind"]);
}
