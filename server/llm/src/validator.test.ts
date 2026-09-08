/**
 * E4-04: валидатор выхода на двух корпусах.
 *
 * Корпус плохих текстов собирается из самого реестра: по одной форме на каждую
 * группу, чьё совпадение обязано быть ошибкой. Список в тесте был бы вторым
 * источником правды и отстал бы от реестра на первой же новой группе.
 *
 * Корпус эталонов — тексты из `examples/` плюс все готовые тексты разбора,
 * которые продукт уже выдаёт людям на ступенях 1–3. Ложное отклонение здесь
 * важнее пропуска: валидатор, который режет хорошие тексты, выключат при первом
 * живом прогоне, и тогда не работает ни одна проверка.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GOOD_TEXT } from "./fixtures.js";
import { rawContent, rawExtraContent } from "./engine.js";
import { LADDER_FINAL, describeViolation, validateText, type ValidationRule } from "./validator.js";
import { readRepoFile, volumeOf } from "./content.js";
import { words } from "./text.js";

const { groups } = rawExtraContent.forbidden;

/** Группы, совпадение с которыми валидатор обязан считать отказом. */
const failing = groups.filter(
  (group) =>
    group.scopes.includes("разбор") &&
    (group.degree === "жёсткий" || group.degree === "по контексту" || group.id === "FORBIDDEN_BARNUM"),
);

/** Пример формы: звёздочка раскрывается окончанием, как в тестах реестра. */
const sampleOf = (form: string): string => (form.endsWith("*") ? `${form.slice(0, -1)}ый` : form);

/**
 * Плохой текст под форму. Отрицаний в обёртке нет намеренно: у степени
 * `по контексту` отрицание — законное исключение, и текст с ним обязан проходить.
 */
const badTextFor = (form: string): string => `Про тебя тут сказано так: ${sampleOf(form)}. Дальше идёт разбор.`;

test("корпус плохих текстов: каждая группа реестра отклоняется с указанием причины", () => {
  assert.ok(failing.length >= 13, `групп-ошибок собрано только ${failing.length}`);

  for (const group of failing) {
    const form = group.entries[0]!.forms[0]!;
    const verdict = validateText(badTextFor(form), { type: LADDER_FINAL, fragment: true });

    assert.equal(verdict.ok, false, `${group.id}: форма «${form}» не отклонена`);
    assert.ok(
      verdict.violations.some((violation) => violation.group === group.id),
      `${group.id}: в причинах отказа не названа группа — ${verdict.violations.map(describeViolation).join("; ")}`,
    );
    for (const violation of verdict.violations) {
      assert.ok(violation.detail.length > 10, `${group.id}: причина отказа без объяснения`);
    }
  }
});

test("названия методик и Barnum-шаблоны отклоняются под своими правилами", () => {
  const cases: { text: string; rule: ValidationRule }[] = [
    { text: "Ты по своей сути соционик и это видно по ответам.", rule: "методика" },
    { text: "Твой психотип виден по первому ответу.", rule: "методика" },
    { text: "У тебя огромный потенциал и богатый внутренний мир.", rule: "Barnum" },
    { text: "Многие люди в глубине души чувствуют то же самое.", rule: "Barnum" },
    { text: "Иногда ты бываешь резким, а порой ты закрываешься.", rule: "Barnum" },
    { text: "На твоём месте я бы закрыл этот вопрос до конца недели.", rule: "совет" },
    { text: "Просто начни с малого и поставь границы.", rule: "совет" },
  ];

  for (const { text, rule } of cases) {
    const verdict = validateText(text, { type: LADDER_FINAL, fragment: true });
    assert.equal(verdict.ok, false, `не отклонено: ${text}`);
    assert.ok(
      verdict.violations.some((violation) => violation.rule === rule),
      `${text} — ожидалось правило «${rule}», получено ${verdict.violations.map((v) => v.rule).join(", ")}`,
    );
  }
});

test("объём проверяется по машинному типу отчёта, а не одним числом", () => {
  const volume = volumeOf(LADDER_FINAL);
  const filler = (count: number): string =>
    `${Array.from({ length: count }, (_value, index) => `слово${index}`).join(" ")}.\n\nвторой абзац.\n\nтретий абзац.`;

  const short = validateText(filler(50), { type: LADDER_FINAL });
  assert.equal(short.ok, false);
  assert.ok(short.violations.some((violation) => violation.rule === "объём"));

  const long = validateText(filler(volume.max + 50), { type: LADDER_FINAL });
  assert.equal(long.ok, false);
  assert.ok(long.violations.some((violation) => violation.rule === "объём"));

  assert.ok(
    validateText(GOOD_TEXT, { type: LADDER_FINAL }).ok,
    "хороший текст обязан пройти проверку объёма и каркаса",
  );

  const asFullReport = validateText(GOOD_TEXT, { type: "бесплатный_полный" });
  assert.equal(asFullReport.ok, false, "тот же текст коротковат для другого типа отчёта");
  assert.ok(asFullReport.violations.some((violation) => violation.rule === "объём"));
});

