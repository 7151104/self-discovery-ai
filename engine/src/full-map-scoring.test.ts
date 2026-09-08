/**
 * E2-13: добор полной карты из остатка банка.
 *
 * Ответы берутся из `examples/demo-person-answers.md`: лестница получается из тех
 * же ответов по таблице mapping, добор — из остатка. Второго набора данных в коде
 * быть не должно, иначе тест проверял бы сам себя.
 *
 * Главное, что здесь закрывается, — риск из маршрута: ответы банка обязаны идти
 * через ту же `scoreCoordinate`, что лестница и доборы срезов. Поэтому профиль
 * после добора сверяется с профилем по полному банку на тех же ответах: два входа
 * в один профиль не должны давать два набора правил.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import {
  buildFullMapInterlude,
  buildFullMapProfile,
  fullMap,
  fullMapAnswered,
  fullMapBankAnswers,
  fullMapDelivered,
  fullMapInterlude,
  fullMapInterludeText,
  fullMapPortion,
  fullMapPortions,
  fullMapQuestions,
  fullMapRemainder,
  fullMapReport,
  fullMapThreshold,
  nextFullMapPortion,
  FULL_MAP_SUBTYPES,
  type FullMapInput,
} from "./full-map.js";
import {
  bankAnswersFromLadder,
  buildProfile,
  buildProfileFromBank,
  pointerOfBand,
  unknownCoordinates,
} from "./scoring.js";
import { sliceAnswers, textLonger } from "./slice-fixtures.js";
import type { BankAnswers, LadderAnswers, ScaleAnswer } from "./types.js";

const demoFile = readFileSync(new URL("../../examples/demo-person-answers.md", import.meta.url), "utf8");

/** Таблица «| Q | Ответ |» из examples/demo-person-answers.md. */
const demo = ((): BankAnswers => {
  const answers: BankAnswers = {};
  for (const line of demoFile.split("\n")) {
    const row = /^\|\s*(\d+)\s*\|\s*([A-G]|[1-5])\s*\|$/.exec(line.trim());
    if (!row) continue;
    const value = row[2] ?? "";
    answers[`Q${row[1]}`] = /^[1-5]$/.test(value) ? (Number(value) as ScaleAnswer) : value;
  }
  return answers;
})();

/** Ответы лестницы того же человека: по таблице mapping, а не вторым набором. */
const ladder = ((): LadderAnswers => {
  const answers: Record<string, ScaleAnswer | string> = {};
  for (const question of rawContent.questions) {
    if (question.type === "открытый") continue;
    const value = demo[question.source];
    if (value !== undefined) answers[question.id] = value;
  }
  answers["L12"] = textLonger(20);
  return answers as LadderAnswers;
})();

const ladderBankIds = new Set(rawContent.questions.map((question) => question.source));

/** Ответы порций добора: остаток банка плюс открытые `О2` и `О3`. */
const portionAnswers = ((): BankAnswers => {
  const answers: BankAnswers = {};
  for (const question of fullMapQuestions()) {
    answers[question.id] = question.type === "открытый" ? textLonger(20) : demo[question.id];
  }
  return answers;
})();

/** Ответы порций до названной включительно. */
const upToPortion = (last: number): BankAnswers => {
  const answers: BankAnswers = {};
  for (const portion of fullMapPortions().filter((candidate) => candidate.number <= last)) {
    for (const question of portion.questions) answers[question.id] = portionAnswers[question.id];
  }
  return answers;
};

/** Сюжет и задачу периода даёт синтез открытых: движок текста не разбирает. */
const synthesis = {
  storyline: { value: "тащит один и бросает у финиша", code: "solo_then_drop", confidence: "medium" as const },
  periodTask: { value: "выход в видимость", code: "visibility", confidence: "medium" as const },
};

const full: FullMapInput = { ladder, bank: portionAnswers };

// ── Состав добора ─────────────────────────────────────────────────────────────

test("лестница переводится в идентификаторы банка по таблице mapping", () => {
  const translated = bankAnswersFromLadder(ladder);

  assert.equal(Object.keys(translated).length, 11, "лестница закрывает 11 закрытых вопросов банка");
  for (const [id, value] of Object.entries(translated)) {
    assert.ok(ladderBankIds.has(id), `${id}: такого вопроса лестница не задаёт`);
    assert.equal(value, demo[id], `${id}: ответ при переводе изменился`);
  }
  assert.ok(!("О1" in translated), "открытый ответ арифметики не даёт и в перевод не идёт");

  // Лестница и добор вместе дают ровно полный банк того же человека.
  const together = fullMapBankAnswers(full);
  for (const question of rawContent.bank.filter((candidate) => candidate.type !== "открытый")) {
    assert.equal(together[question.id], demo[question.id], `${question.id}: ответ разошёлся с examples/`);
  }
});

