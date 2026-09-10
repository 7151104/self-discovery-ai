/**
 * E4-05: соответствие регистров речи и confidence координат.
 *
 * Риск задачи — неоднозначность: сопоставить фразу с координатой по смыслу нельзя.
 * Решение — структурированный выход: координату называет модель, а слой проверяет,
 * что названная фраза в тексте есть, что координата в профиле заполнена и что
 * регистр ей разрешён. Проверка держится на этом, а не на разборе смысла.
 *
 * У демо-человека координата 11 имеет confidence high, координаты 2, 3, 7, 8, 9 —
 * medium, координаты 5 и 13 — low.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_HIGH, DEMO_LOW, DEMO_MEDIUM, GOOD_STATEMENTS, GOOD_TEXT, demoTask } from "./fixtures.js";
import { registerMarkers } from "./content.js";
import { checkRegisters, describeRegisterProblem, type RegisterProblem } from "./registers.js";
import type { ModelOutput, Statement, StatementKind } from "./output.js";

const task = demoTask();

const check = { profile: task.input.profile, openAnswer: task.input.openAnswer };

const outputWith = (statements: Statement[], text = GOOD_TEXT): ModelOutput => ({
  text,
  statements,
  storyline: { value: "сюжет", code: "code_here", confidence: "medium" },
  periodTask: null,
});

const one = (phrase: string, kind: StatementKind, coordinate: number | null): RegisterProblem[] =>
  checkRegisters(outputWith([{ phrase, kind, coordinate }], `${phrase}\n\nвторой абзац.\n\nтретий абзац.`), check);

test("хороший выход по регистрам проходит целиком", () => {
  assert.deepEqual(checkRegisters(outputWith(GOOD_STATEMENTS), check).map(describeRegisterProblem), []);
});

test("утверждение при low отклоняется, тот же смысл вопросом принимается", () => {
  const claim = "Ты оставляешь дело открытым, потому что незакрытое ещё нельзя потерять.";
  const question = "Ты оставляешь дело открытым потому, что незакрытое ещё нельзя потерять?";

  const rejected = one(claim, "утверждение", DEMO_LOW);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.kind, "регистр сильнее confidence");
  assert.match(rejected[0]!.detail, /low/);

  assert.deepEqual(one(question, "вопрос", DEMO_LOW), [], "тот же смысл в форме вопроса законен");
});

test("вероятность при low тоже отклоняется: при low законен только вопрос", () => {
  const phrase = "Скорее всего, ты держишь дело открытым до последнего.";
  const rejected = one(phrase, "вероятность", DEMO_LOW);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.kind, "регистр сильнее confidence");
});

test("утверждение при medium отклоняется, вероятность с оговоркой принимается", () => {
  const claim = "Под нагрузкой ты добавляешь себе объём.";
  assert.equal(one(claim, "утверждение", DEMO_MEDIUM)[0]!.kind, "регистр сильнее confidence");

  const hedged = "Скорее всего, под нагрузкой ты добавляешь себе объём.";
  assert.deepEqual(one(hedged, "вероятность", DEMO_MEDIUM), []);
});

test("утверждение при high законно", () => {
  assert.deepEqual(one("Ты рвёшься на восьмидесяти процентах.", "утверждение", DEMO_HIGH), []);
});

test("форма обязана соответствовать заявленному виду", () => {
  const notQuestion = one("Ты рвёшься у финиша.", "вопрос", DEMO_LOW);
  assert.equal(notQuestion[0]!.kind, "форма не соответствует виду");

  const questionAsClaim = one("Ты рвёшься у финиша?", "утверждение", DEMO_HIGH);
  assert.equal(questionAsClaim[0]!.kind, "форма не соответствует виду");

  const bareProbability = one("Под нагрузкой ты добавляешь себе объём.", "вероятность", DEMO_MEDIUM);
  assert.equal(bareProbability[0]!.kind, "форма не соответствует виду");
  assert.match(bareProbability[0]!.detail, /оговорки/);
});

test("маркеры регистров берутся из контента, а не из списка в коде", () => {
  const markers = registerMarkers();
  assert.ok(markers.medium.includes("скорее всего"));
  assert.ok(markers.medium.includes("проверь"));

  for (const marker of markers.medium) {
    const phrase = `${marker} под нагрузкой ты добавляешь себе объём.`;
    assert.deepEqual(
      one(phrase, "вероятность", DEMO_MEDIUM),
      [],
      `формулировка «${marker}» из реестра обязана опознаваться как вероятность`,
    );
  }
});

test("о пустой координате говорить нельзя вообще", () => {
  const problems = one("Ты рвёшься у финиша.", "утверждение", 1);
  assert.equal(problems[0]!.kind, "координата пуста");
});

test("цитата обязана быть из открытого ответа, а не сочинённой", () => {
  assert.deepEqual(one("Ты сказал: тащу всё сам, никого не подключаю.", "цитата", null), []);

  const invented = one("Ты сказал, что тебе просто скучно и хочется другого дела.", "цитата", null);
  assert.equal(invented[0]!.kind, "цитата не из ответа");
});

test("обрыв на неизвестном стоит последним абзацем", () => {
  const text = "Не знаю, когда это встало впервые.\n\nвторой абзац.\n\nтретий абзац.";
  const problems = checkRegisters(
    outputWith([{ phrase: "Не знаю, когда это встало впервые.", kind: "неизвестное", coordinate: null }], text),
    check,
  );
  assert.equal(problems[0]!.kind, "неизвестное не в последнем абзаце");
});
