/**
 * Кризисный детектор (`content/crisis.md`, `docs/08-legal-safety.md`).
 *
 * Чистая функция от открытого текста: решает только «выдавать разбор или нет».
 * Ни оценки состояния, ни причин, ни диагнозов здесь нет и быть не может —
 * детектор ловит формулировку, а не ставит диагноз.
 *
 * Триггеры, уровни, действия, тексты, контакты и корпус похожих, но не кризисных
 * формулировок живут в контенте. В коде — только правило блокировки: категория
 * уровня `кризис` останавливает разбор сама, категория `с оговоркой` — только
 * вместе со второй сработавшей категорией.
 *
 * Цена ошибки несимметрична: не выдать разбор человеку в порядке — потеря денег,
 * выдать разбор человеку в кризисе — вред. Поэтому порог смещён в сторону
 * перестраховки, а корпус ложных случаев обязателен: детектор, режущий обычные
 * ответы, отключат при первом живом прогоне.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import { coveredByForm, findForm, fold } from "./forms.js";
import type { CrisisLevel, RawCrisisContact, RawCrisisText, RawCrisisTrigger } from "./content-extra-types.js";
import type { CrisisDecision, CrisisHit, CrisisNotice, CrisisPlace } from "./types.js";

export type { CrisisLevel, RawCrisisContact, RawCrisisText, RawCrisisTrigger } from "./content-extra-types.js";

/** Уровень, при котором категория останавливает разбор в одиночку. */
const BLOCKING: CrisisLevel = "кризис";

/** Подстановка контактов внутри кризисного текста. Собирается из реестра контактов. */
const CONTACTS_PLACEHOLDER = /\{\{[А-ЯЁ_]+\}\}/;

const registry = (): RawCrisisTrigger[] => rawExtraContent.crisis.triggers;

/** Похожие, но не кризисные формулировки: они накрывают совпадение целиком и снимают его. */
const safeForms = (): string[] => rawExtraContent.crisis.safe;

const decision = (hits: CrisisHit[]): CrisisDecision => {
  const categories = [...new Set(hits.map((hit) => hit.category))];
  const blocking = hits.filter((hit) => hit.level === BLOCKING);
  /*
   * Категория «с оговоркой» блокирует разбор только вместе со второй: острая
   * потеря встречается в открытых ответах часто и кризисом сама по себе не
   * является. Жёсткая блокировка по слову «умер» отняла бы разбор у всех, кто
   * вообще говорит о потерях (`content/crisis.md`, раздел «Как читать файл»).
   */
  const blocked = blocking.length > 0 || categories.length >= 2;
  const cause = blocking[0] ?? hits[0] ?? null;

  return {
    blocked,
    support: hits.length > 0,
    hits,
    categories,
    avoid: blocked ? [] : categories,
    reason: blocked && cause ? actionOf(cause.category) : null,
  };
};

const actionOf = (category: string): string => {
  const trigger = registry().find((candidate) => candidate.id === category);
  if (!trigger) throw new Error(`content/crisis.md: нет категории ${category}`);
  return trigger.action;
};

/**
 * Решение по открытому тексту. Порядок категорий — порядок реестра, поэтому
 * причина берётся из той категории, которая в файле стоит выше.
 *
 * Совпадение снимается, если оно целиком лежит внутри формулировки из корпуса
 * похожих: «хочу исчезнуть» внутри «хочу исчезнуть на пару дней» — не кризис.
 */
export function detectCrisis(text: string): CrisisDecision {
  const folded = fold(text);
  const safe = safeForms();
  const hits: CrisisHit[] = [];

  for (const trigger of registry()) {
    for (const form of trigger.forms) {
      for (const found of findForm(folded, form)) {
        if (coveredByForm(folded, found.index, safe)) continue;
        hits.push({
          category: trigger.id,
          level: trigger.level,
          form,
          match: text.slice(found.index, found.index + found.length),
        });
      }
    }
  }

  return decision(hits);
}

/** Разбор по этому тексту не выдаём. Короткая форма для вызывающего кода. */
export const crisisBlocks = (text: string): boolean => detectCrisis(text).blocked;

// ── Что показывается вместо разбора ───────────────────────────────────────────

/**
 * Порядок кризисных текстов на экране. Идентификаторы — машинные, тексты живут
 * только в контенте; состав каждого места сверяется с колонкой «Где показывается»
 * реестра в `engine/src/crisis.test.ts`.
 */
const PLACES: Record<CrisisPlace, string[]> = {
  ladder: ["CRISIS_SUPPORT", "CRISIS_CONTACTS_LEAD", "CRISIS_CONTACTS", "CRISIS_NO_OFFER", "CRISIS_PAGE_STAYS"],
  paid_slice: [
    "CRISIS_SUPPORT",
    "CRISIS_PAID_MONEY_BACK",
    "CRISIS_PAID_ANSWERS_KEPT",
    "CRISIS_CONTACTS_LEAD",
    "CRISIS_CONTACTS",
    "CRISIS_NO_OFFER",
  ],
};

const textById = (id: string): RawCrisisText => {
  const text = rawExtraContent.crisis.texts.find((candidate) => candidate.id === id);
  if (!text) throw new Error(`content/crisis.md: нет текста ${id}`);
  return text;
};

/** Контакты помощи, у которых номер заполнен. Пока пусто — публиковать нечего. */
export const crisisContacts = (): RawCrisisContact[] =>
  rawExtraContent.crisis.contacts.filter((contact) => contact.placeholder === null && contact.value.length > 0);

/**
 * Можно ли публиковать кризисный текст. Пустая подстановка контактов — причина
 * не публиковать текст, а не причина показать его без номеров
 * (`content/crisis.md`, раздел «Проверка актуальности»).
 */
export const crisisPublishable = (): boolean => crisisContacts().length > 0;

/**
 * Кризисное состояние страницы. Тексты возвращаются только вместе с контактами:
 * без номеров кризисный текст не публикуется, а разбор всё равно не собирается.
 */
export function crisisNotice(place: CrisisPlace, result: CrisisDecision): CrisisNotice {
  const contacts = crisisContacts();
  const lines = contacts.map((contact) => `${contact.title}: ${contact.value}`).join("\n");
  const publishable = contacts.length > 0;

  return {
    place,
    categories: result.categories,
    publishable,
    texts: publishable
      ? PLACES[place].map((id) => {
          const entry = textById(id);
          return { id, text: entry.text.replace(CONTACTS_PLACEHOLDER, lines) };
        })
      : [],
    contacts: contacts.map((contact) => ({ title: contact.title, value: contact.value })),
  };
}

/** Идентификаторы текстов места показа: нужны сверке кода с реестром. */
export const crisisPlaceTexts = (place: CrisisPlace): string[] => [...PLACES[place]];

/** Все места показа: тест обязан покрыть каждое. */
export const CRISIS_PLACES: CrisisPlace[] = Object.keys(PLACES) as CrisisPlace[];