test("добор — остаток банка: 24 закрытых плюс О2 и О3, вопросов лестницы в нём нет", () => {
  const remainder = fullMapRemainder({ ladder });

  assert.equal(remainder.length, 26);
  assert.equal(remainder.filter((question) => question.type !== "открытый").length, 24);
  assert.deepEqual(
    remainder.filter((question) => question.type === "открытый").map((question) => question.id),
    ["О2", "О3"],
  );
  for (const question of remainder) {
    assert.ok(!ladderBankIds.has(question.id), `${question.id}: этот вопрос человек уже прошёл на лестнице`);
  }
  // Остаток именно вычитается: всё, что не задано лестницей, попало в добор.
  assert.deepEqual(
    remainder.map((question) => question.id).sort(),
    rawContent.bank
      .filter((question) => !ladderBankIds.has(question.id))
      .map((question) => question.id)
      .sort(),
  );
  // Порядок остатка — порядок порций файла среза, а не порядок банка.
  assert.deepEqual(
    remainder.map((question) => question.id),
    fullMapQuestions().map((question) => question.id),
  );
  assert.equal(fullMapAnswered({ ladder }).length, 12, "лестница закрывает 11 закрытых и открытый О1");
});

test("после купленного узлового среза состав добора не меняется", () => {
  const before = fullMapRemainder({ ladder }).map((question) => question.id);

  const withSlices = fullMapRemainder({
    ladder,
    slices: [
      { slice: "slice_node_finish", answers: sliceAnswers("slice_node_finish") },
      { slice: "slice_stress", answers: sliceAnswers("slice_stress") },
    ],
  });

  assert.deepEqual(
    withSlices.map((question) => question.id),
    before,
    "доборы срезов идентификаторов банка не имеют и вопросы банка не гасят",
  );
});

test("вопрос, на который ответ уже есть, второй раз не задаётся", () => {
  const first = fullMapPortion(1).questions.map((question) => question.id);
  const remainder = fullMapRemainder({ ladder, bank: upToPortion(1) });

  assert.equal(remainder.length, 16);
  for (const id of first) {
    assert.ok(!remainder.some((question) => question.id === id), `${id}: задан второй раз`);
  }
  assert.equal(fullMapRemainder(full).length, 0, "после всех порций остатка нет");
});

// ── Порции ────────────────────────────────────────────────────────────────────

test("порции выдаются 10 + 10 + 6, между ними промежуточные блоки", () => {
  assert.deepEqual(
    fullMapPortions().map((portion) => portion.questions.length),
    [10, 10, 6],
  );

  const first = nextFullMapPortion({ ladder });
  assert.equal(first?.number, 1);
  assert.equal(first?.count, 3);
  assert.equal(first?.questions.length, 10);
  assert.equal(first?.interlude, 1, "после первой порции человек получает блок, а не следующие вопросы");

  const second = nextFullMapPortion({ ladder, bank: upToPortion(1) });
  assert.equal(second?.number, 2);
  assert.equal(second?.interlude, 2);

  const third = nextFullMapPortion({ ladder, bank: upToPortion(2) });
  assert.equal(third?.number, 3);
  assert.equal(third?.questions.length, 6);
  assert.equal(third?.interlude, null, "после последней порции идёт разбор, а не блок");

  assert.equal(nextFullMapPortion(full), null);
  assert.equal(fullMapDelivered(full), true);
  assert.equal(fullMapDelivered({ ladder }), false);
});

test("порция не меняется до конца: возврат открывает ту же, а не новый набор", () => {
  const partial: BankAnswers = { Q1: demo["Q1"], Q2: demo["Q2"] };
  const portion = nextFullMapPortion({ ladder, bank: partial });

  assert.equal(portion?.number, 1);
  assert.deepEqual(
    portion?.questions.map((question) => question.id),
    fullMapPortion(1).questions.map((question) => question.id),
    "состав первой порции пересчитан заново",
  );
});

// ── Промежуточные блоки ───────────────────────────────────────────────────────

