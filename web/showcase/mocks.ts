/**
 * Моковые данные витрины: то, что пришло бы с сервера.
 *
 * Строки интерфейса сюда не переписываются — они приходят из реестра
 * микрокопии через `web/src/page-copy.ts`. Здесь остаётся только то, что на
 * настоящей странице отдаёт сервер: карточка, крючок, блоки разбора, вопросы,
 * подписи полос и дверей. Это тексты `content/step*.md` и `content/doors.md`,
 * и в витрине они моковые.
 *
 * Подписи полос, полюсов и заголовки дверей взяты из `docs/11-ui-page-spec.md`,
 * чтобы витрина показывала настоящую длину строки, а не «Lorem ipsum».
 */

import type { BlockDto, CardDto, DoorDto, MapBarDto, OfferDto } from "../src/contract.js";
import { SUBMIT_FROM_WORDS } from "../components/open-field.js";
import { blockTexts, mapTexts, offerTexts, portionTexts, routeTexts } from "../src/page-copy.js";

export const card: CardDto = {
  name: "Кирилл",
  season: "осень",
  theme: "Период, когда важнее закончить, чем начать",
  metaphor: "Как чтение книги, дочитанной до середины дважды",
  cta: "Три вопроса — и я скажу, как ты работаешь",
};

export const hook = "Ты не бросаешь дела — ты останавливаешься за шаг до конца";
export const hookAfterStep3 = "Ты закрываешь дело ровно тогда, когда его уже нельзя сделать лучше";
export const hookAfterStep4 = "Круг замыкается там же, где начался";

/** Тексты карты приходят из реестра микрокопии, а не сочиняются витриной. */
export const zoneLabel = mapTexts.zone;
export const fillLabels = mapTexts.fill();

const triggerOptions = [
  "когда меня не воспринимают всерьёз",
  "когда я теряю контроль над происходящим",
  "когда меня оставляют одного",
  "когда обо мне думают хуже, чем есть",
  "когда меня торопят",
  "когда решают за меня",
  "когда я подвожу тех, кто рассчитывал",
];

/** Полная карта: три состояния полосы и категориальная полоса. */
export const mapBars: MapBarDto[] = [
  {
    id: "tempo",
    label: "Темп",
    poles: { low: "ровный поток", high: "импульсы" },
    fill: "precise",
    position: 0.82,
    category: null,
    hint: "Откроется на первых трёх вопросах",
  },
  {
    id: "completion",
    label: "Доведение",
    poles: { low: "до конца", high: "обрыв" },
    fill: "precise",
    position: 0.72,
    category: null,
    hint: "Откроется на первых трёх вопросах",
  },
  {
    id: "pressure",
    label: "Под давлением",
    poles: { low: "замирание", high: "ускорение" },
    fill: "approximate",
    position: 0.3,
    category: null,
    hint: "Откроется на первых трёх вопросах",
  },
  {
    id: "trigger",
    label: "Что задевает",
    poles: null,
    fill: "precise",
    position: null,
    category: { options: triggerOptions, selected: triggerOptions[3] as string },
    hint: "Откроется на вопросах про то, что задевает",
  },
  {
    id: "attention",
    label: "Внимание",
    poles: { low: "конкретика", high: "связи" },
    fill: "approximate",
    position: 0.5,
    category: null,
    hint: "Откроется на вопросах про то, как ты обрабатываешь",
  },
  {
    id: "structure",
    label: "Структура",
    poles: { low: "определённость", high: "открытый финал" },
    fill: "empty",
    position: null,
    category: null,
    hint: "Откроется на вопросах про планы и решения",
  },
  {
    id: "holding",
    label: "Удержание",
    poles: { low: "отпускает", high: "держит долго" },
    fill: "empty",
    position: null,
    category: null,
    hint: "Откроется на вопросах про то, как тебя задевает",
  },
];

/** Карта состояния `s0`: данных нет ни по одной полосе. */
export const emptyMapBars: MapBarDto[] = mapBars.map((bar) => ({
  ...bar,
  fill: "empty",
  position: null,
  category: bar.category === null ? null : { options: bar.category.options, selected: null },
}));

export const block: BlockDto = {
  id: "step1",
  heading: "Как ты работаешь",
  paragraphs: [
    "Ты входишь в работу рывком: сначала долго не начинаешь, потом делаешь за вечер то, на что закладывал неделю. Это не лень и не собранность — это способ набирать скорость от давления срока.",
    "Пока задача держится в голове целиком, ты не выпускаешь её из рук. Как только она распадается на части, каждая часть кажется отдельной задачей, и та, что скучнее, остаётся лежать.",
    "Сильнее всего это видно на длинных делах без внешнего срока: там некому создать давление, и работа встаёт не в начале, а в момент, когда результат уже почти есть.",
  ],
  highlight: "Ты останавливаешься не там, где трудно, а там, где почти получилось: последний шаг требует признать, что вышло именно так, а не как задумано.",
  generation: null,
  disagreed: false,
  purchased: false,
  stale: false,
};

export const blockActions = blockTexts.actions();

export const staleNote = blockTexts.updated();

export const doors: DoorDto[] = [
  { id: "door-decisions", title: "Как ты принимаешь решения", state: "opens_with_answers", price: null, slice: null },
  { id: "door-work", title: "Как ты работаешь", state: "open", price: null, slice: null },
  { id: "door-finish", title: "Почему ты останавливаешься у финиша", state: "paid", price: null, slice: "slice_node_finish" },
  { id: "door-close", title: "Как этот механизм работает в близких", state: "paid", price: null, slice: "slice_relations" },
  { id: "door-map", title: "Полная карта", state: "paid", price: null, slice: "slice_full_map" },
];

