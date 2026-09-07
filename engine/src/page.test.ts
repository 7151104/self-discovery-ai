/** Сборка страницы по ступеням: что видно, что закрыто, когда появляется оффер. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPage, buildStep0Card, completedStep, portionForStep } from "./index.js";
import type { LadderAnswers } from "./types.js";

const person = { name: "Артём", birthDate: "1994-03-12" };

const step1: LadderAnswers = { L1: "B", L2: "C", L3: "A" };
const step2: LadderAnswers = { ...step1, L4: "B", L5: "D", L6: 5, L7: 2 };
const step3: LadderAnswers = { ...step2, L8: "A", L9: 5, L10: 4, L11: 4 };
const step4: LadderAnswers = {
  ...step3,
  L12: "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша, потом злюсь на себя.",
};

test("карточка входа не содержит выводов о личности и живёт без даты", () => {
  const withDate = buildStep0Card(person, new Date("2026-10-14"));
  assert.equal(withDate.season, "Осень");
  assert.equal(withDate.theme, "Завершение и отбор");
  assert.ok(withDate.metaphor && withDate.metaphor.length > 40);

  const withoutDate = buildStep0Card({ name: "Артём" });
  assert.equal(withoutDate.theme, null);
  assert.equal(withoutDate.metaphor, null);
  assert.equal(withoutDate.cta, withDate.cta);
});

test("ступень считается пройденной только целиком", () => {
  assert.equal(completedStep({}), 0);
  assert.equal(completedStep({ L1: "B", L2: "C" }), 0);
  assert.equal(completedStep(step1), 1);
  assert.equal(completedStep(step2), 2);
  assert.equal(completedStep(step3), 3);
  assert.equal(completedStep(step4), 4);
});

test("порции идут по 3 и 4 вопроса и несут подводку", () => {
  assert.equal(portionForStep(1)?.questions.length, 3);
  assert.equal(portionForStep(2)?.questions.length, 4);
  assert.equal(portionForStep(3)?.questions.length, 4);
  assert.equal(portionForStep(4)?.questions.length, 1);
  assert.ok((portionForStep(2)?.lead ?? "").length > 10);
});

test("ступени 1–3 собираются без LLM и без предложения купить", () => {
  for (const answers of [step1, step2, step3]) {
    const page = buildPage(person, answers);
    assert.ok(page.blocks.every((block) => block.source === "lookup"), "на ступенях 1–3 не должно быть LLM-блоков");
    assert.equal(page.llmTask, null);
    assert.equal(page.offer, null, "платное предложение появляется только после ступени 4");
    assert.ok(page.nextPortion, "должна быть следующая порция");
  }
});

test("страница растёт по ступеням, карта заполняется постепенно", () => {
  const filled = (answers: LadderAnswers): number =>
    buildPage(person, answers).map.filter((bar) => bar.state !== "empty").length;

  assert.equal(buildPage(person, {}).blocks.length, 0);
  assert.equal(filled({}), 0);
  assert.equal(buildPage(person, step1).blocks.length, 1);
  assert.equal(filled(step1), 3);
  assert.equal(buildPage(person, step2).blocks.length, 2);
  assert.equal(filled(step2), 5);
  assert.equal(buildPage(person, step3).blocks.length, 3);
  assert.equal(filled(step3), 7);
});

test("ступень 1 даёт три абзаца и фразу-сшивку из матрицы", () => {
  const block = buildPage(person, step1).blocks[0]!;
  assert.equal(block.paragraphs.length, 3);
  assert.ok(block.highlight?.startsWith("Ты тащишь один"), "пара B×C при L3=A должна выбрать самую точную строку");
});

test("ступень 2 добавляет цену силы", () => {
  const block = buildPage(person, step2).blocks[1]!;
  assert.equal(block.paragraphs.length, 4);
  assert.ok(block.highlight?.includes("возможности раньше других"));
});

test("ступень 3 показывает ровно один узел, остальные становятся дверями", () => {
  const page = buildPage(person, step3);
  const block = page.blocks[2]!;
  assert.equal(block.paragraphs.length, 1);

  const paidDoors = page.doors.filter((door) => door.state === "paid");
  assert.ok(paidDoors.length >= 3, "несработавшие узлы должны стать закрытыми дверями");
  assert.ok(paidDoors.every((door) => door.price === null), "до оффера цены не показываем");
  assert.ok(page.doors.some((door) => door.state === "opens_with_answers"), "хотя бы одна дверь открывается ответами");
});

test("после ступени 4 появляется одно платное предложение с ценой", () => {
  const page = buildPage(person, step4);

  assert.ok(page.llmTask, "ступень 4 отдаёт задание LLM, а не готовый текст");
  assert.equal(page.llmTask?.input.node?.id, "NODE_FINISH_FEAR");
  assert.equal(page.offer?.slice, "slice_node_finish");
  assert.equal(page.offer?.price, 590);

  const priced = page.doors.filter((door) => door.price !== null);
  assert.equal(priced.length, 1, "на первом шаге оплаты видна одна цена");
  assert.equal(page.nextPortion, null);
});

test("короткий открытый ответ не даёт ни блока, ни оффера", () => {
  const page = buildPage(person, { ...step3, L12: "Всё повторяется." });
  assert.equal(page.llmTask, null);
  assert.equal(page.offer, null);
  assert.ok(page.blocks.every((block) => block.step !== 4));
});

test("на клиент уходят блоки и полосы, значения координат наружу не идут", () => {
  const page = buildPage(person, step3);
  for (const bar of page.map) {
    assert.ok(!("value" in bar), "полоса не должна нести значение координаты");
    assert.ok(bar.position === null || (bar.position >= 0 && bar.position <= 1));
  }
  const serialized = JSON.stringify(page.map) + JSON.stringify(page.blocks);
  assert.ok(!serialized.includes("confidence"), "confidence — внутреннее поле");
  assert.ok(!serialized.includes("at_80"), "машинные коды координат наружу не выводятся");
});
