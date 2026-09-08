/** Публичные типы движка. */

export type Confidence = "high" | "medium" | "low";
export type Band = "low" | "mid-low" | "mid" | "mid-high" | "high";

/**
 * Одна из 16 координат. Наружу пользователю не выводится никогда:
 * координаты — внутренний язык между моделями и текстом (docs/01-architecture.md).
 */
export interface CoordinateState {
  id: number;
  name: string;
  /** Человеческая формулировка положения для внутреннего чтения. */
  value: string | null;
  /** Машинный подтип: at_80, acceleration, bursts и т.д. */
  code: string | null;
  band: Band | null;
  confidence: Confidence;
  /** Откуда взято: «L2:C», «L9,L10». */
  sources: string[];
  flags: string[];
}

/**
 * Конфигурация из платного добора: пара ответов, которая координате не
 * принадлежит (например S4 × S5 в `slice_work`). Код и формулировка — из файла среза.
 */
export interface SliceConfiguration {
  slice: string;
  code: string;
  value: string;
  sources: string[];
}

export interface Profile {
  profileId: string;
  coordinates: Record<number, CoordinateState>;
  flags: string[];
  /** Узлы, сработавшие на ступени 3, по убыванию приоритета. */
  nodes: TriggeredNode[];
  dominantNode: string | null;
  nextPaidOffer: string;
  /** Конфигурации купленных доборов. Пусто, пока срез не пройден. */
  configurations: SliceConfiguration[];
}

export interface TriggeredNode {
  id: string;
  text: string;
  /** 1 — расхождение самооценки и поведения, 2 — узел с уязвимостью, 3 — остальные. */
  priority: 1 | 2 | 3;
  coordinates: number[];
}

export type ChoiceAnswer = string;
export type ScaleAnswer = 1 | 2 | 3 | 4 | 5;

export interface LadderAnswers {
  L1?: ChoiceAnswer;
  L2?: ChoiceAnswer;
  L3?: ChoiceAnswer;
  L4?: ChoiceAnswer;
  L5?: ChoiceAnswer;
  L6?: ScaleAnswer;
  L7?: ScaleAnswer;
  L8?: ChoiceAnswer;
  L9?: ScaleAnswer;
  L10?: ScaleAnswer;
  L11?: ScaleAnswer;
  L12?: string;
}

/**
 * Ответы полного банка 35+3: ключ — идентификатор вопроса из
 * `content/questions-full-bank.md` (Q1–Q35, О1–О3). Шкалы приходят числом,
 * варианты и открытые ответы — строкой.
 */
export type BankAnswers = Record<string, ScaleAnswer | ChoiceAnswer | undefined>;

/**
 * Ответ на вопрос-добор среза (`content/slices/*.md`): шкала числом, вариант
 * буквой, открытый ответ текстом. Тип «число» приходит числом, а если вопрос
 * спрашивает две величины сразу — массивом из двух чисел в порядке вопроса.
 */
export type SliceAnswer = number | number[] | ChoiceAnswer;

/** Ответы одного среза: ключ — идентификатор вопроса внутри среза (S1…Sn). */
export type SliceAnswers = Record<string, SliceAnswer | undefined>;

/**
 * Что разбор открытых ответов среза дал в машинном виде. Движок текста не
 * интерпретирует: коды и флаги приходят от LLM и проверяются по словарю среза.
 */
export interface SliceTextFindings {
  codes?: string[];
  flags?: string[];
  /** Развилка проверена и не касается медицины, юридики и безопасности. */
  safeTopic?: boolean;
}

/** Итог проверки порога генерации среза. */
export interface SliceThreshold {
  passed: boolean;
  /** Невыполненные пункты чек-листа — дословно из файла среза. */
  missing: string[];
  /** Уточняющие вопросы из файла среза. Пусто, если порог взят. */
  followUps: string[];
  /** Отчёт не пишем и уточняющих не задаём: нужен кризисный контур. */
  blocked: string | null;
}

export interface Step0Input {
  name: string;
  /** ISO-дата. Можно не указывать: тогда карточки периода не будет. */
  birthDate?: string;
}

export interface Step0Card {
  name: string;
  season: string | null;
  theme: string | null;
  metaphor: string | null;
  cta: string;
}

/** Абзац разбора. Ступени 1–3 — только lookup, ступень 4 — только LLM. */
export interface Block {
  step: 1 | 2 | 3 | 4;
  heading: string;
  paragraphs: string[];
  /** Фраза-сшивка или «цена силы» — визуально сильнее остальных абзацев. */
  highlight: string | null;
  source: "lookup" | "llm";
}

/** Полоса визуальной карты. Значений и чисел наружу не отдаёт. */
export interface MapBar {
  coordinate: number;
  label: string;
  poles: { low: string; high: string } | null;
  state: "empty" | "approximate" | "precise";
  /** Позиция маркера 0..1. null — координата закрыта. */
  position: number | null;
  /** Для категориальной полосы «Что задевает»: выбранный вариант из списка. */
  category: { options: string[]; selected: string | null } | null;
  hint: string;
}

export interface Door {
  id: string;
  title: string;
  state: "opens_with_answers" | "paid" | "open";
  /** Цена показывается только у предложенной двери. */
  price: number | null;
  slice: string | null;
}

export interface Offer {
  slice: string;
  title: string;
  price: number;
  promise: string;
  questionCount: string;
  file: string;
}

/** Задание для LLM: движок сам текстов ступени 4 не пишет. */
export interface LlmTask {
  prompt: string;
  input: {
    profile: Profile;
    node: TriggeredNode | null;
    shownBlocks: Block[];
    openAnswer: string;
  };
}

export interface Question {
  id: string;
  type: "выбор" | "шкала" | "открытый";
  text: string;
  options: { key: string; text: string }[];
  scale: { low: string; high: string } | null;
}

export interface Portion {
  step: 1 | 2 | 3 | 4;
  lead: string;
  questions: Question[];
}

export interface PageState {
  /** Последняя завершённая ступень. */
  step: 0 | 1 | 2 | 3 | 4;
  card: Step0Card | null;
  hook: string | null;
  map: MapBar[];
  blocks: Block[];
  doors: Door[];
  offer: Offer | null;
  nextPortion: Portion | null;
  llmTask: LlmTask | null;
  /** Внутреннее. На клиент не отдаётся (docs/11-ui-page-spec.md). */
  internalProfile: Profile;
}
