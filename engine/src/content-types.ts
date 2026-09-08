/** Формы данных, которые сборщик достаёт из markdown. См. engine/scripts/build-content.mjs */

export type QuestionType = "выбор" | "шкала" | "открытый";

export interface RawCoordinate {
  id: number;
  name: string;
  description: string;
}

export interface RawQuestion {
  id: string;
  type: QuestionType;
  /** Номер в полном банке: Q4, О1 и т.д. */
  source: string;
  coordinates: number[];
  /** Ступень лестницы, в порции которой задаётся вопрос. */
  step: number;
  text: string;
  options: { key: string; text: string }[];
  scale: { low: string; high: string } | null;
}

/** Направление вопроса относительно группы вопросов его основной координаты. */
export type QuestionDirection = "прямой" | "обратный";

/** Роль вопроса в координате: ключевой побеждает при расхождении, «низкий вес» даёт только low. */
export type QuestionRole = "ключевой" | "низкий вес";

/** Вопрос полного банка 40+3 (content/questions-full-bank.md). */
export interface RawBankQuestion {
  /** Q1–Q40 для закрытых, О1–О3 для открытых. */
  id: string;
  type: QuestionType;
  text: string;
  /** Первая координата — основная, остальные вопрос дополняет. */
  coordinates: number[];
  /** У типов «выбор» и «открытый» всегда «прямой»: инверсия определена только для шкал. */
  direction: QuestionDirection;
  role: QuestionRole | null;
  options: { key: string; text: string }[];
  /** Тематический блок банка, в котором записан вопрос. */
  block: string;
}

/** Тип вопроса-добора: у срезов к трём типам лестницы добавляется «число». */
export type SliceQuestionType = QuestionType | "число";

/** Вопрос-добор среза (content/slices/*.md, раздел «Вопросы-доборы» или «Порция N»). */
export interface RawSliceQuestion {
  /** S1…Sn внутри среза. */
  id: string;
  /** Порция выдачи: 1 у узловых срезов, 1 и 2 у прикладных. */
  portion: number;
  type: SliceQuestionType;
  text: string;
  /** Какие из 16 координат питает; пусто — вопрос работает в паре с другим. */
  coordinates: number[];
  options: { key: string; text: string }[];
  /** Вопрос повторяет варианты другого («как в S4»); варианты уже подставлены. */
  sameAs: string | null;
  /** Колонка «Зачем в отчёте»: назначение ответа. */
  purpose: string;
}

/** Подтип координаты из раздела «Скоринг доборов»: код и формулировка внутрь профиля. */
export interface RawSliceSubtype {
  code: string;
  text: string;
}

/** Порог генерации среза: пункты чек-листа и уточняющие вопросы — тексты из контента. */
export interface RawSliceThreshold {
  checks: string[];
  followUps: string[];
}

/**
 * Обязательный вход среза: описание в свободной форме, без которого добор
 * бессмыслен. Выдаётся первым вопросом первой порции под идентификатором `entry`.
 */
export interface RawSliceEntry {
  text: string;
  minWords: number;
}

/** Строка таблицы «Следующие двери»: условие текстом и один срез. Последняя — «иначе». */
export interface RawNextDoor {
  condition: string;
  slice: string;
}

export interface RawSlice {
  id: string;
  /** null — файла доборов нет: он либо не нужен, либо ещё не написан. */
  file: string | null;
  /** Файл объявлен в README, но ещё не написан (пометка «Ещё не написан»). */
  plannedFile: string | null;
  title: string;
  price: number;
  questionCount: string;
  coordinates: number[];
  promise: string;
  questions: RawSliceQuestion[];
  subtypes: RawSliceSubtype[];
  /** null — у среза нет файла, а значит и порога. */
  threshold: RawSliceThreshold | null;
  /** null — обязательного входа у среза нет, добор начинается сразу с вопросов. */
  entry: RawSliceEntry | null;
  nextDoors: RawNextDoor[];
}

export interface RawBranch {
  label: string;
  text: string;
}

export interface RawScaleBranch {
  from: number;
  to: number;
  text: string;
}

/** Строка матрицы сшивок ступени 1: пара ответов плюс возможные доп. условия. */
export interface RawPairRow {
  first: string;
  firstExtra: Record<string, string>;
  second: string;
  secondExtra: Record<string, string>;
  text: string;
}

/** Строка матрицы «цена силы» ступени 2: ответ на L5 плюс диапазон L6. */
export interface RawRangeRow {
  first: string;
  firstExtra: Record<string, string>;
  range: { from: number; to: number };
  text: string;
}

export interface RawContent {
  coordinates: RawCoordinate[];
  questions: RawQuestion[];
  /** Полный банк: 40 закрытых и 3 открытых вопроса. */
  bank: RawBankQuestion[];
  /** Подводка к порции по номеру ступени. */
  leads: Record<string, string>;
  step0: {
    themes: { season: string; theme: string }[];
    metaphors: { season: string; theme: string; text: string }[];
  };
  step1: {
    heading: string;
    branches: Record<string, Record<string, RawBranch>>;
    matrix: RawPairRow[];
  };
  step2: {
    heading: string;
    branches: Record<string, Record<string, RawBranch>>;
    scales: Record<string, RawScaleBranch[]>;
    matrix: RawRangeRow[];
  };
  step3: {
    heading: string;
    nodes: { id: string; condition: string; text: string }[];
    offers: Record<string, string>;
  };
  step4: {
    heading: string;
    prompt: string;
    offerTemplate: string;
    /** Порог открытого ответа: короче — сюжет не пишется (`content/questions-ladder.md`). */
    minWords: number;
  };
  slices: RawSlice[];
}
