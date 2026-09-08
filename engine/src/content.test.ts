/** Проверки целостности: код и content/*.md не должны разъезжаться. */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { NODE_RULES, FALLBACK_NODE_ID } from "./nodes.js";
import { BAR_DEFINITIONS } from "./map.js";
// Запрещённые формулировки живут в реестре content/forbidden.md (E5-01), не в регулярках.
import { scanTexts, describeHit } from "./forbidden.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("лестница даёт ровно 11 закрытых и 1 открытый вопрос", () => {
  assert.equal(rawContent.questions.length, 12);
  assert.equal(rawContent.questions.filter((question) => question.type === "открытый").length, 1);
  assert.deepEqual(
    rawContent.questions.map((question) => question.step),
    [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4],
  );
});

test("у каждого варианта ответа ступеней 1–2 есть готовый текст ветви", () => {
  for (const question of rawContent.questions) {
    if (question.type !== "выбор" || question.step > 2) continue;
    const branches = rawContent.step1.branches[question.id] ?? rawContent.step2.branches[question.id];
    assert.ok(branches, `нет ветвей для ${question.id}`);
    for (const option of question.options) {
      const text: string = branches?.[option.key]?.text ?? "";
      assert.ok(text.length > 0, `${question.id}: нет текста ветви ${option.key}`);
      assert.ok(text.length > 120, `${question.id}.${option.key}: текст подозрительно короткий`);
    }
  }
});

test("вопросы ступени 3 работают через движок противоречий, а не через ветви", () => {
  for (const question of rawContent.questions) {
    if (question.step !== 3) continue;
    assert.ok(
      !rawContent.step1.branches[question.id] && !rawContent.step2.branches[question.id],
      `${question.id}: у вопроса ступени 3 не должно быть готовых ветвей — он питает узлы`,
    );
  }
});

test("шкальные ветви покрывают все пять значений", () => {
  for (const [question, branches] of Object.entries(rawContent.step2.scales)) {
    for (const value of [1, 2, 3, 4, 5]) {
      const match = branches.find((branch) => value >= branch.from && value <= branch.to);
      assert.ok(match, `${question}: значение ${value} не покрыто ветвью`);
    }
  }
});

test("узлы в коде и в контенте совпадают", () => {
  const inContent = rawContent.step3.nodes.map((node) => node.id).filter((id) => id !== FALLBACK_NODE_ID);
  const inCode = NODE_RULES.map((rule) => rule.id);
  assert.deepEqual(inCode, inContent, "порядок и состав узлов разошлись");
  assert.ok(rawContent.step3.nodes.some((node) => node.id === FALLBACK_NODE_ID), "нет запасного узла");
});

test("каждый узел ведёт к существующему срезу", () => {
  const sliceIds = new Set(rawContent.slices.map((slice) => slice.id));
  for (const rule of NODE_RULES) {
    const offer = rawContent.step3.offers[rule.id];
    assert.ok(offer, `${rule.id}: нет платного предложения`);
    assert.ok(sliceIds.has(offer), `${rule.id}: предложение ${offer} не описано в content/slices`);
  }
  const fallback = rawContent.step3.offers["default"];
  assert.ok(fallback !== undefined && sliceIds.has(fallback), "предложение по умолчанию не описано");
});

test("у каждого среза с файлом есть обещание, цена и координаты", () => {
  for (const slice of rawContent.slices) {
    assert.ok(slice.title.length > 5, `${slice.id}: пустое название`);
    assert.ok(slice.price >= 490, `${slice.id}: цена вне маршрута`);
    if (!slice.file) continue;
    assert.ok(slice.promise.length > 80, `${slice.id}: обещание оффера слишком короткое`);
    assert.ok(slice.coordinates.length > 0, `${slice.id}: не указаны координаты`);
  }
});

test("полосы карты совпадают с таблицей в docs/11-ui-page-spec.md", () => {
  const doc = repoFile("docs/11-ui-page-spec.md");
  const section = doc.slice(doc.indexOf("## Визуальная карта"));
  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("---"))
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => /^\d+$/.test(cells[1] ?? ""));

  assert.equal(rows.length, BAR_DEFINITIONS.length, "число полос в коде и в документе не совпадает");
  rows.forEach((cells, index) => {
    const bar = BAR_DEFINITIONS[index]!;
    assert.equal(bar.label, cells[0]);
    assert.equal(bar.coordinate, Number(cells[1]));
  });
});

test("тексты для пользователя не содержат названий методик", () => {
  const texts = [
    ...Object.values(rawContent.step1.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
    ...Object.values(rawContent.step2.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
    ...Object.values(rawContent.step2.scales).flatMap((branches) => branches.map((b) => b.text)),
    ...rawContent.step1.matrix.map((row) => row.text),
    ...rawContent.step2.matrix.map((row) => row.text),
    ...rawContent.step3.nodes.map((node) => node.text),
    ...rawContent.step0.metaphors.map((metaphor) => metaphor.text),
  ];
  const found = scanTexts(texts, "разбор", { group: "FORBIDDEN_METHODS" });
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("запрещённые слова продукта не встречаются в готовых текстах", () => {
  const texts = [
    ...Object.values(rawContent.step1.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
    ...Object.values(rawContent.step2.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
    ...rawContent.step3.nodes.map((node) => node.text),
    ...rawContent.step0.metaphors.map((metaphor) => metaphor.text),
  ];
  const found = scanTexts(texts, "разбор");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});
