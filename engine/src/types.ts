/** Публичные типы движка. */

import type { CrisisLevel } from "./content-extra-types.js";

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

/**
 * Три варианта «не согласен с этим» из docs/11-ui-page-spec.md. Формулировки те же,
 * что видит человек: словарь один и для интерфейса, и для правил скоринга.
 */
export type DisagreementKind = "это не про меня" | "частично" | "слишком общо";

/** Несогласие с блоком: данные, а не жалоба (content/scoring-rules.md). */
export interface Disagreement {
  /** Ступень блока, с которым человек не согласился. */
  step: 1 | 2 | 3 | 4;
  kind: DisagreementKind;
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

/**
 * Где показывается кризисный текст: на бесплатном входе или вместо блока платного
 * среза. На платном срез не собран, и деньги возвращаются полностью — молчание о
 * деньгах в этом состоянии читается как обман (content/crisis.md).
 */
export type CrisisPlace = "ladder" | "paid_slice";

/** Одно совпадение кризисного детектора: категория, форма из реестра и найденный фрагмент. */
export interface CrisisHit {
  /** Идентификатор категории: `CRISIS_SUICIDE`, `CRISIS_LOSS`… */
  category: string;
  level: CrisisLevel;
  /** Форма из реестра, которая совпала. */
  form: string;
  /** Совпавший фрагмент текста как он написан. */
  match: string;
}

/**
 * Решение детектора. Человеку не выводится: это вход для страницы и для слоя
 * генерации. Оценки состояния и его причин здесь нет — детектор ловит
 * формулировку, а не ставит диагноз.
 */
export interface CrisisDecision {
  /** Разбор не выдаётся, предложение не показывается, текст в модель не уходит. */
  blocked: boolean;
  /** Показать текст поддержки и контакты — рядом с разбором либо вместо него. */
  support: boolean;
  hits: CrisisHit[];
  /** Сработавшие категории в порядке реестра. */
  categories: string[];
  /**
   * Категории, тему которых разбор не трогает, хотя сам он выдаётся: уровень
   * `с оговоркой` без второй сработавшей категории.
   */
  avoid: string[];
  /** Причина решения — действие категории дословно из контента. `null`, если разбор выдаётся. */
  reason: string | null;
}

/** Что человек видит вместо разбора: тексты по идентификаторам и контакты помощи. */
export interface CrisisNotice {
  place: CrisisPlace;
  /** Сработавшие категории. Формулировок человека наружу не уходит. */
  categories: string[];
  /**
   * `false` — контакты помощи не заполнены, и кризисный текст публиковать нельзя.
   * Разбор при этом всё равно не выдаётся: решение детектора от контактов не зависит.
   */
  publishable: boolean;
  texts: { id: string; text: string }[];
  contacts: { title: string; value: string }[];
}

/**
 * Промежуточный lookup-блок между порциями добора (content/slices/README.md,
 * правило 6). Ступени лестницы у него нет: он привязан к срезу и к номеру
 * порции, после которой выдаётся. Текст берётся из файла среза, LLM не участвует.
 */
export interface InterludeBlock {
  slice: string;
  /** После какой порции добора блок выдаётся. */
  afterPortion: number;
  heading: string;
  paragraphs: string[];
  source: "lookup";
}

/**
 * Полоса визуальной карты. Значений и чисел наружу не отдаёт, номера координаты —
 * тем более: полоса опознаётся устойчивым ключом из docs/11-ui-page-spec.md.
 */
export interface MapBar {
  key: string;
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

/**
 * Всё, что уходит на клиент. Профиля, кодов координат и заданий для LLM здесь
 * нет по устройству типа, а не по внимательности читающего (docs/11-ui-page-spec.md).
 */
export interface PageView {
  /** Последняя завершённая ступень. */
  step: 0 | 1 | 2 | 3 | 4;
  card: Step0Card | null;
  hook: string | null;
  map: MapBar[];
  blocks: Block[];
  doors: Door[];
  offer: Offer | null;
  nextPortion: Portion | null;
  /** Кризисное состояние: разбора нет и платного предложения нет вовсе. `null` — обычная страница. */
  crisis: CrisisNotice | null;
}

/**
 * Внутренняя половина состояния: наружу не отдаётся ни целиком, ни полем.
 * Задание для LLM лежит здесь, потому что несёт профиль внутри себя.
 */
export interface PageInternals {
  profile: Profile;
  llmTask: LlmTask | null;
}

/** Состояние страницы: публичная половина и внутренняя, без общих полей. */
export interface PageState {
  view: PageView;
  internal: PageInternals;
}
