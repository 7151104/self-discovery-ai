/**
 * Добор полной карты (E5-13).
 *
 * Главное, что здесь проверяется, — единственность источника правды: в
 * `content/slices/full-map.md` стоят идентификаторы банка и ни одной формулировки
 * вопроса. Остальное — состав остатка (24 закрытых + `О2`, `О3`), размеры порций,
 * полнота матриц промежуточных блоков и то, что тексты блоков проходят реестр
 * запрещённых формулировок.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import {
  fullMap,
  fullMapInterlude,
  fullMapInterludeText,
  fullMapPortions,
  fullMapQuestions,
  fullMapRemaining,
} from "./full-map.js";
import { scanTexts, describeHit } from "./forbidden.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const source = repoFile("content/slices/full-map.md");
const ladderSources = new Set(rawContent.questions.map((question) => question.source));

test("добор полной карты — 26 вопросов тремя порциями 10 + 10 + 6", () => {
  const portions = fullMapPortions();
  assert.deepEqual(
    portions.map((portion) => portion.questions.length),
    [10, 10, 6],
  );
  assert.deepEqual(
    portions.map((portion) => portion.number),
    [1, 2, 3],
  );
  assert.equal(fullMapQuestions().length, 26);
});

test("состав добора — остаток банка: 24 закрытых плюс О2 и О3", () => {
  const questions = fullMapQuestions();
  const closed = questions.filter((question) => question.type !== "открытый");
  const open = questions.filter((question) => question.type === "открытый");
  assert.equal(closed.length, 24);
  assert.deepEqual(
    open.map((question) => question.id),
    ["О2", "О3"],
  );

  const inBank = new Set(rawContent.bank.map((question) => question.id));
  for (const question of questions) {
    assert.ok(inBank.has(question.id), `${question.id}: такого вопроса нет в полном банке`);
  }

  // Остаток именно остаток: ни одного вопроса банка не забыли.
  const covered = new Set(questions.map((question) => question.id));
  const forgotten = rawContent.bank
    .filter((question) => !ladderSources.has(question.id) && !covered.has(question.id))
    .map((question) => question.id);
  assert.deepEqual(forgotten, [], "часть банка не попала ни в лестницу, ни в добор");
});

test("ни один вопрос лестницы в добор не попал: повторов нет", () => {
  for (const question of fullMapQuestions()) {
    assert.ok(
      !ladderSources.has(question.id),
      `${question.id}: этот вопрос человек уже прошёл на лестнице`,
    );
  }
  assert.equal(ladderSources.size, 12, "таблица mapping лестницы изменилась — состав добора надо пересчитать");
});

test("формулировки вопросов в файл среза не скопированы", () => {
  for (const question of fullMapQuestions()) {
    assert.ok(
      !source.includes(question.text),
      `${question.id}: формулировка скопирована в файл среза — это второй источник правды`,
    );
    // Короткие варианты банка — одно-два слова («люди», «выгода»), они встречаются в
    // обычной речи; проверяются те, чьё совпадение случайным быть не может.
    for (const option of question.options.filter((candidate) => candidate.text.length > 15)) {
      assert.ok(!source.includes(option.text), `${question.id}: вариант «${option.text}» скопирован в файл среза`);
    }
  }
  // Идентификаторы, наоборот, в файле стоят все.
  for (const question of fullMapQuestions()) {
    assert.ok(source.includes(`| ${question.id} |`), `${question.id}: идентификатора нет в таблице порции`);
  }
});

test("текст, тип и варианты каждого вопроса добора совпадают с банком", () => {
  const byId = new Map(rawContent.bank.map((question) => [question.id, question]));
  for (const question of fullMapQuestions()) {
    const bank = byId.get(question.id)!;
    assert.equal(question.text, bank.text);
    assert.equal(question.type, bank.type);
    assert.equal(question.direction, bank.direction);
    assert.deepEqual(question.coordinates, bank.coordinates);
    assert.deepEqual(question.options, bank.options);
    assert.ok(question.why.length > 10, `${question.id}: не сказано, зачем вопрос в этой порции`);
  }
});

test("вопрос, на который ответ уже есть, во следующую порцию не попадает", () => {
  const first = fullMapPortions()[0]!.questions.map((question) => question.id);
  const remaining = fullMapRemaining(first);
  assert.equal(remaining.length, 16);
  for (const id of first) {
    assert.ok(!remaining.some((question) => question.id === id), `${id}: задан второй раз`);
  }
  assert.deepEqual(fullMapRemaining().length, 26, "без ответов остаток равен всему добору");
});

test("у каждого промежуточного блока две оси и полная матрица пар", () => {
  const interludes = fullMap().interludes;
  assert.equal(interludes.length, 2, "блоков между тремя порциями должно быть два");

  const portionOf = (id: string): number =>
    fullMapPortions().find((portion) => portion.questions.some((question) => question.id === id))!.number;

  for (const interlude of interludes) {
    assert.ok(interlude.heading.length > 10, `блок ${interlude.number}: нет заголовка`);
    assert.equal(interlude.axes.length, 2);

    for (const axis of interlude.axes) {
      assert.ok(axis.ids.length >= 1);
      for (const id of axis.ids) {
        assert.ok(
          portionOf(id) <= interlude.number,
          `блок ${interlude.number}: ось стоит на ${id} из более поздней порции`,
        );
      }
      if (axis.kind === "полоса") {
        assert.deepEqual(axis.keys, ["низко", "середина", "высоко"]);
        assert.ok(axis.poles["низко"] && axis.poles["высоко"], "у полосы не подписаны полюса");
      } else {
        const bank = rawContent.bank.find((question) => question.id === axis.ids[0])!;
        assert.deepEqual(axis.keys, bank.options.map((option) => option.key));
      }
    }

    const expected = interlude.axes[0]!.keys.length * interlude.axes[1]!.keys.length;
    assert.equal(interlude.pairs.length, expected, `блок ${interlude.number}: матрица неполная`);
    for (const first of interlude.axes[0]!.keys) {
      for (const second of interlude.axes[1]!.keys) {
        const text = fullMapInterludeText(interlude.number, first, second);
        assert.ok(text.length > 120, `блок ${interlude.number}, пара ${first}×${second}: текст слишком короткий`);
      }
    }
  }

  assert.throws(() => fullMapInterlude(3), /нет промежуточного блока 3/);
});

test("тексты промежуточных блоков говорят на «ты» и не пересказывают вопросы", () => {
  const second = /(?:^|[^а-яёa-z])(ты|теб[еяю]|тобой|тво[йяеиё])(?:[^а-яёa-z]|$)/i;
  for (const interlude of fullMap().interludes) {
    for (const pair of interlude.pairs) {
      const where = `блок ${interlude.number}, пара ${pair.first}×${pair.second}`;
      assert.match(pair.text, second, `${where}: текст не обращается к человеку на «ты»`);
      assert.ok(!/\?/.test(pair.text), `${where}: в тексте блока стоит вопрос`);
      assert.ok(!/!/.test(pair.text), `${where}: восклицание`);
      assert.ok(
        !/следующ(ая|ей) порци|дальше будет|в конце разбор/i.test(pair.text),
        `${where}: блок обещает продолжение`,
      );
    }
  }
});

test("тексты среза проходят реестр запрещённых формулировок", () => {
  const interludeTexts = fullMap().interludes.flatMap((interlude) => interlude.pairs.map((pair) => pair.text));
  const found = scanTexts([...interludeTexts, fullMap().promise], "разбор");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );

  const outward = scanTexts(fullMap().report, "промпты");
  assert.deepEqual(
    outward.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("у среза есть порог, состав отчёта, границы точности и запреты", () => {
  const slice = fullMap();
  assert.equal(slice.slice, "slice_full_map");
  assert.equal(slice.price, 1990);
  assert.ok(slice.promise.length > 80, "обещание оффера слишком короткое");

  assert.ok(slice.threshold.checks.length >= 4, "у порога меньше четырёх пунктов");
  assert.ok(slice.threshold.followUps.length >= 3, "уточняющих меньше трёх");
  assert.ok(slice.report.length >= 6, "состав отчёта короче шести пунктов");
  assert.ok(slice.restrictions.length >= 4, "запретов меньше четырёх");
  assert.ok(slice.subtypes.length >= 4, "подтипов меньше четырёх");
  for (const subtype of slice.subtypes) {
    assert.match(subtype.code, /^[a-z_]+$/, `подтип «${subtype.code}» записан не машинным кодом`);
    assert.ok(subtype.text.length > 10, `${subtype.code}: нет формулировки внутрь профиля`);
  }
});

test("границы точности названы честно и попадают в состав отчёта", () => {
  const slice = fullMap();
  const accuracy = slice.accuracy.join(" ");
  for (const coordinate of ["1, 4 и 12", "10", "15 и 16", "14"]) {
    assert.ok(accuracy.includes(coordinate), `в границах точности не сказано про ${coordinate}`);
  }
  assert.ok(
    /не обещается|не обещаем/.test(`${accuracy} ${slice.promise}`),
    "высокая точность по всем шестнадцати нигде не снята",
  );
  assert.ok(
    slice.report.some((item) => /границ/i.test(item)),
    "границы точности не попадают в текст разбора, а остаются внутри",
  );
  assert.ok(
    slice.restrictions.some((item) => /координат/i.test(item)),
    "нет запрета называть координаты",
  );
});

test("последняя дверь маршрута не обещает предложения, которого нет", () => {
  const doors = fullMap().nextDoors;
  const last = doors[doors.length - 1]!;
  assert.equal(last.condition, "иначе");
  assert.equal(last.slice, null, "после полной карты предложение не выдаётся");
  const known = new Set(rawContent.slices.map((slice) => slice.id));
  for (const door of doors) {
    if (!door.slice) continue;
    assert.ok(known.has(door.slice), `дверь ведёт в неизвестный срез ${door.slice}`);
    assert.notEqual(door.slice, "slice_full_map", "дверь ведёт в тот же срез");
  }
});
