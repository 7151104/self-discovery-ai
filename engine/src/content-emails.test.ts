/**
 * Тексты писем (E5-07).
 *
 * Главная проверка — не тон, а устройство: письмо не может быть единственным местом, где
 * живёт его содержание. Решение о сборе почты не принято (открытый вопрос 6), поэтому у
 * каждого письма обязательно названо место на странице, которое говорит то же самое.
 * Дальше — тон: на «ты», без поздравлений, без слова «тест», через реестр запретов.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { email, emailFooter, emailIds, emails, renderEmail } from "./emails.js";
import { uiCopyIds } from "./ui-copy.js";
import { scanTexts, describeHit } from "./forbidden.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const all = emails();
const bodies = all.flatMap((item) => item.body);

test("написаны четыре письма маршрута", () => {
  assert.deepEqual(emailIds(), ["EMAIL_PAGE_LINK", "EMAIL_SLICE_READY", "EMAIL_RECEIPT", "EMAIL_REFUND"]);
  assert.equal(emailFooter().length, 3, "общих частей подвала должно быть три");
  assert.throws(() => email("EMAIL_DIGEST"), /нет письма EMAIL_DIGEST/);
});

test("у каждого письма есть событие, тема, тело и место на странице без почты", () => {
  for (const item of all) {
    assert.ok(item.when.length > 10, `${item.id}: не сказано, по какому событию письмо уходит`);
    assert.ok(item.subject.length > 5 && item.subject.length < 60, `${item.id}: тема не по размеру`);
    assert.ok(!item.subject.endsWith("."), `${item.id}: тема заканчивается точкой`);
    assert.ok(item.body.length >= 3, `${item.id}: тело короче трёх абзацев`);
    assert.ok(
      item.withoutEmail.length > 20,
      `${item.id}: не названо место на странице, которое говорит то же самое без почты`,
    );
  }
});

test("письмо не единственный носитель: «без почты» указывает на страницу", () => {
  const known = new Set(uiCopyIds());
  for (const item of all) {
    const mentioned = [...item.withoutEmail.matchAll(/`(UI_[A-Z0-9_]+)`/g)].map((match) => match[1]!);
    for (const id of mentioned) {
      assert.ok(known.has(id), `${item.id}: ссылка на несуществующую строку интерфейса ${id}`);
    }
    assert.ok(
      /страниц|двер/i.test(item.withoutEmail),
      `${item.id}: «без почты» не называет места на странице`,
    );
  }
});

test("тексты писем проходят реестр запрещённых формулировок", () => {
  const texts = [...bodies, ...all.map((item) => item.subject), ...emailFooter().map((item) => item.text)];
  const found = scanTexts(texts, "интерфейс");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("слова «тест» в письмах нет, обращение на «ты», поздравлений нет", () => {
  const texts = [...bodies, ...all.map((item) => item.subject), ...emailFooter().map((item) => item.text)];
  for (const text of texts) {
    assert.ok(!/(?:^|[^а-яё])тест/i.test(text), `продукт назван тестом: ${text}`);
    assert.ok(!/(?:^|[^а-яё])(вы|вас|вам|ваш)/i.test(text), `обращение не на «ты»: ${text}`);
    assert.ok(!/поздравл|молодец|отличная работа/i.test(text), `поздравление в письме: ${text}`);
    assert.ok(!/!/.test(text), `восклицание в письме: ${text}`);
  }

  const second = /(?:^|[^а-яёa-z])(ты|теб[еяю]|тобой|тво[а-яё]+)(?:[^а-яёa-z]|$)/i;
  for (const item of all) {
    assert.ok(item.body.some((paragraph) => second.test(paragraph)), `${item.id}: письмо не обращается к человеку`);
  }
});

test("подстановки писем известны и проверяются на выходе", () => {
  const known = ["имя", "ссылка", "срез", "сумма"];
  for (const item of all) {
    for (const name of item.params) {
      assert.ok(known.includes(name), `${item.id}: неизвестная подстановка {${name}}`);
    }
  }

  const rendered = renderEmail("EMAIL_REFUND", { имя: "Игорь", срез: "Полная карта", сумма: 1990 });
  assert.match(rendered.subject, /Полная карта/);
  assert.ok(rendered.body.every((paragraph) => !/[{}]/.test(paragraph)), "в теле остались фигурные скобки");
  assert.ok(rendered.body.join(" ").includes("1990"));

  assert.throws(() => renderEmail("EMAIL_REFUND", { имя: "Игорь" }), /не передана подстановка \{срез\}/);
  assert.throws(
    () => renderEmail("EMAIL_PAGE_LINK", { имя: "Игорь", ссылка: "l", сумма: 1 }),
    /подстановки \{сумма\} в письме нет/,
  );
});

test("реквизиты в письмах — только подстановки из реестра юридических текстов", () => {
  const source = repoFile("content/emails.md");
  const listed = new Set(
    [...repoFile("content/legal/README.md").matchAll(/`\{\{([А-ЯЁA-Z_]+)\}\}`/g)].map((match) => match[1]!),
  );
  const used = [...source.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1]!);
  assert.ok(used.length >= 2, "в письмах нет ни одной подстановки реквизитов — что-то подставлено словами");
  for (const name of used) {
    assert.ok(listed.has(name), `{{${name}}} не описана в content/legal/README.md`);
  }
  assert.ok(!/\d{9,}/.test(source), "в письмах похоже на выдуманный реквизит");
  assert.ok(
    !/в течение \d+\s*(рабочих\s*)?(дн|календарн)/i.test(source),
    "в письмах назван срок, который технически не подтверждён",
  );
});

test("писем по расписанию и продажи в письмах нет", () => {
  for (const item of all) {
    assert.ok(
      !/(раз в неделю|каждый день|напомин|дайджест|рассылк)/i.test(item.when),
      `${item.id}: письмо уходит не по событию`,
    );
  }
  const texts = [...bodies, ...emailFooter().map((item) => item.text)];
  for (const text of texts) {
    assert.ok(!/(купи|открой за|успей|скидк|последний шанс|только сегодня)/i.test(text), `продажа в письме: ${text}`);
    assert.ok(!/ты не закончил|незавершённ/i.test(text), `напоминание о незаконченном: ${text}`);
  }
});

test("файл писем честно говорит, что почты может не быть", () => {
  const source = repoFile("content/emails.md");
  assert.match(source, /открытый вопрос 6/, "в файле нет ссылки на нерешённый вопрос о почте");
  assert.match(source, /## Если почта не собирается/, "нет раздела о том, что делать без почты");
  assert.ok(
    /ссылка на страницу остаётся носителем/i.test(source),
    "не сказано, что основной носитель — ссылка на страницу",
  );
});
