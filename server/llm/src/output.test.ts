/**
 * E4-07: машинный выход и сюжет для координаты 15.
 *
 * Главное требование задачи: невалидный машинный выход отклоняется, а не пишется
 * в профиль. Поэтому проверок формы много и они мелочные — это и есть та стена,
 * из-за которой в координату 15 не попадает мусор.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GOOD_STATEMENTS, GOOD_STORYLINE, GOOD_TEXT, demoTask, envelope } from "./fixtures.js";
import { describeProblem, outputContractText, parseModelOutput } from "./output.js";

const task = demoTask();
const known = Object.values(task.input.profile.coordinates)
  .filter((coordinate) => coordinate.sources.length > 0)
  .map((coordinate) => coordinate.id);

const parse = (raw: string) => parseModelOutput(raw, { knownCoordinates: known });

const problemKinds = (raw: string): string[] => {
  const parsed = parse(raw);
  assert.equal(parsed.ok, false, `ожидался отказ, а выход принят: ${raw.slice(0, 80)}`);
  return parsed.ok ? [] : parsed.problems.map((problem) => problem.kind);
};

test("хороший конверт разбирается: текст, разметка, сюжет", () => {
  const parsed = parse(envelope());
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.problems.map(describeProblem).join("; "));
  if (!parsed.ok) return;

  assert.equal(parsed.output.text, GOOD_TEXT);
  assert.equal(parsed.output.statements.length, GOOD_STATEMENTS.length);
  assert.deepEqual(parsed.output.storyline, GOOD_STORYLINE);
});

test("конверт в блоке кода тоже разбирается: модель любит его обрамлять", () => {
  const parsed = parse(`\`\`\`json\n${envelope()}\n\`\`\``);
  assert.ok(parsed.ok);
});

test("не JSON отклоняется, а не разбирается как текст блока", () => {
  assert.deepEqual(problemKinds("Твой повторяющийся сюжет: ты берёшь слишком много."), ["не json"]);
  assert.deepEqual(problemKinds("[1, 2, 3]"), ["не json"]);
});

test("сюжет проверяется по форме: значение, код и уверенность", () => {
  assert.ok(problemKinds(envelope({ storyline: null })).includes("нет поля"));
  assert.ok(problemKinds(envelope({ storyline: { value: "" } })).includes("сюжет"));
  assert.ok(problemKinds(envelope({ storyline: { value: "х".repeat(200) } })).includes("сюжет"));
  assert.ok(problemKinds(envelope({ storyline: { code: "Сюжет С Пробелами" } })).includes("сюжет"));
  assert.ok(problemKinds(envelope({ storyline: { code: "ab" } })).includes("сюжет"));
  assert.ok(problemKinds(envelope({ storyline: { confidence: "средняя" } })).includes("сюжет"));
});

test("координата называется только из профиля и только там, где положено", () => {
  const unknown = envelope({
    statements: GOOD_STATEMENTS.map((statement, index) => (index === 1 ? { ...statement, coordinate: 16 } : statement)),
  });
  assert.ok(problemKinds(unknown).includes("лишняя координата"), "координата 16 у демо-человека пуста");

  const missing = envelope({
    statements: GOOD_STATEMENTS.map((statement, index) => (index === 1 ? { ...statement, coordinate: null } : statement)),
  });
  assert.ok(problemKinds(missing).includes("нет координаты"), "утверждение обязано называть координату");

  const extra = envelope({
    statements: GOOD_STATEMENTS.map((statement) =>
      statement.kind === "цитата" ? { ...statement, coordinate: 11 } : statement,
    ),
  });
  assert.ok(problemKinds(extra).includes("лишняя координата"), "у цитаты координаты быть не может");
});

test("разметка не может лгать о тексте", () => {
  const invented = envelope({
    statements: [...GOOD_STATEMENTS, { phrase: "Этой фразы в тексте нет.", kind: "утверждение", coordinate: 11 }],
  });
  assert.ok(problemKinds(invented).includes("фразы нет в тексте"));

  const uncovered = envelope({ statements: GOOD_STATEMENTS.slice(0, 3) });
  assert.ok(problemKinds(uncovered).includes("предложение без разметки"), "неразмеченное предложение — лазейка");
});

test("неизвестный вид, пустой текст и лишнее поле отклоняются", () => {
  assert.ok(
    problemKinds(
      envelope({
        statements: GOOD_STATEMENTS.map((statement, index) =>
          index === 1 ? { ...statement, kind: "догадка" as never } : statement,
        ),
      }),
    ).includes("неизвестный вид"),
  );
  assert.ok(problemKinds(envelope({ text: "   " })).includes("пустой текст"));
  assert.ok(problemKinds(envelope({ extra: { профиль: "весь" } })).includes("лишнее поле"));
});

test("контракт для промпта собирается из тех же имён полей, что и разбор", () => {
  const contract = outputContractText(known);
  for (const field of ["текст", "утверждения", "фраза", "вид", "координата", "сюжет", "значение", "код", "уверенность"]) {
    assert.ok(contract.includes(field), `в контракте нет поля «${field}»`);
  }
  for (const kind of ["утверждение", "вероятность", "вопрос", "цитата", "неизвестное"]) {
    assert.ok(contract.includes(kind), `в контракте нет вида «${kind}»`);
  }
  assert.ok(contract.includes(known.join(", ")), "модель обязана знать список доступных координат");
});