test("каркас финала лестницы: три абзаца и ни одного списка действий", () => {
  const paragraphsOf = (count: number): string => {
    const size = Math.ceil(volumeOf(LADDER_FINAL).min / count) + 5;
    return Array.from({ length: count }, () =>
      Array.from({ length: size }, (_value, index) => `слово${index}`).join(" "),
    ).join("\n\n");
  };

  const two = validateText(paragraphsOf(2), { type: LADDER_FINAL });
  assert.ok(two.violations.some((violation) => violation.rule === "каркас"));

  const withList = `${GOOD_TEXT}\n\n1. Назови дату показа\n2. Отдай финишную часть`;
  const listed = validateText(withList, { type: LADDER_FINAL });
  assert.equal(listed.ok, false);
  assert.ok(listed.violations.some((violation) => violation.rule === "совет"));
});

test("подозрение остаётся человеку: предупреждение не отклоняет текст", () => {
  const verdict = validateText("Больше всего энергии у тебя на замысле, и тебе нужно это учитывать.", {
    type: LADDER_FINAL,
    fragment: true,
  });

  assert.equal(verdict.ok, true, "формы с двойным чтением отклонять нельзя: их различает человек");
  assert.ok(verdict.warnings.length >= 2, "но человек обязан их увидеть");
  assert.ok(verdict.warnings.every((warning) => warning.rule === "вода"));
});

/** Абзацы эталонного разбора: заголовки и служебные строки не текст о человеке. */
function referenceParagraphs(): string[] {
  return readRepoFile("examples/demo-report-output.md")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("#") && !part.startsWith("- [ ]") && words(part).length > 5);
}

/** Все готовые тексты разбора, которые продукт уже выдаёт людям. */
function productTexts(): string[] {
  return [
    ...Object.values(rawContent.step1.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
    ...Object.values(rawContent.step2.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
    ...Object.values(rawContent.step2.scales).flatMap((branches) => branches.map((b) => b.text)),
    ...rawContent.step1.matrix.map((row) => row.text),
    ...rawContent.step2.matrix.map((row) => row.text),
    ...rawContent.step3.nodes.map((node) => node.text),
    ...rawExtraContent.interludes.flatMap((interlude) => interlude.pairs.map((pair) => pair.text)),
  ];
}

test("эталоны из examples/ не отклоняются ни один", () => {
  const texts = referenceParagraphs();
  assert.ok(texts.length >= 8, `из эталона собрано только ${texts.length} абзацев`);

  const rejected = texts
    .map((text) => ({ text, verdict: validateText(text, { type: "бесплатный_полный", fragment: true }) }))
    .filter(({ verdict }) => !verdict.ok);

  assert.deepEqual(
    rejected.map(({ text, verdict }) => `${verdict.violations.map(describeViolation).join("; ")} в: ${text.slice(0, 60)}`),
    [],
    "ложное отклонение эталона дороже пропуска: такой валидатор выключат",
  );
});

test("готовые тексты разбора продукта не отклоняются ни один", () => {
  const texts = productTexts();
  assert.ok(texts.length >= 90, `текстов продукта собрано только ${texts.length}`);

  const rejected = texts
    .map((text) => ({ text, verdict: validateText(text, { type: LADDER_FINAL, fragment: true }) }))
    .filter(({ verdict }) => !verdict.ok);

  assert.deepEqual(
    rejected.map(({ text, verdict }) => `${verdict.violations.map(describeViolation).join("; ")} в: ${text.slice(0, 60)}`),
    [],
  );
});

test("Barnum-форма под отрицанием не отклоняется, без отрицания — отклоняется", () => {
  const contrast = "Ты держишь ровный темп, и это редкость: большинство людей так не умеет.";
  const claim = "Большинство людей узнают тут себя, и ты тоже.";

  const excused = validateText(contrast, { type: LADDER_FINAL, fragment: true });
  assert.equal(excused.ok, true, "сравнение с другими под отрицанием — законный ход, а не Barnum");
  assert.ok(excused.warnings.some((warning) => warning.group === "FORBIDDEN_BARNUM"));

  const rejected = validateText(claim, { type: LADDER_FINAL, fragment: true });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.violations.some((violation) => violation.rule === "Barnum"));
});
