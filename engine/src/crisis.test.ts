/**
 * E2-07: кризисный детектор.
 *
 * Проверка идёт с двух сторон, и обе обязательны. Первая — корпус триггерных
 * формулировок из `content/crisis.md`: пропустить кризис нельзя. Вторая — корпус
 * похожих, но не кризисных формулировок из того же файла: детектор, режущий
 * обычные ответы, отключат при первом живом прогоне, и тогда первая половина
 * проверки перестанет значить что-либо вообще.
 *
 * Отдельно проверяется страница: при срабатывании в `PageState` нет ни блока
 * ступени 4, ни платного предложения (`docs/08-legal-safety.md`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rawExtraContent } from "./generated/content-extra.js";
import { buildPage } from "./page.js";
import {
  crisisBlocks,
  crisisContacts,
  crisisNotice,
  crisisPlaceTexts,
  crisisPublishable,
  detectCrisis,
  CRISIS_PLACES,
} from "./crisis.js";
import type { LadderAnswers } from "./types.js";

const { triggers, safe, texts, contacts } = rawExtraContent.crisis;

/** Форма реестра как её пишет человек: звёздочка — основа слова. */
const asWritten = (form: string): string => (form.endsWith("*") ? `${form.slice(0, -1)}ось` : form);

/**
 * Форма внутри ответа. Обёртка нейтральная: ни одна её часть не стоит ни в
 * реестре триггеров, ни в корпусе похожих формулировок, поэтому находка в тесте
 * приходит только от самой формы.
 */
const inAnswer = (form: string): string => `Пишу как есть: ${asWritten(form)}. Дальше сам не понимаю.`;

const triggerOf = (id: string) => {
  const found = triggers.find((trigger) => trigger.id === id);
  assert.ok(found, `в реестре нет категории ${id}`);
  return found;
};

const formOf = (id: string): string => asWritten(triggerOf(id).forms[0]!);

// ── Корпус триггеров ──────────────────────────────────────────────────────────

test("каждая форма реестра ловится и относится к своей категории", () => {
  for (const trigger of triggers) {
    for (const form of trigger.forms) {
      const result = detectCrisis(inAnswer(form));
      assert.ok(
        result.hits.some((hit) => hit.category === trigger.id),
        `форма «${form}» из ${trigger.id} не сработала`,
      );
      assert.ok(
        result.support,
        `форма «${form}»: без текста поддержки страница молчит о происходящем`,
      );
    }
  }
});

test("категория уровня «кризис» останавливает разбор в одиночку", () => {
  for (const trigger of triggers.filter((candidate) => candidate.level === "кризис")) {
    for (const form of trigger.forms) {
      assert.equal(crisisBlocks(inAnswer(form)), true, `форма «${form}» из ${trigger.id} разбор не остановила`);
    }
  }
});

test("категория «с оговоркой» одна разбор не блокирует, но тему из разбора убирает", () => {
  for (const trigger of triggers.filter((candidate) => candidate.level === "с оговоркой")) {
    for (const form of trigger.forms) {
      const result = detectCrisis(inAnswer(form));
      assert.equal(result.blocked, false, `форма «${form}» из ${trigger.id} отняла разбор в одиночку`);
      assert.equal(result.support, true, `форма «${form}»: текст поддержки должен стоять рядом с разбором`);
      assert.deepEqual(result.avoid, [trigger.id], `форма «${form}»: названную тему разбор трогать не должен`);
      assert.equal(result.reason, null);
    }
  }
});

test("вторая сработавшая категория разбор блокирует", () => {
  const loss = formOf("CRISIS_LOSS");
  const hopeless = formOf("CRISIS_HOPELESS");

  const alone = detectCrisis(inAnswer(loss));
  assert.equal(alone.blocked, false);

  const together = detectCrisis(`${inAnswer(loss)} ${inAnswer(hopeless)}`);
  assert.equal(together.blocked, true, "две категории в одном ответе разбор не остановили");
  assert.equal(together.categories.length, 2);
  assert.deepEqual(together.avoid, [], "заблокированному разбору нечего обходить: его нет");
});

test("причина блокировки — действие из контента, а не текст из кода", () => {
  const result = detectCrisis(inAnswer(formOf("CRISIS_SUICIDE")));
  assert.equal(result.reason, triggerOf("CRISIS_SUICIDE").action);
  assert.ok(result.reason && result.reason.length > 10);
});