test("промежуточный блок после порции берётся из файла среза по ключам осей", () => {
  const afterFirst: FullMapInput = { ladder, bank: upToPortion(1) };
  const block = buildFullMapInterlude(1, afterFirst);
  assert.ok(block, "после первой порции нет промежуточного блока");
  assert.equal(block.slice, "slice_full_map");
  assert.equal(block.afterPortion, 1);
  assert.equal(block.source, "lookup", "блок между порциями собирается без LLM");
  assert.equal(block.heading, fullMapInterlude(1).heading);
  assert.equal(block.paragraphs.length, 1);

  /*
   * Ключ полосы — та же полоса, что у координаты этой пары в профиле: у блока
   * своей арифметики нет. Оси первого блока стоят на парах координат 1 и 4.
   */
  const profile = buildFullMapProfile(afterFirst, synthesis);
  const keyOf = (coordinate: number): string => {
    const pointer = pointerOfBand(profile.coordinates[coordinate]?.band ?? null);
    const [low, middle, high] = fullMapInterlude(1).axes[0]!.keys;
    return (pointer === 1 ? high : pointer === -1 ? low : middle)!;
  };
  assert.equal(block.paragraphs[0], fullMapInterludeText(1, keyOf(1), keyOf(4)));

  const second = buildFullMapInterlude(2, { ladder, bank: upToPortion(2) });
  assert.ok(second, "после второй порции нет промежуточного блока");
  assert.equal(second.afterPortion, 2);
  assert.equal(second.heading, fullMapInterlude(2).heading);
  assert.ok(second.paragraphs[0]!.length > 120);
});

test("блок не выдаётся, пока на вопрос оси нет ответа: догадок в нём нет", () => {
  assert.equal(buildFullMapInterlude(1, { ladder }), null);

  const withoutPair = { ...upToPortion(1) };
  delete withoutPair[fullMapInterlude(1).axes[1]!.ids[0]!];
  assert.equal(buildFullMapInterlude(1, { ladder, bank: withoutPair }), null);

  // Ось второго блока — вариант категориального вопроса, а не полоса.
  const variant = fullMapInterlude(2).axes[1]!;
  assert.equal(variant.kind, "вариант");
  const spoiled = { ...upToPortion(2), [variant.ids[0]!]: "нет такого варианта" };
  assert.equal(buildFullMapInterlude(2, { ladder, bank: spoiled }), null);
});

// ── Один расчёт профиля ───────────────────────────────────────────────────────

test("профиль сводится одним расчётом: тот же, что по полному банку", () => {
  const afterMap = buildFullMapProfile(full, synthesis);
  const fromBank = buildProfileFromBank(demo, synthesis);

  for (const coordinate of rawContent.coordinates) {
    const mine = afterMap.coordinates[coordinate.id]!;
    const theirs = fromBank.coordinates[coordinate.id]!;
    assert.equal(mine.code, theirs.code, `координата ${coordinate.id}: код разошёлся с полным банком`);
    assert.equal(mine.value, theirs.value, `координата ${coordinate.id}: формулировка разошлась`);
    assert.equal(mine.band, theirs.band, `координата ${coordinate.id}: полоса разошлась`);
    assert.deepEqual(mine.sources, theirs.sources, `координата ${coordinate.id}: источники разошлись`);
  }
});

test("источники координат — идентификаторы банка: своей арифметики у добора нет", () => {
  const profile = buildFullMapProfile(full, synthesis);
  const allowed = /^(Q\d+|О\d+|L12)(:|$)/;

  for (const coordinate of Object.values(profile.coordinates)) {
    for (const source of coordinate.sources) {
      assert.match(source, allowed, `координата ${coordinate.id}: источник вне банка — ${source}`);
      assert.ok(!source.startsWith("L1:"), "ответ лестницы должен приходить идентификатором банка");
    }
  }
});

test("после добора координаты, которые лестница оставляла пустыми, получают значения", () => {
  const beforeMap = buildProfile(ladder, synthesis);
  const empty = unknownCoordinates(beforeMap).map((coordinate) => coordinate.id);
  assert.ok(empty.length >= 4, `лестница оставляет пустыми только ${empty.length} координат`);

  const afterMap = buildFullMapProfile(full, synthesis);
  assert.deepEqual(unknownCoordinates(afterMap).map((coordinate) => coordinate.id), []);
  for (const id of empty) {
    const coordinate = afterMap.coordinates[id]!;
    assert.ok(coordinate.value, `координата ${id} осталась без значения`);
    assert.ok(coordinate.code, `координата ${id} осталась без кода`);
    assert.ok(coordinate.sources.length > 0, `координата ${id} осталась без источника`);
  }
});

