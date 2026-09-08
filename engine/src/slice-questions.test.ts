/**
 * E2-03: состав вопросов-доборов и неизменность их формулировок.
 *
 * Число вопросов сверяется с колонкой «Вопросов» в content/slices/README.md,
 * а тексты — со строками самих файлов срезов: строка таблицы собирается обратно
 * из разобранных данных и обязана найтись в файле символ в символ.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import type { RawSlice, RawSliceQuestion } from "./content-types.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const withFile = (): RawSlice[] => rawContent.slices.filter((slice) => slice.file);

/** Число вопросов из README: «10», «20», «описание + 8». */
const expectedCount = (cell: string): number => {
  const match = /(\d+)\s*$/.exec(cell);
  assert.ok(match, `не разобрано число вопросов «${cell}»`);
  return Number(match[1]);
};

const optionsCell = (question: RawSliceQuestion): string => {
  if (question.sameAs) return `как в ${question.sameAs}`;
  if (!question.options.length) return "—";
  return question.options.map((option) => `**${option.key}** ${option.text}`).join(" · ");
};

const row = (question: RawSliceQuestion): string =>
  [
    question.id,
    question.text,
    question.type,
    question.coordinates.length ? question.coordinates.join(", ") : "—",
    optionsCell(question),
    question.purpose,
  ].join(" | ");

test("сборщик отдаёт 95 вопросов-доборов по восьми срезам", () => {
  const slices = withFile();
  assert.equal(slices.length, 8, "срезов с файлом доборов должно быть восемь");
  const total = slices.reduce((sum, slice) => sum + slice.questions.length, 0);
  assert.equal(total, 95);
});

test("число вопросов каждого среза совпадает с колонкой в content/slices/README.md", () => {
  const readme = repoFile("content/slices/README.md");
  for (const slice of withFile()) {
    const line = readme.split("\n").find((candidate) => candidate.includes(`\`${slice.file}\``));
    assert.ok(line, `${slice.id}: файла нет в таблице состава`);
    const cell = line.split("|").map((part) => part.trim())[4] ?? "";
    assert.equal(slice.questions.length, expectedCount(cell), `${slice.id}: число вопросов разошлось с README`);
  }
});

test("у каждого вопроса-добора известны идентификатор, тип, текст, варианты и назначение", () => {
  const types = new Set(["выбор", "шкала", "открытый", "число"]);
  for (const slice of withFile()) {
    slice.questions.forEach((question, index) => {
      assert.equal(question.id, `S${index + 1}`, `${slice.id}: нарушена нумерация вопросов`);
      assert.ok(types.has(question.type), `${slice.id} ${question.id}: неизвестный тип ${question.type}`);
      assert.ok(question.text.length > 10, `${slice.id} ${question.id}: пустой текст`);
      assert.ok(question.purpose.length > 10, `${slice.id} ${question.id}: не заполнено назначение`);
      assert.ok([1, 2].includes(question.portion), `${slice.id} ${question.id}: неизвестная порция`);
      for (const coordinate of question.coordinates) {
        assert.ok(coordinate >= 1 && coordinate <= 16, `${slice.id} ${question.id}: координата вне 1–16`);
      }
      if (question.type === "выбор") {
        assert.ok(question.options.length >= 2, `${slice.id} ${question.id}: у выбора меньше двух вариантов`);
      } else {
        assert.equal(question.options.length, 0, `${slice.id} ${question.id}: варианты только у выбора`);
      }
    });
  }
});

test("прикладные срезы выдаются двумя порциями по десять вопросов", () => {
  for (const slice of withFile()) {
    const portions = new Set(slice.questions.map((question) => question.portion));
    if (slice.price < 1290) {
      assert.deepEqual([...portions], [1], `${slice.id}: узловой срез выдаётся одной порцией`);
      continue;
    }
    if (slice.questions.length !== 20) continue;
    assert.deepEqual([...portions].sort(), [1, 2], `${slice.id}: нет двух порций`);
    for (const portion of [1, 2]) {
      const count = slice.questions.filter((question) => question.portion === portion).length;
      assert.equal(count, 10, `${slice.id}: в порции ${portion} не десять вопросов`);
    }
  }
});

test("переразметка не изменила ни одной формулировки: строка собирается обратно", () => {
  for (const slice of withFile()) {
    const source = repoFile(`content/slices/${slice.file}`);
    for (const question of slice.questions) {
      assert.ok(
        source.includes(`| ${row(question)} |`),
        `${slice.id} ${question.id}: строка не совпала с файлом\n  собрано: | ${row(question)} |`,
      );
    }
  }
});

test("в текстах вопросов и вариантов не осталось следов разметки", () => {
  for (const slice of withFile()) {
    for (const question of slice.questions) {
      assert.ok(!/\*\*|\||·/.test(question.text), `${slice.id} ${question.id}: разметка в тексте вопроса`);
      assert.equal(question.text, question.text.trim(), `${slice.id} ${question.id}: текст не обрезан`);
      for (const option of question.options) {
        assert.ok(!/\*\*|\||·/.test(option.text), `${slice.id} ${question.id}.${option.key}: разметка в варианте`);
        assert.ok(/^[A-G]$/.test(option.key), `${slice.id} ${question.id}: ключ варианта вне A–G`);
      }
    }
  }
});

test("вопрос со ссылкой «как в S4» получает те же варианты, что и названный", () => {
  const referring = withFile().flatMap((slice) =>
    slice.questions.filter((question) => question.sameAs).map((question) => ({ slice, question })),
  );
  assert.ok(referring.length > 0, "ссылок на варианты другого вопроса не найдено");
  for (const { slice, question } of referring) {
    const source = slice.questions.find((candidate) => candidate.id === question.sameAs);
    assert.ok(source, `${slice.id} ${question.id}: нет вопроса ${question.sameAs}`);
    assert.deepEqual(question.options, source?.options);
  }
});

test("у каждого среза с файлом есть подтипы, порог и одна таблица следующих дверей", () => {
  for (const slice of withFile()) {
    assert.ok(slice.subtypes.length >= 4, `${slice.id}: подтипов меньше четырёх`);
    for (const subtype of slice.subtypes) {
      assert.ok(/^[a-z_]+$/.test(subtype.code), `${slice.id}: код подтипа «${subtype.code}» не машинный`);
      assert.ok(subtype.text.length > 10, `${slice.id} ${subtype.code}: нет формулировки внутрь профиля`);
    }
    assert.ok(slice.threshold, `${slice.id}: нет порога генерации`);
    assert.ok((slice.threshold?.checks.length ?? 0) >= 4, `${slice.id}: у порога меньше четырёх пунктов`);
    assert.ok((slice.threshold?.followUps.length ?? 0) >= 3, `${slice.id}: уточняющих меньше трёх`);
    assert.equal(
      slice.nextDoors[slice.nextDoors.length - 1]?.condition,
      "иначе",
      `${slice.id}: у таблицы следующих дверей нет строки «иначе»`,
    );
    const known = new Set(rawContent.slices.map((candidate) => candidate.id));
    for (const door of slice.nextDoors) {
      assert.ok(known.has(door.slice), `${slice.id}: дверь ведёт в неизвестный срез ${door.slice}`);
      assert.notEqual(door.slice, slice.id, `${slice.id}: дверь ведёт в тот же срез`);
    }
  }
});