test("решение зависит только от текста: регистр и ё роли не играют", () => {
  const form = formOf("CRISIS_HOPELESS");
  const plain = inAnswer(form);
  assert.equal(crisisBlocks(plain), true);
  assert.equal(crisisBlocks(plain.toUpperCase()), true);
  assert.equal(crisisBlocks(plain.replace(/е/g, "ё")), true, "ё и е считаются одной буквой");
  assert.equal(crisisBlocks(""), false);
  assert.equal(crisisBlocks("   "), false);
});

// ── Корпус похожих, но не кризисных формулировок ──────────────────────────────

test("корпус похожих формулировок разбор не блокирует и находок не даёт", () => {
  assert.ok(safe.length >= 8, `в корпусе всего ${safe.length} формулировок`);
  for (const phrase of safe) {
    const result = detectCrisis(`Сегодня было так: ${phrase}. Иду дальше.`);
    assert.deepEqual(
      result.hits.map((hit) => `${hit.category}: ${hit.form}`),
      [],
      `«${phrase}» принята за кризис`,
    );
    assert.equal(result.blocked, false, `«${phrase}» отняла разбор`);
    assert.equal(result.support, false, `«${phrase}»: текст поддержки здесь не к месту`);
  }
});

test("весь корпус в одном ответе разбор не блокирует", () => {
  // Одна протечка на длинном тексте даёт вторую категорию и блокировку по правилу
  // «две категории», поэтому корпус целиком — самая жёсткая проверка порога.
  const answer = safe.map((phrase) => `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`).join(" ");
  const result = detectCrisis(answer);
  assert.deepEqual(result.categories, [], "детектор нашёл кризис там, где контент говорит обратное");
  assert.equal(result.blocked, false);
});

test("обычный тяжёлый ответ про работу и усталость проходит целиком", () => {
  const answers = [
    "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша.",
    "Убил на это два года и выгорел, сил больше нет, хочу уехать и не отвечать хотя бы неделю.",
    "Проект умер, тупик в проекте, всё это меня добивает, но каждое утро всё равно сажусь и делаю.",
    "Устал так, что не могу читать вечером, умираю от скуки на созвонах и злюсь на себя за то, что молчу.",
  ];
  for (const answer of answers) {
    assert.equal(crisisBlocks(answer), false, `обычный ответ срезан: «${answer}»`);
  }
});

// ── Что показывается вместо разбора ───────────────────────────────────────────

test("состав кризисных текстов сверен с колонкой «Где показывается» реестра", () => {
  const known = new Set(texts.map((item) => item.id));
  for (const place of CRISIS_PLACES) {
    const ids = crisisPlaceTexts(place);
    assert.ok(ids.length >= 4, `${place}: слишком мало текстов`);
    for (const id of ids) assert.ok(known.has(id), `${place}: текста ${id} нет в реестре`);
    assert.equal(new Set(ids).size, ids.length, `${place}: текст повторяется`);
    assert.ok(ids.includes("CRISIS_SUPPORT"), `${place}: нет текста поддержки`);
    assert.ok(ids.includes("CRISIS_NO_OFFER"), `${place}: страница молчит об отсутствии платного`);
  }

  const paid = crisisPlaceTexts("paid_slice");
  assert.ok(paid.includes("CRISIS_PAID_MONEY_BACK"), "на платном срезе нужно сказать о деньгах");
  assert.ok(paid.includes("CRISIS_PAID_ANSWERS_KEPT"), "на платном срезе нужно сказать об ответах");
  assert.ok(
    !crisisPlaceTexts("ladder").some((id) => id.startsWith("CRISIS_PAID")),
    "на бесплатном входе говорить о возврате нечего",
  );
});

test("без заполненных контактов кризисный текст не публикуется", () => {
  // Пока номера линий не подтверждены (`content/crisis.md`, «Проверка актуальности»),
  // публиковать текст без них нельзя — и это состояние проверяется, а не обходится.
  assert.deepEqual(crisisContacts(), [], "контакты заполнены — проверку публикации нужно переписать");
  assert.equal(crisisPublishable(), false);

  const notice = crisisNotice("ladder", detectCrisis(inAnswer(formOf("CRISIS_SUICIDE"))));
  assert.equal(notice.publishable, false);
  assert.deepEqual(notice.texts, [], "текст без номеров хуже отсутствия текста");
  assert.deepEqual(notice.contacts, []);
  assert.deepEqual(notice.categories, ["CRISIS_SUICIDE"]);
  assert.ok(contacts.length >= 4, "реестр контактов на месте, заполнить его — решение основателя");
});

