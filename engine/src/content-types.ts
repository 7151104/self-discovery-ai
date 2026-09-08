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

/** Вопрос полного банка 35+3 (content/questions-full-bank.md). */
export interface RawBankQuestion {
  /** Q1–Q35 для закрытых, О1–О3 для открытых. */
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
  /** Полный банк: 35 закрытых и 3 открытых вопроса. */
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
  };
  slices: {
    id: string;
    /** null — у среза нет своего файла доборов (полная карта, совместимость). */
    file: string | null;
    title: string;
    price: number;
    questionCount: string;
    coordinates: number[];
    promise: string;
  }[];
}
