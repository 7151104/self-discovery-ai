/**
 * Скоринг полного банка на демо-человеке из examples/demo-person-answers.md.
 * Ответы читаются прямо из файла: второго набора данных в коде быть не должно.
 *
 * Правила — content/scoring-rules.md, раздел «Полный банк: точные правила».
 * Арифметика — общая с лестницей (`scoreCoordinate`), поэтому тесты лестницы
 * в `scoring.test.ts` работают как проверка того, что ветки не разъехались.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { buildProfile, buildProfileFromBank, scoreCoordinate, unknownCoordinates } from "./scoring.js";
import type { BankAnswers, LadderAnswers } from "./types.js";

const demoFile = readFileSync(new URL("../../examples/demo-person-answers.md", import.meta.url), "utf8");

/** Таблица «| Q | Ответ |» из examples/demo-person-answers.md. */
const demoAnswers = ((): BankAnswers => {
  const answers: BankAnswers = {};
  for (const line of demoFile.split("\n")) {
    const row = /^\|\s*(\d+)\s*\|\s*([A-G]|[1-5])\s*\|$/.exec(line.trim());
    if (!row) continue;
    const value = row[2] ?? "";
    answers[`Q${row[1]}`] = /^[1-5]$/.test(value) ? (Number(value) as 1 | 2 | 3 | 4 | 5) : value;
  }
  return answers;
})();

/** Сюжет и задача периода приходят от LLM: движок открытый текст не разбирает. */
const synthesis = {
  storyline: { value: "тащит один и бросает у финиша", code: "solo_then_drop", confidence: "medium" as const },
  periodTask: { value: "выход в видимость", code: "visibility", confidence: "medium" as const },
};

test("демо: в файле ответов лежат все 35 закрытых вопросов", () => {
  assert.equal(Object.keys(demoAnswers).length, 35);
});

test("полный банк закрывает все 16 координат, включая те, что лестница оставляет пустыми", () => {
  const profile = buildProfileFromBank(demoAnswers, synthesis);

  assert.deepEqual(unknownCoordinates(profile).map((coordinate) => coordinate.id), []);
  for (const id of [1, 6, 10, 12, 14, 16]) {
    const coordinate = profile.coordinates[id];
    assert.ok(coordinate?.value, `координата ${id} осталась без значения`);
    assert.ok(coordinate?.code, `координата ${id} осталась без кода`);
  }
});

test("координаты 15 и 16 без синтеза открытых ответов остаются пустыми", () => {
  const profile = buildProfileFromBank(demoAnswers);
  assert.deepEqual(
    unknownCoordinates(profile).map((coordinate) => coordinate.id),
    [15, 16],
    "открытый текст движок не интерпретирует",
  );
});

test("демо: значения ключевых координат совпадают с examples/", () => {
  const profile = buildProfileFromBank(demoAnswers, synthesis);

  assert.equal(profile.coordinates[2]?.code, "bursts");
  assert.equal(profile.coordinates[2]?.confidence, "high");

  assert.equal(profile.coordinates[11]?.code, "at_80");
  assert.equal(profile.coordinates[11]?.confidence, "high");

  assert.equal(profile.coordinates[9]?.code, "acceleration");
  assert.equal(profile.coordinates[8]?.code, "not_taken_seriously");
  assert.equal(profile.coordinates[7]?.code, "holds_long");
  assert.equal(profile.coordinates[3]?.code, "connections");
});

test("обратные вопросы инвертируются: без инверсии координата легла бы в другую сторону", () => {
  const profile = buildProfileFromBank(demoAnswers, synthesis);

  // Q1 = 5 «нужно время в одиночестве», Q2 = 2 «идеи появляются в разговоре» (обратный).
  assert.equal(profile.coordinates[1]?.code, "solitude");
  assert.equal(profile.coordinates[1]?.band, "high");

  // Q15 = 5 «тянет к незнакомому», Q16 = 2 «предпочитаю проверенное» (обратный).
  assert.equal(profile.coordinates[6]?.code, "novelty");
  assert.equal(profile.coordinates[6]?.band, "low");
});

