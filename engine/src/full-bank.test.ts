/**
 * Полный банк 35+3: состав, разметка и неизменность формулировок.
 *
 * Тексты вопросов — продукт: они выверены и правятся только в
 * `content/questions-full-bank.md`. Контрольного списка текстов в коде нет
 * намеренно — это был бы второй источник правды. Вместо него проверяется,
 * что разбор ничего не теряет и не приносит: строка таблицы собирается из
 * разобранных данных обратно и совпадает с файлом символ в символ.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const bankFile = repoFile("content/questions-full-bank.md");
const closed = rawContent.bank.filter((question) => question.type !== "открытый");
const open = rawContent.bank.filter((question) => question.type === "открытый");

test("банк отдаёт 35 закрытых и 3 открытых вопроса", () => {
  assert.equal(closed.length, 35);
  assert.equal(open.length, 3);
  assert.deepEqual(
    closed.map((question) => question.id),
    Array.from({ length: 35 }, (_, i) => `Q${i + 1}`),
  );
  assert.deepEqual(
    open.map((question) => question.id),
    ["О1", "О2", "О3"],
  );
});

test("у каждого вопроса известны координата, тип и направление", () => {
  for (const question of rawContent.bank) {
    assert.ok(question.coordinates.length > 0, `${question.id}: не указана координата`);
    for (const coordinate of question.coordinates) {
      assert.ok(coordinate >= 1 && coordinate <= 16, `${question.id}: координата ${coordinate} вне 1–16`);
    }
    assert.ok(["прямой", "обратный"].includes(question.direction), `${question.id}: нет направления`);
    assert.ok(["шкала", "выбор", "открытый"].includes(question.type), `${question.id}: нет типа`);
    if (question.type === "выбор") assert.ok(question.options.length >= 2, `${question.id}: нет вариантов`);
    else assert.equal(question.options.length, 0, `${question.id}: варианты есть только у типа «выбор»`);
    if (question.type !== "шкала")
      assert.equal(question.direction, "прямой", `${question.id}: инверсия определена только для шкал`);
  }
});

test("формулировки не несут следов разметки и лежат в markdown дословно", () => {
  for (const question of rawContent.bank) {
    const texts = [question.text, ...question.options.map((option) => option.text)];
    for (const text of texts) {
      assert.equal(text, text.trim(), `${question.id}: текст не обрезан по краям`);
      assert.ok(text.length > 1, `${question.id}: пустой текст`);
      assert.ok(!/\*\*|\||·|^—|—$/.test(text), `${question.id}: в тексте осталась разметка — ${text}`);
      assert.ok(!text.includes("  "), `${question.id}: двойной пробел в тексте`);
      assert.ok(bankFile.includes(text), `${question.id}: текста нет в content/questions-full-bank.md дословно`);
    }
  }
});

test("строка таблицы собирается из разобранных данных без потерь", () => {
  for (const question of rawContent.bank) {
    const options = question.options.length
      ? question.options.map((option) => `**${option.key}** ${option.text}`).join(" · ")
      : "—";
    const row = [
      question.id,
      question.text,
      question.type,
      question.coordinates.join(", "),
      question.direction,
      question.role ?? "—",
      options,
    ].join(" | ");
    assert.ok(bankFile.includes(`| ${row} |`), `${question.id}: разбор не сходится со строкой в банке`);
  }
});

test("обратные и ключевые вопросы совпадают с docs/02-coordinates.md", () => {
  const doc = repoFile("docs/02-coordinates.md");
  const byId = new Map(rawContent.bank.map((question) => [question.id, question]));

  const marked = (pattern: RegExp): string[] => [...doc.matchAll(pattern)].map((match) => match[1] ?? "");

  for (const id of marked(/(Q\d+) \(обратный\)/g)) {
    assert.equal(byId.get(id)?.direction, "обратный", `${id}: в docs/02 помечен обратным, в банке нет`);
  }
  for (const id of marked(/(Q\d+) \(ключевой\)/g)) {
    assert.equal(byId.get(id)?.role, "ключевой", `${id}: в docs/02 помечен ключевым, в банке нет`);
  }
  for (const id of marked(/(Q\d+) \(низкий вес/g)) {
    assert.equal(byId.get(id)?.role, "низкий вес", `${id}: в docs/02 помечен низким весом, в банке нет`);
  }
});

test("координаты docs/02 и координаты банка не разъезжаются", () => {
  const doc = repoFile("docs/02-coordinates.md").split("\n");
  const byId = new Map(rawContent.bank.map((question) => [question.id, question]));
  let coordinate = 0;
  let checked = 0;

  for (const line of doc) {
    const heading = /^### (\d+)\. /.exec(line);
    if (heading) coordinate = Number(heading[1]);
    if (!line.startsWith("Вопросы:") || !coordinate) continue;
    for (const match of line.matchAll(/(Q\d+)/g)) {
      const id = match[1] ?? "";
      const question = byId.get(id);
      assert.ok(question, `${id} упомянут в docs/02, но его нет в банке`);
      assert.ok(
        question?.coordinates.includes(coordinate),
        `${id}: docs/02 относит его к координате ${coordinate}, банк — к ${question?.coordinates.join(", ")}`,
      );
      checked += 1;
    }
  }

  assert.ok(checked >= 30, `сверено ${checked} упоминаний — слишком мало, разбор docs/02 сломался`);
  for (const id of Array.from({ length: 16 }, (_, i) => i + 1)) {
    assert.ok(
      rawContent.bank.some((question) => question.coordinates.includes(id)),
      `координату ${id} не питает ни один вопрос банка`,
    );
  }
});

test("каждый вопрос лестницы взят из банка вместе с координатами", () => {
  const byId = new Map(rawContent.bank.map((question) => [question.id, question]));
  for (const question of rawContent.questions) {
    const source = byId.get(question.source);
    assert.ok(source, `${question.id}: источник ${question.source} не найден в банке`);
    assert.equal(source?.type, question.type, `${question.id}: тип разошёлся с банком`);
    assert.deepEqual(source?.coordinates, question.coordinates, `${question.id}: координаты разошлись с банком`);
  }
});
