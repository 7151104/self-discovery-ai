/**
 * Состояния страницы `s0`–`paid_done` на моковых данных (E6-12).
 *
 * Каждое состояние — то, что прислал бы сервер: `PageStateDto` целиком, без
 * единой выдумки сверх контракта. Витрина показывает их подряд, тесты берут
 * их же как вход — поэтому «показанное на витрине» и «проверенное тестом»
 * остаётся одним и тем же.
 *
 * Таблица состояний — `docs/11-ui-page-spec.md`, раздел «Состояния страницы».
 * Между `s3` и `s4` есть ещё два состояния ожидания: они не отдельные
 * состояния страницы, а тот же `s4` и `paid_pending` в момент сборки текста.
 */

import type { BlockDto, DoorDto, MapBarDto, PageStateDto, PortionDto, QuestionDto } from "../src/contract.js";
import * as mock from "./mocks.js";

const PROFILE = "p-VITRINA";
const URL_BASE = `/p/${PROFILE}`;

/** Время последнего обновления страницы. Фиксировано: снимки должны совпадать. */
export const UPDATED_AT = "2026-03-01T12:00:00.000Z";

/**
 * Позиции полос, которые в моках закрыты: как только полоса открывается,
 * сервер присылает вместе с ней и положение маркера. Закрытая полоса приходит
 * с `position: null` — значения закрытой координаты клиент не знает вовсе.
 */
const OPENED_POSITIONS: Record<string, number> = { structure: 0.35, holding: 0.62 };

const bar = (id: string, fill: MapBarDto["fill"]): MapBarDto => {
  const source = mock.mapBars.find((item) => item.id === id);
  if (source === undefined) throw new Error(`нет полосы ${id}`);
  if (fill === "empty") {
    return {
      ...source,
      fill,
      position: null,
      category: source.category === null ? null : { options: source.category.options, selected: null },
    };
  }
  return { ...source, fill, position: source.position ?? OPENED_POSITIONS[id] ?? null };
};

/** Полосы карты по ступеням: 0 → 2 → 5 → 7 заполненных (`docs/11`). */
const mapAt = (filled: number): MapBarDto[] =>
  mock.mapBars.map((source, index) =>
    index < filled ? bar(source.id, index < filled - 1 ? "precise" : "approximate") : bar(source.id, "empty"),
  );

const block = (id: BlockDto["id"], heading: string, highlight: string | null, extra: Partial<BlockDto> = {}): BlockDto => ({
  id,
  heading,
  paragraphs: mock.block.paragraphs,
  highlight,
  generation: null,
  disagreed: false,
  purchased: false,
  stale: false,
  ...extra,
});

const step1 = block("step1", "Как ты работаешь", mock.block.highlight);
const step2 = block("step2", "Как тебя задевает", "Ты замечаешь не сам укол, а то, что после него остаёшься объяснять себе, почему он не имел значения.");
const step3 = block("step3", "Где ты себе мешаешь", "Ты закрываешь дело ровно тогда, когда его уже нельзя сделать лучше, — и поэтому не закрываешь никогда.");
const step4 = block("step4", "Твой сюжет", "Круг замыкается там же, где начался: в моменте, когда результат становится оценкой тебя.");
const sliceBlock = block(
  "slice:node_finish",
  "Откуда пошёл этот круг",
  "Механизм включился там, где закончить означало отдать сделанное на суд.",
  { purchased: true },
);

const question = (id: string, kind: QuestionDto["kind"], text: string, extra: Partial<QuestionDto> = {}): QuestionDto => ({
  id,
  kind,
  text,
  options: [],
  scale: null,
  ...extra,
});

const choiceOptions = mock.choiceQuestion.options.map((option) => ({ key: option.value, text: option.text }));

const portion = (key: PortionDto["key"], lead: string, questions: QuestionDto[]): PortionDto => ({
  key,
  lead,
  questions,
  answered: [],
});