test("доборы срезов уточняют коды, а не пересчитывают числа заново", () => {
  const plain = buildFullMapProfile(full, synthesis);
  const withSlice = buildFullMapProfile(
    { ...full, slices: [{ slice: "slice_node_finish", answers: sliceAnswers("slice_node_finish") }] },
    synthesis,
  );

  assert.equal(plain.coordinates[11]?.code, "at_80", "по банку точка обрыва известна грубо");
  assert.equal(withSlice.coordinates[11]?.code, "pre_show_polish", "срез называет точку обрыва точнее");
  assert.ok(
    withSlice.coordinates[11]!.sources.length > plain.coordinates[11]!.sources.length,
    "ответы среза должны добавиться к источникам, а не заменить их",
  );
  assert.equal(withSlice.coordinates[2]?.code, plain.coordinates[2]?.code, "срез не трогает чужие координаты");
});

// ── Подтипы, флаги и потолки среза ────────────────────────────────────────────

test("подтипы кода и подтипы файла среза совпадают по составу", () => {
  assert.deepEqual(
    [...FULL_MAP_SUBTYPES].sort(),
    fullMap().subtypes.map((subtype) => subtype.code).sort(),
    "подтип есть или только в коде, или только в файле среза",
  );
});

test("подтипы добора приходят из контента и стоят на посчитанном профиле", () => {
  const profile = buildFullMapProfile(full, synthesis);
  const codes = profile.configurations.filter((item) => item.slice === "slice_full_map").map((item) => item.code);
  const known = fullMap().subtypes.map((subtype) => subtype.code);

  for (const code of codes) assert.ok(known.includes(code), `подтипа ${code} нет в файле среза`);
  assert.ok(codes.includes("map_full"), "карта собрана, а подтип не поставлен");
  assert.ok(codes.includes("map_thin_pairs"), "потолок пар не назван");
  assert.ok(codes.includes("map_motive_hypothesis"), "мотив на одном вопросе низкого веса остался без пометки");

  for (const configuration of profile.configurations) {
    const subtype = fullMap().subtypes.find((candidate) => candidate.code === configuration.code)!;
    assert.equal(configuration.value, subtype.text, `${configuration.code}: формулировка не из контента`);
    assert.ok(configuration.sources.length > 0, `${configuration.code}: находка без источников`);
  }
});

test("потолок из границ точности: координаты на двух вопросах выше medium не идут", () => {
  const thin = /\((\d[\d,\s]*)\)/.exec(
    fullMap().subtypes.find((subtype) => subtype.code === "map_thin_pairs")!.text,
  );
  const coordinates = [...thin![1]!.matchAll(/\d+/g)].map((match) => Number(match[0]));
  assert.deepEqual(coordinates, [1, 4, 12], "список пар в файле среза изменился");

  // Ответы, на которых основание решений по банку доходит до high.
  const strong: BankAnswers = { ...portionAnswers, Q9: 1, Q10: 5, Q11: "B" };
  assert.equal(buildProfileFromBank({ ...demo, Q9: 1, Q10: 5, Q11: "B" }).coordinates[4]?.confidence, "high");

  const profile = buildFullMapProfile({ ladder, bank: strong }, synthesis);
  for (const id of coordinates) {
    assert.notEqual(
      profile.coordinates[id]?.confidence,
      "high",
      `координата ${id}: потолок банка не применён, продукт пообещал точность, которой нет`,
    );
  }
  assert.equal(profile.coordinates[4]?.confidence, "medium");
});

test("расхождение ключевого способа входа со шкалами получает имя среза", () => {
  const profile = buildFullMapProfile(full, synthesis);
  assert.ok(profile.coordinates[13]?.flags.includes("self_report_mismatch_13"), "общее правило расхождения не сработало");
  assert.ok(profile.coordinates[13]?.flags.includes("entry_mismatch"), "подтип среза не поставлен");
  assert.ok(profile.flags.includes("entry_mismatch"));
  assert.equal(profile.coordinates[13]?.code, "self_starting", "значение остаётся по ключевому вопросу");

  /*
   * У демо-человека расхождение настоящее: ключевой Q29 говорит «начинаю сам», а
   * самоотчёт Q26 с лестницы — «нужен внешний срок». Когда самоотчёт и шкалы
   * входа согласны с ключевым, расхождения нет.
   */
  const agreed = buildFullMapProfile(
    { ladder: { ...ladder, L11: 2 }, bank: { ...portionAnswers, Q30: 1, Q31: 1 } },
    synthesis,
  );
  assert.ok(!agreed.flags.includes("entry_mismatch"), "расхождение поставлено там, где ответы согласны");
  assert.ok(!agreed.coordinates[13]?.flags.includes("entry_mismatch"));
});

