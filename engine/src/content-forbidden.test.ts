/**
 * E5-01: реестр запрещённых формулировок (`content/forbidden.md`).
 *
 * Проверяется и сам реестр (степени, области, исключения), и то, что готовые
 * тексты продукта его проходят. Тексты, которые перечисляют запреты, в проверку
 * не попадают: сканируется только то, что разобрал сборщик, а не markdown целиком.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";
import { scanText, scanTexts, describeHit } from "./forbidden.js";
import type { ForbiddenScope } from "./forbidden.js";

const { groups, allowed } = rawExtraContent.forbidden;

const forms = groups.flatMap((group) => group.entries.flatMap((entry) => entry.forms));

/** Тексты, которые говорят о человеке. */
const analysisTexts = (): string[] => [
  ...Object.values(rawContent.step1.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
  ...Object.values(rawContent.step2.branches).flatMap((branches) => Object.values(branches).map((b) => b.text)),
  ...Object.values(rawContent.step2.scales).flatMap((branches) => branches.map((b) => b.text)),
  ...rawContent.step1.matrix.map((row) => row.text),
  ...rawContent.step2.matrix.map((row) => row.text),
  ...rawContent.step3.nodes.map((node) => node.text),
  ...rawContent.step0.metaphors.map((metaphor) => metaphor.text),
  ...rawExtraContent.interludes.flatMap((interlude) => interlude.pairs.map((pair) => pair.text)),
];

/** Формулировки вопросов, вариантов и полюсов шкал. */
const questionTexts = (): string[] => [
  ...rawContent.questions.flatMap((question) => [
    question.text,
    ...question.options.map((option) => option.text),
    ...(question.scale ? [question.scale.low, question.scale.high] : []),
  ]),
  ...rawContent.bank.flatMap((question) => [question.text, ...question.options.map((option) => option.text)]),
];

/** Тексты, которые человек видит вокруг разбора. */
const interfaceTexts = (): string[] => [
  ...Object.values(rawExtraContent.doors.nodes),
  ...Object.values(rawExtraContent.doors.slices),
  ...Object.values(rawExtraContent.doors.applied).flatMap((row) =>
    Object.values(row).filter((label): label is string => label !== null),
  ),
  ...rawExtraContent.disclaimers.map((disclaimer) => disclaimer.text),
  ...rawContent.slices.map((slice) => slice.promise),
  ...Object.values(rawContent.leads),
];

const corpus: Record<ForbiddenScope, () => string[]> = {
  разбор: analysisTexts,
  вопросы: questionTexts,
  интерфейс: interfaceTexts,
  промпты: () => [],
};

test("реестр разобран: у каждой группы есть степень, область и непустые строки", () => {
  assert.ok(groups.length >= 10, `в реестре только ${groups.length} групп`);
  for (const group of groups) {
    assert.match(group.id, /^FORBIDDEN_[A-Z_]+$/, `идентификатор группы: ${group.id}`);
    assert.ok(group.title.length > 5, `${group.id}: пустое название группы`);
    assert.ok(group.scopes.length > 0, `${group.id}: не указана область`);
    assert.ok(group.entries.length > 0, `${group.id}: нет строк`);
    for (const entry of group.entries) {
      assert.ok(entry.forms.length > 0, `${group.id}: строка без форм`);
      assert.ok(entry.reason.length > 20, `${group.id}: обоснование «${entry.reason}» слишком короткое`);
    }
  }
  assert.ok(allowed.length >= 8, `формулировок-исключений всего ${allowed.length}`);
});

test("степень запрета различает запрет и исключение", () => {
  for (const group of groups) {
    for (const entry of group.entries) {
      if (group.degree === "жёсткий") {
        assert.equal(entry.exceptions.length, 0, `${group.id}: у жёсткого запрета есть исключение`);
      }
    }
  }
  const byDegree = (degree: string): number => groups.filter((group) => group.degree === degree).length;
  assert.ok(byDegree("жёсткий") > 0, "нет ни одной группы жёсткого запрета");
  assert.ok(byDegree("по контексту") > 0, "нет ни одной группы, зависящей от контекста");
  assert.ok(byDegree("подозрение") > 0, "нет ни одной группы-подозрения");
});

test("каждая форма реестра находится в собственном тексте", () => {
  for (const group of groups) {
    for (const entry of group.entries) {
      for (const form of entry.forms) {
        const sample = form.endsWith("*") ? `${form.slice(0, -1)}ый` : form;
        const hits = scanText(sample, group.scopes[0]!, { degrees: [group.degree], group: group.id });
        assert.ok(hits.length > 0, `${group.id}: форма «${form}» не находит саму себя`);
      }
    }
  }
});

test("жёсткий запрет исключений не признаёт, контекстный — признаёт", () => {
  const hard = scanText("Здесь появляется MBTI", "разбор", { group: "FORBIDDEN_METHODS" });
  assert.equal(hard.length, 1, "жёсткий запрет не сработал");
  assert.equal(hard[0]!.degree, "жёсткий");

  const excused = scanText("Это не является диагнозом и не заменяет специалиста.", "интерфейс", {
    group: "FORBIDDEN_MEDICAL",
  });
  assert.deepEqual(excused, [], "отрицание должно снимать контекстный запрет");

  const bare = scanText("Здесь ставится диагноз.", "интерфейс", { group: "FORBIDDEN_MEDICAL" });
  assert.equal(bare.length, 1, "утверждение без отрицания обязано ловиться");
  assert.equal(bare[0]!.degree, "по контексту");
});

test("подозрение не считается ошибкой по умолчанию", () => {
  const barnum = "Многие люди в глубине души этого не замечают";
  assert.deepEqual(scanText(barnum, "разбор"), [], "подозрение попало в ошибки");
  const flagged = scanText(barnum, "разбор", { degrees: ["подозрение"] });
  assert.ok(flagged.length >= 2, "Barnum-шаблоны не находятся даже как подозрение");
});

test("границы слова: часть слова за запрет не считается", () => {
  assert.deepEqual(scanText("В кармане лежит телефон", "разбор", { group: "FORBIDDEN_WORLDVIEW" }), []);
  assert.equal(scanText("Это карма", "разбор", { group: "FORBIDDEN_WORLDVIEW" }).length, 1);
  assert.deepEqual(scanText("Он выбирает выход", "разбор", { group: "FORBIDDEN_FORMAL" }), []);
  assert.equal(scanText("Вы выбираете сами", "разбор", { group: "FORBIDDEN_FORMAL" }).length, 1);
});

test("готовые тексты разбора проходят реестр", () => {
  const found = scanTexts(analysisTexts(), "разбор");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("формулировки вопросов проходят реестр", () => {
  const found = scanTexts(questionTexts(), "вопросы");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("тексты вокруг разбора проходят реестр", () => {
  const found = scanTexts(interfaceTexts(), "интерфейс");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("области реестра покрыты текстами, кроме промптов", () => {
  for (const scope of ["разбор", "вопросы", "интерфейс"] as ForbiddenScope[]) {
    assert.ok(corpus[scope]().length > 0, `для области ${scope} не собрано ни одного текста`);
    assert.ok(
      groups.some((group) => group.scopes.includes(scope)),
      `область ${scope} не используется ни одной группой`,
    );
  }
});

test("запреты из документов и промптов доехали до реестра", () => {
  const expected = [
    "MBTI",
    "эннеаграм*",
    "предназначен*",
    "вибраци*",
    "миссия",
    "многие люди",
    "в глубине души",
    "перфекционизм*",
    "прокрастинаци*",
    "синдром самозванца",
    "выгорани*",
    "абьюз*",
    "токсичн*",
    "газлайтинг*",
    "идеальная пара",
    "гарантир*",
    "исцелен*",
    "поздравля*",
    "тест",
    "ваш результат",
    "координата",
  ];
  for (const form of expected) {
    assert.ok(forms.includes(form), `форма «${form}» не попала в реестр`);
  }
});