const portion1 = portion("step:1", "Три вопроса — и я скажу, как ты работаешь", [
  question("Q1", "выбор", "Как обычно начинается твоя работа над большим делом?", { options: choiceOptions }),
  question("Q2", "шкала", mock.scaleQuestion.label, { scale: mock.scaleQuestion.poles }),
  question("Q3", "выбор", "Что чаще останавливает тебя у самого конца?", { options: choiceOptions }),
]);

const portion2 = portion("step:2", "Ещё четыре — и покажу, как тебя задевает", [
  question("Q4", "выбор", mock.choiceQuestion.label, { options: choiceOptions }),
  question("Q5", "шкала", "Когда тебя задели, что происходит дальше?", { scale: { low: "отпускаю", high: "держу долго" } }),
  question("Q6", "выбор", "Что ты делаешь с обидой чаще всего?", { options: choiceOptions }),
  question("Q7", "выбор", "Кому ты об этом говоришь?", { options: choiceOptions }),
]);

const portion3 = portion("step:3", "Ещё четыре — и покажу, где ты сам себе мешаешь", [
  question("Q8", "выбор", "Как ты принимаешь решение, когда данных не хватает?", { options: choiceOptions }),
  question("Q9", "шкала", "Насколько тебе важно оставить финал открытым?", { scale: mock.scaleQuestion.poles }),
  question("Q10", "выбор", "Что ты делаешь с планом, который перестал сходиться?", { options: choiceOptions }),
  question("Q11", "выбор", "Как ты обрабатываешь то, что случилось?", { options: choiceOptions }),
]);

const portion4 = portion("step:4", "Один вопрос своими словами — и соберу твой сюжет", [
  question("L12", "открытый", mock.openQuestion.label),
]);

const slicePortion = portion("slice:node_finish", "Десять вопросов про твои остановки", [
  question("S1", "выбор", "Когда ты в последний раз останавливался у финиша?", { options: choiceOptions }),
  question("S2", "шкала", "Насколько это повторяется?", { scale: mock.scaleQuestion.poles }),
]);

/** Двери маршрута по ступеням: до профиля и после него. */
const work = (state: DoorDto["state"]): DoorDto => ({
  id: "door-work",
  title: "Как ты работаешь",
  state,
  price: null,
  slice: null,
});

const decisions = (state: DoorDto["state"] = "opens_with_answers"): DoorDto => ({
  id: "door-decisions",
  title: "Как ты принимаешь решения",
  state,
  price: null,
  slice: null,
});

const finish = (state: DoorDto["state"], price: number | null = null): DoorDto => ({
  id: "door-finish",
  title: "Почему ты останавливаешься у финиша",
  state,
  price,
  slice: "slice_node_finish",
});

const close = (state: DoorDto["state"], price: number | null = null): DoorDto => ({
  id: "door-close",
  title: "Как этот механизм работает в близких",
  state,
  price,
  slice: "slice_relations",
});

const fullMap = (): DoorDto => ({
  id: "door-map",
  title: "Полная карта",
  state: "paid",
  price: null,
  slice: "slice_full_map",
});

const doorsStart = (): DoorDto[] => [work("opens_with_answers"), decisions(), finish("paid"), close("paid"), fullMap()];
const doorsOpened = (): DoorDto[] => [work("open"), decisions(), finish("paid"), close("paid"), fullMap()];
const doorsOffered = (): DoorDto[] => [work("open"), decisions(), finish("paid", mock.offer.price), close("paid"), fullMap()];
const doorsAfterPay = (): DoorDto[] => [work("open"), decisions(), finish("paid"), close("paid"), fullMap()];
const doorsDone = (): DoorDto[] => [work("open"), decisions(), finish("open"), close("paid", mock.nextOffer.price), fullMap()];

const page = (state: PageStateDto["state"], parts: Partial<PageStateDto>): PageStateDto => ({
  profileId: PROFILE,
  url: URL_BASE,
  state,
  card: mock.card,
  hook: null,
  map: mapAt(0),
  blocks: [],
  doors: doorsStart(),
  offer: null,
  nextPortion: null,
  share: null,
  updatedAt: UPDATED_AT,
  ...parts,
});

