/**
 * E5-02: кризисные тексты, триггеры и контакты (`content/crisis.md`).
 *
 * Проверяется то, что можно проверить машиной: файл разбирается, тексты не
 * интерпретируют и не советуют, контакты живут в контенте, а корпус похожих
 * формулировок действительно не пересекается с триггерами целыми формами.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { rawExtraContent } from "./generated/content-extra.js";
import { scanTexts, describeHit } from "./forbidden.js";

const { triggers, safe, texts, contacts } = rawExtraContent.crisis;

const textOf = (id: string): string => {
  const found = texts.find((item) => item.id === id);
  assert.ok(found, `в реестре нет текста ${id}`);
  return found.text;
};

test("категории триггеров разобраны, у каждой есть уровень, действие и формы", () => {
  assert.ok(triggers.length >= 4, `категорий всего ${triggers.length}`);
  for (const trigger of triggers) {
    assert.match(trigger.id, /^CRISIS_[A-Z_]+$/);
    assert.ok(trigger.title.length > 5, `${trigger.id}: пустое название`);
    assert.ok(trigger.action.length > 10, `${trigger.id}: действие не описано`);
    assert.ok(trigger.forms.length >= 3, `${trigger.id}: слишком мало форм`);
  }
});

test("четыре категории из docs/08 покрыты: смерть, безвыходность, насилие, потеря", () => {
  const ids = triggers.map((trigger) => trigger.id);
  for (const id of ["CRISIS_SUICIDE", "CRISIS_HOPELESS", "CRISIS_VIOLENCE", "CRISIS_LOSS"]) {
    assert.ok(ids.includes(id), `нет категории ${id}`);
  }
  const blocking = triggers.filter((trigger) => trigger.level === "кризис");
  assert.equal(blocking.length, 3, "разбор обязаны блокировать ровно три категории");
  const loss = triggers.find((trigger) => trigger.id === "CRISIS_LOSS");
  assert.equal(loss?.level, "с оговоркой", "острая потеря помечена в docs/08 как зависящая от контекста");
});

test("формы триггеров не повторяются между категориями", () => {
  const seen = new Map<string, string>();
  for (const trigger of triggers) {
    for (const form of trigger.forms) {
      const key = form.toLowerCase().replace(/ё/g, "е");
      assert.ok(!seen.has(key), `форма «${form}» есть и в ${seen.get(key)}, и в ${trigger.id}`);
      seen.set(key, trigger.id);
    }
  }
});

test("корпус похожих формулировок не пересекается с триггерами", () => {
  assert.ok(safe.length >= 8, `в корпусе всего ${safe.length} формулировок`);
  const forms = new Set(triggers.flatMap((trigger) => trigger.forms.map((form) => form.toLowerCase())));
  for (const phrase of safe) {
    assert.ok(!forms.has(phrase.toLowerCase()), `«${phrase}» попала и в триггеры, и в безопасный корпус`);
  }
});

test("тексты есть на бесплатный вход и на платный срез", () => {
  const ids = texts.map((item) => item.id);
  for (const id of ["CRISIS_SUPPORT", "CRISIS_CONTACTS_LEAD", "CRISIS_CONTACTS", "CRISIS_NO_OFFER"]) {
    assert.ok(ids.includes(id), `нет текста ${id}`);
  }
  const paid = texts.filter((item) => item.where.some((place) => place.includes("платн")));
  assert.ok(paid.length >= 2, "на платном срезе нужен отдельный текст: про возврат и про сохранённые ответы");
  assert.match(textOf("CRISIS_PAID_MONEY_BACK"), /возврат|вернут/i, "текст на платном срезе молчит о деньгах");
});

test("кризисные тексты короткие", () => {
  for (const item of texts) {
    if (item.id === "CRISIS_CONTACTS") continue;
    const words = item.text.split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 25, `${item.id}: ${words} слов — длиннее, чем нужно в этом состоянии`);
  }
});

test("в кризисных текстах нет интерпретаций, советов и вопросов", () => {
  // Интерпретация — объяснение причины состояния; совет — предписание действия.
  const interpretation = /потому что|это значит|похоже, ты|у тебя (депресс|состояние)|причина в/i;
  const advice = /обратись|позвони|поговори|попробуй|отдохни|сделай|напиши кому|тебе (нужно|стоит|следует)/i;
  for (const item of texts) {
    assert.ok(!interpretation.test(item.text), `${item.id}: интерпретация состояния`);
    assert.ok(!advice.test(item.text), `${item.id}: совет вместо текста`);
    assert.ok(!item.text.includes("?"), `${item.id}: вопрос требует ответа, а человек ничего не должен`);
    assert.ok(!/[!]/.test(item.text), `${item.id}: восклицание в этом состоянии неуместно`);
  }
});

test("кризисные тексты проходят реестр запрещённых формулировок", () => {
  const found = scanTexts(
    texts.map((item) => item.text),
    "интерфейс",
  );
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("контакты живут в контенте: заполненные — с номером, пустые — подстановкой", () => {
  assert.ok(contacts.length >= 4, `контактов всего ${contacts.length}`);
  const filled = contacts.filter((contact) => contact.placeholder === null);
  assert.ok(filled.length >= 2, "на экране должны быть хотя бы экстренные службы и одна линия помощи");
  for (const contact of contacts) {
    assert.match(contact.id, /^CRISIS_CONTACT_[A-Z_]+$/);
    assert.ok(contact.title.length > 5, `${contact.id}: не описано, что это за линия`);
    assert.ok(
      contact.placeholder !== null || contact.value.length > 0,
      `${contact.id}: ни номера, ни места для подстановки`,
    );
  }
  for (const contact of contacts.filter((item) => item.placeholder !== null)) {
    assert.ok(!/\d{3,}/.test(contact.value), `${contact.id}: в пустую подстановку попал номер`);
  }
  for (const contact of filled) {
    assert.match(contact.value, /\d/, `${contact.id}: заполненная линия без номера`);
  }
});

test("текст контактов собирается из подстановки, а не из зашитого списка", () => {
  assert.match(textOf("CRISIS_CONTACTS"), /\{\{КОНТАКТЫ_ПОМОЩИ\}\}/);
  const disclaimer = rawExtraContent.disclaimers.find((item) => item.id === "DISCLAIMER_CRISIS_NO_REPORT");
  assert.ok(disclaimer, "нет дисклеймера про невыданный разбор");
  assert.match(disclaimer.text, /\{\{КОНТАКТЫ_ПОМОЩИ\}\}/, "дисклеймер и кризисный файл должны брать одну подстановку");
});