test("расхождение самооценки и поведения: значение из поведенческого вопроса плюс флаг", () => {
  const profile = buildProfileFromBank(demoAnswers, synthesis);

  // Q23 = 4 «довожу почти всё» против ключевого Q24 = C «рвётся на 80%».
  assert.equal(profile.coordinates[11]?.code, "at_80");
  assert.ok(profile.coordinates[11]?.flags.includes("self_report_mismatch_11"));
  assert.ok(profile.flags.includes("self_report_mismatch_11"));

  const agreed = buildProfileFromBank({ ...demoAnswers, Q23: 2 }, synthesis);
  assert.equal(agreed.coordinates[11]?.code, "at_80");
  assert.ok(!agreed.flags.includes("self_report_mismatch_11"), "без расхождения флага быть не должно");
});

test("вопрос с ролью «низкий вес» сам по себе даёт только low", () => {
  const profile = buildProfileFromBank(demoAnswers, synthesis);
  assert.equal(profile.coordinates[10]?.code, "freedom");
  assert.equal(profile.coordinates[10]?.confidence, "low");
  assert.equal(profile.coordinates[10]?.value, "свобода", "значение берётся из текста варианта в банке");
});

test("уверенность растёт от числа согласных вопросов и падает от разброса", () => {
  const three = scoreCoordinate([
    { kind: "шкала", question: "Q17", value: 5, reversed: false },
    { kind: "шкала", question: "Q18", value: 5, reversed: false },
    { kind: "шкала", question: "Q19", value: 1, reversed: true },
  ]);
  assert.equal(three?.confidence, "high", "три согласных ответа с нулевым разбросом");
  assert.equal(three?.spread, 0);
  assert.equal(three?.mean, 5);

  const outlier = scoreCoordinate([
    { kind: "шкала", question: "Q17", value: 5, reversed: false },
    { kind: "шкала", question: "Q18", value: 4, reversed: false },
    { kind: "шкала", question: "Q19", value: 4, reversed: true },
  ]);
  assert.equal(outlier?.mean, (5 + 4 + 2) / 3, "обратный ответ 4 приводится к 2");
  assert.deepEqual(outlier?.conflicting, ["Q19:4"], "выбивающийся ответ виден отдельно");
  assert.equal(outlier?.confidence, "medium", "три ответа с одним выбивающимся дают medium");

  const single = scoreCoordinate([{ kind: "шкала", question: "Q17", value: 5, reversed: false }]);
  assert.equal(single?.confidence, "low", "один вопрос не даёт больше low");

  assert.equal(scoreCoordinate([]), null);
});

test("та же арифметика считает и лестницу: расхождений между ветками нет", () => {
  const ladder: LadderAnswers = { L1: "B", L2: "C", L3: "A", L4: "B", L5: "D", L6: 5, L7: 2, L8: "A", L9: 5, L10: 4, L11: 4 };
  const fromLadder = buildProfile(ladder);
  const fromBank = buildProfileFromBank(demoAnswers, synthesis);

  for (const id of [2, 3, 7, 8, 9, 11]) {
    assert.equal(
      fromBank.coordinates[id]?.code,
      fromLadder.coordinates[id]?.code,
      `координата ${id}: лестница и полный банк дали разные значения на одном человеке`,
    );
  }
  assert.ok(
    fromBank.coordinates[11]?.confidence === "high" && fromLadder.coordinates[11]?.confidence === "high",
    "по полному банку уверенность не может быть ниже, чем по лестнице",
  );
});

test("дата рождения в скоринг банка не попадает: источники — только вопросы банка", () => {
  const profile = buildProfileFromBank(demoAnswers, synthesis);
  const allowed = /^(Q\d+|О\d+|L12):/;
  for (const coordinate of Object.values(profile.coordinates)) {
    for (const source of coordinate.sources) {
      assert.ok(
        allowed.test(source) || source === "L12" || source === "О3",
        `координата ${coordinate.id} получила источник вне банка: ${source}`,
      );
    }
  }
});