// ── Страница ──────────────────────────────────────────────────────────────────

const person = { name: "Артём", birthDate: "1994-03-12" };
const ladder: LadderAnswers = { L1: "B", L2: "C", L3: "A", L4: "B", L5: "D", L6: 5, L7: 2, L8: "A", L9: 5, L10: 4, L11: 4 };
const usual =
  "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша, потом злюсь на себя.";

test("при срабатывании на странице нет ни блока ступени 4, ни предложения", () => {
  const answer = `${usual} ${asWritten(formOf("CRISIS_SUICIDE"))}.`;
  const { view, internal } = buildPage(person, { ...ladder, L12: answer });

  assert.equal(view.step, 4, "ступень пройдена: ответ есть, просто разбор по нему не собирается");
  assert.ok(
    view.blocks.every((block) => block.step !== 4),
    "блок четвёртой ступени на кризисной странице",
  );
  assert.equal(internal.llmTask, null, "кризисный ответ не должен уходить в модель");
  assert.equal(view.offer, null, "платное предложение на кризисной странице");
  assert.deepEqual(
    view.doors.filter((door) => door.state === "paid"),
    [],
    "закрытая платная дверь продаёт так же, как предложение",
  );
  assert.deepEqual(
    view.doors.filter((door) => door.price !== null),
    [],
    "цена на кризисной странице",
  );
});

test("кризисная страница остаётся: прочитанные блоки и карта на месте", () => {
  const { view } = buildPage(person, { ...ladder, L12: `${usual} ${asWritten(formOf("CRISIS_HOPELESS"))}.` });

  assert.equal(view.blocks.length, 3, "блоки ступеней 1–3 человек уже прочёл");
  assert.ok(view.blocks.every((block) => block.source === "lookup"));
  assert.ok(view.map.some((bar) => bar.state !== "empty"), "карта остаётся заполненной");
  assert.ok(view.doors.length > 0, "бесплатные двери никуда не уходят");
  assert.ok(view.crisis, "страница обязана сказать, почему разбора нет");
  assert.equal(view.crisis?.place, "ladder");
});

test("обычный ответ той же длины даёт и блок ступени 4, и предложение", () => {
  const { view, internal } = buildPage(person, { ...ladder, L12: usual });

  assert.ok(internal.llmTask, "детектор срезал обычный ответ");
  assert.ok(view.blocks.some((block) => block.step === 4));
  assert.ok(view.offer, "предложение на обычной странице должно быть");
  assert.equal(view.crisis, null);
});

test("категория «с оговоркой» разбор со страницы не убирает", () => {
  const { view, internal } = buildPage(person, {
    ...ladder,
    L12: `${usual} ${asWritten(formOf("CRISIS_LOSS"))}.`,
  });

  assert.ok(internal.llmTask, "острая потеря сама по себе разбор не отменяет");
  assert.ok(view.offer);
  assert.ok(view.crisis, "текст поддержки стоит рядом с разбором");
  assert.deepEqual(view.crisis?.categories, ["CRISIS_LOSS"]);
});

test("значения координат и внутренние поля на кризисную страницу не попадают", () => {
  const { view } = buildPage(person, { ...ladder, L12: `${usual} ${asWritten(formOf("CRISIS_VIOLENCE"))}.` });
  const serialized = JSON.stringify(view);

  assert.ok(!serialized.includes("confidence"));
  assert.ok(!serialized.includes("\"form\""), "форма, по которой сработал детектор, наружу не уходит");
  assert.ok(!serialized.includes("\"hits\""), "находки детектора — внутреннее поле");
});

// ── Код и контент ─────────────────────────────────────────────────────────────

test("в коде детектора нет ни одной формулировки: всё приходит из контента", () => {
  // Путь от `engine/dist`, откуда тест запускается собранным (`npm test`).
  const source = readFileSync(new URL("../../engine/src/crisis.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const forms = [...triggers.flatMap((trigger) => trigger.forms), ...safe].map((form) =>
    form.replace(/\*$/, "").toLowerCase(),
  );
  const folded = source.toLowerCase().replace(/ё/g, "е");
  for (const form of forms) {
    assert.ok(!folded.includes(form.replace(/ё/g, "е")), `форма «${form}» зашита в код`);
  }
  for (const item of texts) {
    assert.ok(!source.includes(item.text.slice(0, 20)), `текст ${item.id} зашит в код`);
  }
});
