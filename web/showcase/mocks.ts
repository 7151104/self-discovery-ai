/**
 * Моковые данные витрины.
 *
 * Здесь и только здесь живут русские строки: компоненты текстов не знают,
 * они принимают их параметрами. Настоящие тексты придут из `content/`
 * реестром микрокопии (E5-03) — до него витрина показывает заглушки,
 * похожие по длине и тону на будущие.
 *
 * Подписи полос, полюсов и заголовки дверей взяты из `docs/11-ui-page-spec.md`,
 * чтобы витрина показывала настоящую длину строки, а не «Lorem ipsum».
 */

import type { BlockDto, CardDto, DoorDto, MapBarDto, OfferDto } from "../src/contract.js";
import type { Zone } from "../components/map.js";

export const card: CardDto = {
  name: "Кирилл",
  season: "осень",
  theme: "Период, когда важнее закончить, чем начать",
  metaphor: "Как чтение книги, дочитанной до середины дважды",
  cta: "Три вопроса — и я скажу, как ты работаешь",
};

export const hook = "Ты не бросаешь дела — ты останавливаешься за шаг до конца";

export const zoneLabels: Record<Zone, string> = {
  "far-low": "у левого края",
  low: "ближе к левому краю",
  "mid-low": "левее середины",
  center: "посередине",
  "mid-high": "правее середины",
  high: "ближе к правому краю",
  "far-high": "у правого края",
};

export const fillLabels: Record<MapBarDto["fill"], string> = {
  empty: "пока закрыто",
  approximate: "пока предположение",
  precise: "видно точно",
};

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
    hint: "Откроется, когда ответишь на вопросы про планы и решения",
  },
  {
    id: "holding",
    label: "Удержание",
    poles: { low: "отпускает", high: "держит долго" },
    fill: "empty",
    position: null,
    category: null,
    hint: "Откроется, когда ответишь на вопросы про то, как тебя задевает",
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

export const blockActions = [
  { id: "disagree", label: "Не согласен с этим" },
  { id: "share", label: "Поделиться" },
];

export const staleNote = "Обновилось после правки ответа";

export const doors: DoorDto[] = [
  { id: "door-decisions", title: "Как ты принимаешь решения", state: "opens_with_answers", price: null, slice: null },
  { id: "door-work", title: "Как ты работаешь", state: "open", price: null, slice: null },
  { id: "door-finish", title: "Почему ты останавливаешься у финиша", state: "paid", price: null, slice: "slice_node_finish" },
  { id: "door-close", title: "Как этот механизм работает в близких", state: "paid", price: null, slice: "slice_relations" },
  { id: "door-map", title: "Полная карта", state: "paid", price: null, slice: "slice_full_map" },
];

export const doorNotes: Record<string, string> = {
  "door-decisions": "Откроется после четырёх вопросов",
  "door-work": "Открыт",
};

export const offer: OfferDto = {
  slice: "slice_node_finish",
  title: "Откуда пошёл этот круг",
  price: 590,
  promise:
    "Я вижу, откуда замыкается этот круг — но не откуда он пошёл. Чтобы разобрать, где механизм включился впервые и что с ним делать, мне нужно ещё десять вопросов про твои остановки.",
  questionCount: "10",
};

export const offerLabels = {
  buy: "Открыть",
  contents: "Что внутри: механизм · когда включился · три действия под тебя",
  decline: "Не сейчас — страница останется",
};

export const formatPrice = (price: number): string => `${price} ₽`;

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
  hint: "Пары предложений мало — опиши, как оно обычно идёт",
  submitLabel: "Отправить",
  counterText: (state: { words: number }): string => `${state.words} слов`,
  short: "Бросил проект перед сдачей",
  medium: "Бросил проект перед сдачей, хотя оставалось",
  long:
    "Собирал этот проект четыре месяца, а за неделю до сдачи перестал открывать файл и в итоге отдал сырым, хотя всё было почти готово",
};

/** Тексты, объясняющие витрину. Продуктом не являются. */
export const mapLabel = "Карта: семь полос";
export const routeLabel = "Маршрут";
