/**
 * Юридические тексты (E5-08).
 *
 * Проверяется то, что можно проверить машиной: документы существуют, содержат
 * требуемое `docs/08-legal-safety.md`, дисклеймер о немедицинском характере стоит
 * внутри продукта, а не только в подвале, и ни один реквизит не выдуман — все
 * реквизиты остаются местами для подстановки, перечисленными в реестре.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawExtraContent } from "./generated/content-extra.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const LEGAL_FILES = [
  "content/legal/README.md",
  "content/legal/privacy-policy.md",
  "content/legal/consent.md",
  "content/legal/offer.md",
  "content/legal/disclaimers.md",
] as const;

const legal = new Map(LEGAL_FILES.map((path) => [path, repoFile(path)]));
const text = (path: (typeof LEGAL_FILES)[number]): string => legal.get(path)!;

const disclaimers = rawExtraContent.disclaimers;
const byId = new Map(disclaimers.map((item) => [item.id, item]));

test("каталог content/legal содержит все документы из docs/08-legal-safety.md", () => {
  for (const path of LEGAL_FILES) {
    assert.ok(text(path).length > 1000, `${path}: документ пустой или обрывочный`);
  }
});

test("политика закрывает требования 152-ФЗ", () => {
  const policy = text("content/legal/privacy-policy.md");
  const required: [string, RegExp][] = [
    ["оператор и его реквизиты", /Оператор:/],
    ["перечень обрабатываемых данных", /Какие данные обрабатываются/],
    ["цели обработки", /Зачем данные обрабатываются/],
    ["правовые основания", /На каком основании/],
    ["согласие как основание", /Твоё согласие/],
    ["передача третьим лицам", /Кому данные передаются/],
    ["место хранения", /Место хранения/],
    ["трансграничная передача", /Трансграничная передача/],
    ["сроки хранения", /Сколько данные хранятся/],
    ["права субъекта", /Что ты можешь сделать/],
    ["отзыв согласия", /Отозвать согласие/],
    ["удаление профиля", /Удалить профиль/],
    ["выгрузка данных", /Получить выгрузку/],
    ["обжалование в Роскомнадзоре", /Роскомнадзоре/],
    ["меры защиты", /Как данные защищаются/],
    ["порядок изменения политики", /Изменения политики/],
    ["изоляция даты рождения", /Дата рождения не участвует/],
    ["отсутствие детских данных", /Данные о детях не запрашиваются/],
  ];
  for (const [what, pattern] of required) {
    assert.ok(pattern.test(policy), `в политике нет обязательного раздела: ${what}`);
  }
});

test("согласие собирается до сохранения ответов и отзывается", () => {
  const consent = text("content/legal/consent.md");
  assert.match(consent, /до первого сохранения ответов/);
  assert.match(consent, /Отзыв:/);
  assert.match(consent, /Цели обработки/);
  assert.match(consent, /Действия с данными/);
  assert.match(consent, /Срок действия/);
  assert.match(consent, /не медицинская, не психологическая и не психиатрическая помощь/);
  // Отметка не должна стоять проставленной заранее — иначе согласие не согласие.
  assert.match(consent, /не стоит проставленной заранее/);
});

test("оферта закрывает предмет, цену, оказание услуги, возврат и ограничения", () => {
  const offer = text("content/legal/offer.md");
  const required: [string, RegExp][] = [
    ["исполнитель и реквизиты", /Исполнитель:/],
    ["момент принятия оферты", /считается принятым/],
    ["предмет", /Что покупается/],
    ["что не входит", /Что не входит/],
    ["цена и оплата", /Цена и оплата/],
    ["документ об оплате", /Документ об оплате/],
    ["порядок оказания", /Как услуга оказывается/],
    ["момент оказания", /считается оказанной/],
    ["новые ответы до разбора", /разбор без новых ответов не\s+собирается/],
    ["кризисное исключение", /Когда разбор не выдаётся/],
    ["возврат", /Возврат/],
    ["права на текст", /Права на текст/],
    ["ограничения ответственности", /Ограничения/],
    ["порядок споров", /Обращения и споры/],
    ["порядок изменения оферты", /Изменения оферты/],
  ];
  for (const [what, pattern] of required) {
    assert.ok(pattern.test(offer), `в оферте нет обязательного раздела: ${what}`);
  }
  assert.ok(!/гарантиру/i.test(offer), "оферта обещает гарантию, которой у продукта нет");
});

test("дисклеймер о немедицинском характере вынесен в продукт, а не в подвал", () => {
  const notMedical = byId.get("DISCLAIMER_NOT_MEDICAL");
  assert.ok(notMedical, "нет дисклеймера о немедицинском характере");
  const places = notMedical!.where;
  assert.ok(places.length >= 3, "дисклеймер показан меньше чем в трёх местах");
  const inProduct = places.filter((place) => place !== "подвал");
  assert.ok(inProduct.length >= 2, `дисклеймер живёт только в подвале: ${places.join(" · ")}`);
  assert.ok(
    places.some((place) => place.includes("вход")),
    "дисклеймер не виден до первого вопроса",
  );
  assert.ok(
    places.some((place) => place.includes("оплат")),
    "дисклеймер не виден на экране оплаты",
  );
});

test("требования docs/08-legal-safety.md закрыты дисклеймерами", () => {
  const required: [string, RegExp][] = [
    ["не медицинская и не психологическая помощь", /не медицинская и не психологическая помощь/],
    ["не замена специалиста", /не заменяет работу с психологом/],
    ["информационный характер, не диагноз", /не ставит диагнозов/],
    ["нет предсказаний событий и сроков", /Предсказаний здесь нет/],
    ["дата рождения ничего не решает", /Ни один вывод о тебе на ней не строится/],
    ["результат не обещан", /Результата мы не обещаем/],
    ["кризис: разбор не выдаётся", /Разбор сейчас не выдаётся/],
  ];
  const all = disclaimers.map((item) => item.text).join("\n");
  for (const [what, pattern] of required) {
    assert.ok(pattern.test(all), `нет дисклеймера: ${what}`);
  }
  for (const item of disclaimers) {
    assert.ok(item.text.length > 40, `${item.id}: текст слишком короткий, чтобы быть понятным`);
    assert.ok(!/\bвы\b|ваш/i.test(item.text), `${item.id}: обращение не на «ты»`);
    assert.ok(!/(?:^|[^а-яё])тест(?:[^а-яё]|$)/i.test(item.text), `${item.id}: продукт назван тестом`);
  }
});

test("кризисный дисклеймер не показывается вместе с предложением купить", () => {
  const crisis = byId.get("DISCLAIMER_CRISIS_NO_REPORT");
  assert.ok(crisis, "нет кризисного дисклеймера");
  for (const place of crisis!.where) {
    assert.ok(place.startsWith("вместо"), `кризисный дисклеймер стоит рядом с блоком, а не вместо: ${place}`);
  }
  assert.match(crisis!.text, /\{\{КОНТАКТЫ_ПОМОЩИ\}\}/, "в кризисном дисклеймере нет контактов помощи");
});

test("реквизитов в текстах нет: только подстановки из реестра", () => {
  const listed = new Set(
    [...text("content/legal/README.md").matchAll(/`\{\{([А-ЯЁA-Z_]+)\}\}`/g)].map((match) => match[1]!),
  );
  assert.ok(listed.size >= 18, `в реестре подстановок только ${listed.size} строк — таблица сломалась`);

  const used = new Set<string>();
  for (const path of LEGAL_FILES) {
    const body = path === "content/legal/README.md" ? "" : text(path);
    for (const match of body.matchAll(/\{\{([^}]*)\}\}/g)) {
      const name = match[1]!;
      assert.match(name, /^[А-ЯЁA-Z_]+$/, `${path}: подстановка «${name}» записана не единообразно`);
      assert.ok(listed.has(name), `${path}: подстановка {{${name}}} не описана в content/legal/README.md`);
      used.add(name);
    }
  }
  for (const name of listed) {
    assert.ok(used.has(name), `{{${name}}} описана в реестре, но нигде не используется`);
  }
});

test("выдуманных реквизитов и сроков в юридических текстах нет", () => {
  for (const path of LEGAL_FILES) {
    const body = text(path);
    assert.ok(!/\d{9,}/.test(body), `${path}: похоже на выдуманный ИНН, ОГРН или номер счёта`);
    assert.ok(!/ИНН\s*\d/.test(body), `${path}: ИНН подставлен числом вместо места для подстановки`);
    assert.ok(
      !/в течение \d+\s*(рабочих\s*)?(дн|календарн)/i.test(body),
      `${path}: назван срок, который технически не подтверждён`,
    );
  }
});

test("юридические тексты не называют методик и не звучат как реклама", () => {
  const forbidden =
    /(MBTI|эннеаграмм|Human Design|астролог|нумеролог|Big Five|соционик|предназначен|вибраци|карм[аеуы]|исцелен|уникальн\w+ методик)/i;
  for (const path of LEGAL_FILES) {
    assert.ok(!forbidden.test(text(path)), `${path}: методика или обещание в юридическом тексте`);
  }
});
