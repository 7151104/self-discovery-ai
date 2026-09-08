/**
 * Тексты страницы: единственное место клиента, которое знает идентификаторы
 * реестра микрокопии.
 *
 * Разделение простое. Компоненты в `web/components/` текстов не знают и
 * принимают их параметрами — это проверяет `discipline.test.ts`. Здесь
 * состояние страницы превращается в готовые строки, и ни одна строка не
 * сочиняется на месте: всё через `copy()`, то есть через `content/ui-copy.md`.
 * Забытый идентификатор падает при сборке страницы, а не показывается пустотой.
 *
 * Формат цены сюда тоже не зашит: он живёт шаблоном `UI_PAY_BUTTON`
 * (`docs/14-state.md`, решение по вопросу 26).
 */

import { copy } from "./copy.js";
import type { DisagreementKind, MapBarDto, PageStateDto, PublicPageDto } from "./contract.js";
import { ZONES, type Zone } from "../components/map.js";
import { waitTopics, type WaitState } from "../components/wait.js";

/** Зона маркера → строка реестра и полюс, который в неё подставляется. */
const ZONE_COPY: Record<Zone, { id: string; pole: "low" | "high" | null }> = {
  "far-low": { id: "UI_MAP_ZONE_EDGE", pole: "low" },
  low: { id: "UI_MAP_ZONE_NEAR", pole: "low" },
  "mid-low": { id: "UI_MAP_ZONE_SLIGHT", pole: "low" },
  center: { id: "UI_MAP_ZONE_CENTER", pole: null },
  "mid-high": { id: "UI_MAP_ZONE_SLIGHT", pole: "high" },
  high: { id: "UI_MAP_ZONE_NEAR", pole: "high" },
  "far-high": { id: "UI_MAP_ZONE_EDGE", pole: "high" },
};

/** Разделитель перечислений: темы ожидания, состав среза. */
const LIST_SEPARATOR = " · ";

export const mapTexts = {
  label: (): string => copy("UI_MAP_TITLE"),
  closedNote: (): string => copy("UI_MAP_CLOSED_NOTE"),
  /** Состояние полосы словами: точная, предположительная, пустая. */
  fill: (): Record<MapBarDto["fill"], string> => ({
    precise: copy("UI_MAP_HINT_PRECISE"),
    approximate: copy("UI_MAP_HINT_APPROXIMATE"),
    empty: copy("UI_MAP_FILL_EMPTY"),
  }),
  /**
   * Положение маркера словами — для скринридера. Названо перевесом в сторону
   * полюса, который человек и так видит подписью: ни числа, ни доли.
   */
  zone: (bar: MapBarDto, zone: Zone): string => {
    const rule = ZONE_COPY[zone];
    if (rule.pole === null || bar.poles === null) return copy("UI_MAP_ZONE_CENTER");
    return copy(rule.id, { полюс: bar.poles[rule.pole] });
  },
  /** Все зоны разом: нужно витрине, чтобы показать их одним списком. */
  zones: (bar: MapBarDto): { zone: Zone; text: string }[] =>
    ZONES.map((zone) => ({ zone, text: mapTexts.zone(bar, zone) })),
};

export const headTexts = {
  period: (theme: string): string => copy("UI_HEAD_PERIOD", { тема: theme }),
  noPeriod: (): string => copy("UI_HEAD_NO_PERIOD"),
  linkHint: (): string => copy("UI_HEAD_LINK_HINT"),
  emptyHook: (): string => copy("UI_HOOK_EMPTY"),
};

export const introTexts = {
  title: (): string => copy("UI_INTRO_TITLE"),
  about: (): string => copy("UI_INTRO_ABOUT"),
  nameLabel: (): string => copy("UI_INTRO_NAME_LABEL"),
  namePlaceholder: (): string => copy("UI_INTRO_NAME_PLACEHOLDER"),
  nameRequired: (): string => copy("UI_INTRO_NAME_REQUIRED"),
  dateLabel: (): string => copy("UI_INTRO_DATE_LABEL"),
  dateHint: (): string => copy("UI_INTRO_DATE_HINT"),
  submit: (): string => copy("UI_INTRO_SUBMIT"),
};