test("короткие открытые оставляют сюжет и задачу периода без источника", () => {
  const short: BankAnswers = { ...portionAnswers, "О2": textLonger(5), "О3": textLonger(5) };
  const profile = buildFullMapProfile({ ladder, bank: short }, synthesis);

  assert.ok(
    profile.configurations.some((item) => item.code === "map_open_thin"),
    "короткие открытые не помечены",
  );
});

// ── Порог генерации ───────────────────────────────────────────────────────────

test("порог берётся на полном доборе, а пункты его — дословно из контента", () => {
  const profile = buildFullMapProfile(full, synthesis);
  const threshold = fullMapThreshold(full, profile, synthesis);

  assert.equal(threshold.passed, true, `порог не взят: ${threshold.missing.join(" · ")}`);
  assert.deepEqual(threshold.missing, []);
  assert.deepEqual(threshold.followUps, [], "порог взят — уточняющих не задаём");
  assert.equal(threshold.blocked, null);
  assert.equal(fullMap().threshold.checks.length, 5, "пунктов порога в файле среза стало другое число");
});

test("порог не взят: невыполненные пункты и уточняющие приходят из файла среза", () => {
  const checks = fullMap().threshold.checks;

  const halfway: FullMapInput = { ladder, bank: upToPortion(1) };
  const threshold = fullMapThreshold(halfway, buildFullMapProfile(halfway, synthesis), synthesis);
  assert.equal(threshold.passed, false);
  assert.ok(threshold.missing.includes(checks[0]!), "не сказано, что порции не пройдены");
  assert.ok(threshold.missing.includes(checks[2]!), "не сказано, что открытые не отвечены");
  assert.deepEqual(threshold.followUps, fullMap().threshold.followUps);
  for (const item of threshold.missing) assert.ok(checks.includes(item), `пункт «${item}» не из файла среза`);
});

test("пропуск больше трёх закрытых вопросов порога не берёт", () => {
  const closed = fullMapQuestions().filter((question) => question.type !== "открытый");
  const checks = fullMap().threshold.checks;

  const skip = (count: number): BankAnswers => {
    const answers = { ...portionAnswers };
    for (const question of closed.slice(0, count)) delete answers[question.id];
    return answers;
  };

  const three: FullMapInput = { ladder, bank: skip(3) };
  assert.ok(
    !fullMapThreshold(three, buildFullMapProfile(three, synthesis), synthesis).missing.includes(checks[0]!),
    "три пропущенных вопроса файл среза допускает",
  );

  const four: FullMapInput = { ladder, bank: skip(4) };
  assert.ok(
    fullMapThreshold(four, buildFullMapProfile(four, synthesis), synthesis).missing.includes(checks[0]!),
    "четыре пропущенных вопроса порог пропустил",
  );
});

test("без синтеза открытых порог не берётся: догадкой места не заполняются", () => {
  const profile = buildFullMapProfile(full);
  const threshold = fullMapThreshold(full, profile);

  assert.equal(threshold.passed, false);
  assert.ok(
    threshold.missing.includes(fullMap().threshold.checks[3]!),
    "координаты 15 и 16 без синтеза остались пустыми, а порог этого не заметил",
  );
});

// ── Итог по добору ────────────────────────────────────────────────────────────

test("отчёт по добору не собирается до конца третьей порции", () => {
  const afterFirst = fullMapReport({ ladder, bank: upToPortion(1) }, synthesis);
  assert.equal(afterFirst.ready, false, "отчёт собрался на середине добора");
  assert.equal(afterFirst.portion?.number, 2, "человек должен получить вторую порцию");
  assert.ok(afterFirst.interlude, "между порциями стоит промежуточный блок");
  assert.equal(afterFirst.interlude?.afterPortion, 1);

  const afterSecond = fullMapReport({ ladder, bank: upToPortion(2) }, synthesis);
  assert.equal(afterSecond.ready, false);
  assert.equal(afterSecond.portion?.number, 3);
  assert.equal(afterSecond.interlude?.afterPortion, 2);

  const start = fullMapReport({ ladder }, synthesis);
  assert.equal(start.portion?.number, 1);
  assert.equal(start.interlude, null, "до первой порции блоку не на чем стоять");

  const done = fullMapReport(full, synthesis);
  assert.equal(done.portion, null);
  assert.equal(done.interlude, null, "после последней порции идёт отчёт, а не блок");
  assert.equal(done.ready, true);
  assert.equal(done.profile.coordinates[1]?.code, "solitude", "профиль отдаётся вместе с итогом");
});
