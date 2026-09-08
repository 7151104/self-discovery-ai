/**
 * Промежуточные блоки прикладных срезов (E5-04).
 *
 * Прикладной срез за 1290 ₽ выдаётся двумя порциями по десять вопросов, и между
 * порциями человек обязан получить готовый текст без LLM — иначе нарушен Закон 1
 * (ценность выдана раньше, чем запрошен следующий шаг). Проверяется то же, что и
 * у матриц ступеней 1–2: покрытие каждой пары значений и отсутствие запрещённого.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";

const interludes = rawExtraContent.interludes;

/** Обращение на «ты». Границы слова заданы вручную: `\b` не работает с кириллицей. */
const SECOND_PERSON = /(?:^|[^а-яёa-z])(ты|теб[еяю]|тобой|тво[йяеиё])(?:[^а-яёa-z]|$)/i;

/** Прикладные срезы: две порции по десять, значит между ними нужен блок. */
const appliedSlices = rawContent.slices.filter((slice) => slice.file && slice.questionCount === "20");

test("у каждого прикладного среза есть промежуточный блок с заголовком", () => {
  assert.ok(appliedSlices.length >= 2, "прикладных срезов в маршруте меньше двух — таблица срезов сломалась");
  for (const slice of appliedSlices) {
    const interlude = interludes.find((candidate) => candidate.slice === slice.id);
    assert.ok(interlude, `${slice.id}: нет промежуточного блока после первой порции`);
    assert.ok((interlude?.heading.length ?? 0) > 10, `${slice.id}: у промежуточного блока пустой заголовок`);
  }
});

test("промежуточный блок покрывает каждую пару значений S4 × S5", () => {
  for (const interlude of interludes) {
    const [first, second] = interlude.axes;
    assert.ok(first && second, `${interlude.slice}: у блока не две оси`);

    const byPair = new Map(interlude.pairs.map((pair) => [`${pair.first}${pair.second}`, pair.text]));
    for (const firstKey of first!.keys) {
      for (const secondKey of second!.keys) {
        const text = byPair.get(`${firstKey}${secondKey}`);
        assert.ok(
          text && text.length > 0,
          `${interlude.slice}: нет текста для пары ${first!.id}=${firstKey} × ${second!.id}=${secondKey}`,
        );
      }
    }
    assert.equal(
      interlude.pairs.length,
      first!.keys.length * second!.keys.length,
      `${interlude.slice}: в таблице есть пары вне объявленных осей`,
    );
  }
});

test("оси промежуточного блока совпадают с вариантами вопросов добора", () => {
  for (const interlude of interludes) {
    const [first, second] = interlude.axes;
    const declared = [first!.keys, second!.keys];
    const inQuestions = [interlude.questionKeys.first, interlude.questionKeys.second];

    inQuestions.forEach((keys, index) => {
      if (!keys.length) return; // строка вопроса ссылается на варианты соседнего вопроса
      assert.deepEqual(
        keys,
        declared[index],
        `${interlude.slice}: варианты ${interlude.axes[index]!.id} в таблице вопросов и в осях блока разошлись`,
      );
    });
  }
});

test("текст промежуточного блока написан как продукт, а не как заметка", () => {
  for (const interlude of interludes) {
    for (const pair of interlude.pairs) {
      const where = `${interlude.slice} ${pair.first}×${pair.second}`;
      assert.ok(pair.text.length > 150, `${where}: текст подозрительно короткий`);
      assert.ok(SECOND_PERSON.test(pair.text), `${where}: обращение не на «ты»`);
      assert.ok(!/\*\*|\|/.test(pair.text), `${where}: в тексте осталась разметка`);
      assert.equal(pair.text, pair.text.trim(), `${where}: текст не обрезан по краям`);
    }
  }
});

test("промежуточный блок не обещает вторую порцию и не пересказывает вопросы", () => {
  // Блок стоит только на ответах первой порции: он не анонсирует продолжение,
  // не считает вопросы и не повторяет их формулировки.
  const forbidden = [
    /следующ\w+ порци/i,
    /втор\w+ порци/i,
    /дальше (?:будет|спрошу|идут)/i,
    /ещё \d+ вопрос/i,
    /в отчёте/i,
    /ты ответил/i,
  ];
  for (const interlude of interludes) {
    for (const pair of interlude.pairs) {
      for (const pattern of forbidden) {
        assert.ok(
          !pattern.test(pair.text),
          `${interlude.slice} ${pair.first}×${pair.second}: блок выходит за первую порцию — ${pattern}`,
        );
      }
    }
  }
});

test("в промежуточных блоках нет методик, запрещённых слов и языка коучинга", () => {
  const forbidden =
    /\b(MBTI|эннеаграмм|Human Design|астролог|нумеролог|Big Five|соционик|предназначен|вибраци|карм[аеуы]\b|миссия|потенциал|зона комфорта|тест)/i;
  for (const interlude of interludes) {
    for (const pair of interlude.pairs) {
      assert.ok(
        !forbidden.test(pair.text),
        `${interlude.slice} ${pair.first}×${pair.second}: запрещённая формулировка — ${pair.text.slice(0, 60)}`,
      );
    }
  }
});

test("каждая пара получает свой текст, а не общий на всех", () => {
  for (const interlude of interludes) {
    const texts = new Set(interlude.pairs.map((pair) => pair.text));
    assert.equal(texts.size, interlude.pairs.length, `${interlude.slice}: один и тот же текст стоит у разных пар`);
  }
});