const pending = (source: BlockDto): BlockDto => ({
  ...source,
  paragraphs: [],
  highlight: null,
  generation: { id: "g-1", status: "pending" },
});

export const pageStates = {
  /** Шапка, пустая карта, маршрут заглушкой. Ждать нечего: ждать ещё не начали. */
  s0: page("s0", { nextPortion: portion1 }),

  /** Первый блок и две полосы. */
  s1: page("s1", { hook: mock.hook, map: mapAt(2), blocks: [step1], doors: doorsOpened(), nextPortion: portion2 }),

  /** Второй блок и пять полос. */
  s2: page("s2", { hook: mock.hook, map: mapAt(5), blocks: [step1, step2], doors: doorsOpened(), nextPortion: portion3 }),

  /** Третий блок, семь полос, двери подписаны под профиль. */
  s3: page("s3", {
    hook: mock.hook,
    map: mapAt(7),
    blocks: [step1, step2, step3],
    doors: doorsOpened(),
    nextPortion: portion4,
  }),

  /** Тот же `s4` в момент сборки: единственное ожидание бесплатной лестницы. */
  s4Waiting: page("s4", {
    hook: mock.hook,
    map: mapAt(7),
    blocks: [step1, step2, step3, pending(step4)],
    doors: doorsOpened(),
  }),

  /** Сюжет собран, предложение показано. */
  s4: page("s4", {
    hook: mock.hook,
    map: mapAt(7),
    blocks: [step1, step2, step3, step4],
    doors: doorsOffered(),
    offer: mock.offer,
  }),

  /** Оплачено: сначала вопросы добора, а не отчёт. */
  paidPending: page("paid_pending", {
    hook: mock.hook,
    map: mapAt(7),
    blocks: [step1, step2, step3, step4],
    doors: doorsAfterPay(),
    nextPortion: slicePortion,
  }),

  /** Доборы отвечены, срез собирается. */
  paidWaiting: page("paid_pending", {
    hook: mock.hook,
    map: mapAt(7),
    blocks: [step1, step2, step3, step4, pending(sliceBlock)],
    doors: doorsAfterPay(),
  }),

  /** Срез на месте, маршрут показывает следующие двери. */
  paidDone: page("paid_done", {
    hook: mock.hook,
    map: mapAt(7),
    blocks: [step1, step2, step3, step4, sliceBlock],
    doors: doorsDone(),
    offer: mock.nextOffer,
    share: { url: `${URL_BASE}/s/public-token`, createdAt: UPDATED_AT },
  }),
} satisfies Record<string, PageStateDto>;

export type PageStateKey = keyof typeof pageStates;

/** Порядок показа в витрине. `spec` — строка таблицы «Состояния страницы» в docs/11. */
export const PAGE_STATE_CASES: { key: PageStateKey; id: string; caption: string; spec: boolean }[] = [
  { key: "s0", id: "s0", caption: "s0 · шапка, пустая карта, маршрут заглушкой", spec: true },
  { key: "s1", id: "s1", caption: "s1 · первый блок и две полосы", spec: true },
  { key: "s2", id: "s2", caption: "s2 · второй блок и пять полос", spec: true },
  { key: "s3", id: "s3", caption: "s3 · третий блок, семь полос, двери под профиль", spec: true },
  { key: "s4Waiting", id: "s4-waiting", caption: "s4 · сюжет собирается: единственное ожидание бесплатной лестницы", spec: false },
  { key: "s4", id: "s4", caption: "s4 · сюжет и предложение среза", spec: true },
  { key: "paidPending", id: "paid_pending", caption: "paid_pending · после оплаты сразу вопросы, а не отчёт", spec: true },
  { key: "paidWaiting", id: "paid_waiting", caption: "paid_pending · доборы отвечены, срез собирается", spec: false },
  { key: "paidDone", id: "paid_done", caption: "paid_done · блок среза и следующие двери", spec: true },
];