/**
 * Несуществующий профиль. Отдельной строки в реестре нет (вопрос 38):
 * показываем публичный выход «сделать свою», без кодов отказа и без «404».
 */
export const missingTexts = {
  title: (): string => copy("UI_PAGE_TITLE"),
  text: (): string => copy("UI_PUBLIC_MAKE_OWN_HINT"),
  action: (): string => copy("UI_PUBLIC_MAKE_OWN"),
};

export const blockTexts = {
  actions: (): { id: string; label: string }[] => [
    { id: "disagree", label: copy("UI_BLOCK_DISAGREE") },
    { id: "share", label: copy("UI_BLOCK_SHARE") },
  ],
  updated: (): string => copy("UI_BLOCK_UPDATED"),
  diverged: (): string => copy("UI_EDGE_PAID_DIVERGED"),
  disagreeDone: (): string => copy("UI_BLOCK_DISAGREE_DONE"),
  acknowledged: (): string => copy("UI_DISAGREE_DONE"),
};

export const disagreeTexts = {
  title: (): string => copy("UI_DISAGREE_TITLE"),
  effect: (): string => copy("UI_DISAGREE_EFFECT"),
  kinds: (): { id: DisagreementKind; label: string }[] => [
    { id: "not_about_me", label: copy("UI_DISAGREE_NOT_ME") },
    { id: "partly", label: copy("UI_DISAGREE_PARTLY") },
    { id: "too_general", label: copy("UI_DISAGREE_TOO_GENERAL") },
  ],
};

export const routeTexts = {
  label: (): string => copy("UI_ROUTE_TITLE"),
  note: (): string => copy("UI_ROUTE_NOTE"),
  /** Цена строкой. Формат — шаблон реестра, компонент его не знает. */
  price: (price: number): string => copy("UI_PAY_BUTTON", { цена: price }),
  tag: (state: "open" | "opens_with_answers" | "paid"): string =>
    state === "open"
      ? copy("UI_ROUTE_TAG_OPEN")
      : state === "opens_with_answers"
        ? copy("UI_ROUTE_TAG_OPENS")
        : copy("UI_ROUTE_TAG_PAID"),
};

export const offerTexts = {
  buy: (price: number): string => copy("UI_PAY_BUTTON", { цена: price }),
  /**
   * Состав среза приходит готовым списком: он живёт в разделе «Экран оплаты»
   * файла среза (E5-09), а не в реестре микрокопии — у каждого среза свой.
   */
  contents: (parts: string[]): string =>
    `${copy("UI_PAY_CONTENTS_LABEL")}${LIST_SEPARATOR}${parts.join(LIST_SEPARATOR)}`,
  /** Запас, если список состава пуст: на экране остаётся только подпись. */
  contentsLabel: (): string => copy("UI_PAY_CONTENTS_LABEL"),
  decline: (): string => copy("UI_PAY_DECLINE"),
  oneDoor: (): string => copy("UI_PAY_ONE_DOOR"),
  legal: (): string => copy("UI_PAY_LEGAL_LEAD"),
};

export const portionTexts = {
  title: (): string => copy("UI_PORTION_TITLE"),
  back: (): string => copy("UI_PORTION_BACK"),
  progress: (index: number, total: number): string =>
    copy("UI_PORTION_PROGRESS_ARIA", { номер: index + 1, всего: total }),
  scaleHint: (): string => copy("UI_PORTION_SCALE_HINT"),
  scaleMark: (value: number): string => copy("UI_PORTION_SCALE_ARIA", { значение: value }),
  openPlaceholder: (): string => copy("UI_OPEN_PLACEHOLDER"),
  openSubmit: (): string => copy("UI_OPEN_SUBMIT"),
  openTooShort: (): string => copy("UI_EDGE_OPEN_TOO_SHORT"),
  counter: (state: { words: number }, minimum: number): string =>
    state.words >= minimum
      ? copy("UI_OPEN_COUNTER", { слов: state.words })
      : copy("UI_OPEN_COUNTER_SHORT", { слов: state.words, минимум: minimum }),
};