/**
 * Тот же маршрут после ступени 4: одна дверь предложена и только у неё
 * пришла цена. У остальных платных дверей цены нет — так же, как в контракте.
 */
export const doorsWithOffer: DoorDto[] = doors.map((door) =>
  door.slice === "slice_node_finish" ? { ...door, price: 590 } : door,
);

export const doorNotes: Record<string, string> = {
  "door-decisions": routeTexts.tag("opens_with_answers"),
  "door-work": routeTexts.tag("open"),
  "door-finish": routeTexts.tag("paid"),
  "door-close": routeTexts.tag("paid"),
  "door-map": routeTexts.tag("paid"),
};

export const offer: OfferDto = {
  slice: "slice_node_finish",
  title: "Откуда пошёл этот круг",
  price: 590,
  promise:
    "Я вижу, откуда замыкается этот круг — но не откуда он пошёл. Чтобы разобрать, где механизм включился впервые и что с ним делать, мне нужно ещё десять вопросов про твои остановки.",
  questionCount: "10",
  contents: [
    "форма твоей остановки",
    "адрес оценки, который стоит у тебя на выходе",
    "когда механизм включился впервые",
    "три действия из условий, при которых ты уже доводил",
  ],
  decline: "Не сейчас — страница остаётся полной, а эта дверь остаётся на карте без цены",
};

export const offerLabels = {
  buy: offerTexts.buy(offer.price),
  contents: offerTexts.contents(offer.contents),
  decline: offer.decline,
  oneDoor: offerTexts.oneDoor(),
};

export const formatPrice = routeTexts.price;

export const nextOffer: OfferDto = {
  slice: "slice_relations",
  title: "Как этот механизм работает в близких",
  price: 1290,
  promise:
    "Тот же круг, но уже не в деле, а в близких: где ты отступаешь, чтобы не быть отвергнутым, и что с этим делать.",
  questionCount: "20",
  contents: [
    "что повторяется у тебя независимо от партнёра",
    "что ты делаешь в отдалении и что в сближении",
    "цена, которую платит рядом с тобой другой",
    "три-пять действий, которые касаются тебя, а не партнёра",
  ],
  decline: "Не сейчас — страница остаётся полной, и эта дверь со временем не закрывается",
};

export const nextOfferLabels = {
  buy: offerTexts.buy(nextOffer.price),
  contents: offerTexts.contents(nextOffer.contents),
  decline: nextOffer.decline,
  oneDoor: offerTexts.oneDoor(),
};

/** Кризисный текст витрины. Полный текст живёт в `content/crisis.md`; контактов основатель ещё не назвал. */
export const crisisTexts = {
  support: "Сейчас важнее живая поддержка, чем разбор. Поэтому разбора здесь не будет.",
  noOffer: "Ничего платного на этой странице сейчас не предлагается.",
  stays: "Страница остаётся по этой ссылке. Ответы сохранены, ничего делать не нужно.",
};

export const choiceQuestion = {
  group: "q-trigger",
  label: "Что задевает тебя сильнее всего?",
  options: [
    { value: "A", text: "когда меня не воспринимают всерьёз" },
    { value: "B", text: "когда я теряю контроль над происходящим" },
    { value: "C", text: "когда обо мне думают хуже, чем есть" },
    { value: "D", text: "когда я подвожу тех, кто на меня рассчитывал" },
  ],
};

export const scaleQuestion = {
  group: "q-pressure",
  label: "Когда времени в обрез, что с тобой происходит?",
  poles: { low: "замираю", high: "ускоряюсь" },
  markLabels: [
    "чаще замираю",
    "скорее замираю",
    "по-разному",
    "скорее ускоряюсь",
    "чаще ускоряюсь",
  ] as [string, string, string, string, string],
};

export const openQuestion = {
  id: "q-open",
  label: "Опиши случай, когда ты остановился у самого конца",
  hint: portionTexts.openTooShort(),
  submitLabel: portionTexts.openSubmit(),
  counterText: (state: { words: number }): string => portionTexts.counter(state, SUBMIT_FROM_WORDS),
  short: "Бросил проект перед сдачей",
  medium: "Бросил проект перед сдачей, хотя оставалось",
  long:
    "Собирал этот проект четыре месяца, а за неделю до сдачи перестал открывать файл и в итоге отдал сырым, хотя всё было почти готово",
};

export const mapLabel = mapTexts.label();
export const routeLabel = routeTexts.label();
export const mapClosedNote = mapTexts.closedNote();

/** Подводка порции: обещание конкретного результата, не «ещё вопросы». */
export const portionLead = "Ещё четыре вопроса и покажу, где ты сам себе мешаешь";

export const portionLabels = {
  back: portionTexts.back(),
  scaleHint: portionTexts.scaleHint(),
  scaleMarks: [
    portionTexts.scaleMark(1),
    portionTexts.scaleMark(2),
    portionTexts.scaleMark(3),
    portionTexts.scaleMark(4),
    portionTexts.scaleMark(5),
  ] as [string, string, string, string, string],
  openHint: portionTexts.openTooShort(),
  openSubmit: portionTexts.openSubmit(),
  counterText: (state: { words: number }): string => portionTexts.counter(state, SUBMIT_FROM_WORDS),
};

/**
 * Числовой вопрос добора: две величины сразу. Подписи полей в контракте
 * отдельного места не имеют — витрина кладёт их в `options`. Это мок,
 * не решение сервера: сервер пока отдаёт пустой список.
 */
export const numberQuestion = {
  id: "S5",
  kind: "число" as const,
  text: "Сколько раз за последний год ты начинал своё дело и сколько из них дошло до чужих глаз?",
  options: [
    { key: "started", text: "начинал" },
    { key: "finished", text: "дошло до чужих глаз" },
  ],
  scale: null,
};