export const waitTexts = {
  /** Что собирается. Ступеням 1–3 сюда попасть нечем: у них нет сборки. */
  title: (state: WaitState): string => (state.kind === "step4" ? copy("UI_WAIT_STEP4") : copy("UI_WAIT_PAID")),
  collecting: (): string => copy("UI_WAIT_COLLECTING"),
  longNote: (state: WaitState): string | null => (state.long ? copy("UI_WAIT_LONG") : null),
  resumedNote: (state: WaitState): string | null => (state.resumed ? copy("UI_WAIT_RESUMED") : null),
  /**
   * Что уточняется. Перечисляются темы полос карты, а не координаты: подпись
   * полосы человек уже видит, и ничего сверх неё наружу не уходит.
   * Перечислять нечего — строки нет вовсе.
   */
  topics: (page: PageStateDto): string | null => {
    const topics = waitTopics(page.map);
    return topics.length === 0 ? null : copy("UI_WAIT_PAID_TOPICS", { темы: topics.join(LIST_SEPARATOR) });
  },
};

export const shareTexts = {
  imageReady: (): string => copy("UI_SHARE_IMAGE_READY"),
  imageOnly: (): string => copy("UI_SHARE_IMAGE_ONLY"),
  save: (): string => copy("UI_SHARE_SAVE"),
  privacy: (): string => copy("UI_SHARE_PRIVACY"),
  live: (): string => copy("UI_SHARE_LIVE"),
  open: (): string => copy("UI_SHARE_OPEN"),
  publicOn: (): string => copy("UI_SHARE_PUBLIC_ON"),
  link: (url: string): string => copy("UI_SHARE_LINK", { ссылка: url }),
  close: (): string => copy("UI_SHARE_CLOSE"),
  closed: (): string => copy("UI_SHARE_CLOSED"),
};

export const publicTexts = {
  title: (name: string): string => copy("UI_PUBLIC_TITLE", { имя: name }),
  live: (name: string): string => copy("UI_PUBLIC_LIVE", { имя: name }),
  hidden: (): string => copy("UI_PUBLIC_HIDDEN"),
  empty: (): string => copy("UI_PUBLIC_EMPTY"),
  revoked: (): string => copy("UI_PUBLIC_REVOKED"),
  makeOwn: (): string => copy("UI_PUBLIC_MAKE_OWN"),
  makeOwnHint: (): string => copy("UI_PUBLIC_MAKE_OWN_HINT"),
};

export function publicNotice(page: Pick<PublicPageDto, "name" | "map">): { id: string; texts: string[]; tone: "rest" } {
  const texts = [publicTexts.live(page.name), publicTexts.hidden()];
  if (page.map.every((bar) => bar.fill === "empty")) texts.push(publicTexts.empty());
  return { id: "public", texts, tone: "rest" };
}

/** Краевые состояния: тексты группы EDGE. Полный кризисный текст — не здесь, а в `content/crisis.md`. */
export const edgeTexts = {
  noDate: (): string => copy("UI_EDGE_NO_DATE"),
  openTooShort: (): string => copy("UI_EDGE_OPEN_TOO_SHORT"),
  crisis: (): string => copy("UI_EDGE_CRISIS"),
  noNode: (): string => copy("UI_EDGE_NO_NODE"),
  returned: (): string => copy("UI_EDGE_RETURN"),
  payDeclined: (): string => copy("UI_EDGE_PAY_DECLINED"),
  answerChanged: (): string => copy("UI_EDGE_ANSWER_CHANGED"),
  paidDiverged: (): string => copy("UI_EDGE_PAID_DIVERGED"),
  paymentFailed: (): string => copy("UI_EDGE_PAYMENT_FAILED"),
  generationFailed: (): string => copy("UI_EDGE_GENERATION_FAILED"),
};

export const errorTexts = {
  save: (): string => copy("UI_ERROR_SAVE"),
  load: (): string => copy("UI_ERROR_LOAD"),
  offline: (): string => copy("UI_ERROR_OFFLINE"),
  unknown: (): string => copy("UI_ERROR_UNKNOWN"),
  tooShort: (): string => copy("UI_ERROR_TOO_SHORT"),
};
