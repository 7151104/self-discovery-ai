/**
 * Rule Engine: ответы → профиль из 16 координат.
 *
 * Реализует content/scoring-rules.md. Две ветки входа — бесплатная лестница
 * (`buildProfile`, раздел «Лестница 11+1: точные правила») и полный банк 35+3
 * (`buildProfileFromBank`, раздел «Полный банк: точные правила») — считают числа
 * одной общей функцией `scoreCoordinate`: инверсия обратных вопросов, усреднение,
 * полоса, разброс и confidence живут только в ней.
 *
 * Здесь не должно появляться ни одного правила, которого нет в контенте.
 */

import { rawContent } from "./generated/content.js";
import type {
  Band,
  BankAnswers,
  Confidence,
  CoordinateState,
  Disagreement,
  DisagreementKind,
  LadderAnswers,
  Profile,
} from "./types.js";

interface Assignment {
  value: string;
  code: string;
  band: Band | null;
  confidence: Confidence;
  sources: string[];
  flags?: string[];
}

const emptyCoordinates = (): Record<number, CoordinateState> => {
  const out: Record<number, CoordinateState> = {};
  for (const coordinate of rawContent.coordinates) {
    out[coordinate.id] = {
      id: coordinate.id,
      name: coordinate.name,
      value: null,
      code: null,
      band: null,
      confidence: "low",
      sources: [],
      flags: [],
    };
  }
  return out;
};

// ── Общая арифметика: одна для лестницы и для полного банка ───────────────────

/** Куда указывает ответ по оси координаты: 1 — верх, −1 — низ, 0 — ответ молчит. */
export type Pointer = -1 | 0 | 1;

/** Шкальный ответ координаты: участвует в усреднении, обратный инвертируется. */
export interface ScaleEvidence {
  kind: "шкала";
  question: string;
  value: number;
  reversed: boolean;
}

/**
 * Ответ, который только указывает сторону и в усреднении не участвует:
 * вариант выбора или шкала, дополняющая чужую координату.
 */
export interface PointerEvidence {
  kind: "указание";
  question: string;
  answer: string;
  direction: Pointer;
  /** Ключевой (поведенческий) ответ: значение координаты берётся из него. */
  key?: boolean;
  /** Роль «низкий вес» из банка: сам по себе даёт только low. */
  lowWeight?: boolean;
  /** Ответ пришёл из шкалы, то есть остаётся самоотчётом. */
  selfReport?: boolean;
}

export type Evidence = ScaleEvidence | PointerEvidence;

export interface CoordinateScore {
  /** Среднее приведённых шкальных ответов; null — шкал нет. */
  mean: number | null;
  band: Band | null;
  /** Разброс согласных шкальных ответов. */
  spread: number;
  direction: Pointer;
  confidence: Confidence;
  sources: string[];
  /** Ответы, спорящие с итогом. */
  conflicting: string[];
  /** Шкальные самоотчёты, которые спорят с ключевым поведенческим ответом. */
  selfReportConflicts: string[];
}

/** Обратный вопрос: 1↔5, 2↔4, 3→3. */
export const reverseScale = (value: number): number => 6 - value;

/** Среднее → полоса. Таблица из content/scoring-rules.md. */
export function bandFromMean(mean: number): Band {
  if (mean <= 2.0) return "low";
  if (mean <= 2.6) return "mid-low";
  if (mean <= 3.3) return "mid";
  if (mean <= 3.9) return "mid-high";
  return "high";
}

const BAND_POINTER: Record<Band, Pointer> = { low: -1, "mid-low": -1, mid: 0, "mid-high": 1, high: 1 };

/** Куда смотрит один шкальный ответ: та же таблица полос, что и для среднего. */
export const pointerOf = (value: number): Pointer => BAND_POINTER[bandFromMean(value)];

const bandOfPointer = (direction: Pointer): Band => (direction === 1 ? "high" : direction === -1 ? "low" : "mid");

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Потолок confidence: правила лестницы задают его таблицей в контенте. */
export const capConfidence = (confidence: Confidence, cap?: Confidence): Confidence =>
  cap && RANK[confidence] > RANK[cap] ? cap : confidence;

/**
 * Единственное место, где считаются числа: инверсия обратных вопросов, среднее,
 * полоса, разброс и confidence по числу согласных ответов (content/scoring-rules.md,
 * разделы «Шкальные вопросы», «Уверенность», «Категориальные», «Правило расхождения»).
 *
 * Возвращает null, если ни один ответ ничего не сообщает.
 */
export function scoreCoordinate(
  evidence: Evidence[],
  options: { cap?: Confidence; confirmedByText?: boolean } = {},
): CoordinateScore | null {
  const entries = evidence.map((item) =>
    item.kind === "шкала"
      ? {
          item,
          label: `${item.question}:${item.value}`,
          normalized: item.reversed ? reverseScale(item.value) : item.value,
        }
      : { item, label: `${item.question}:${item.answer}`, normalized: null as number | null },
  );

  // Категориальный ответ без направления координате ничего не сообщает и источником не считается.
  const used = entries.filter(
    (entry) => entry.item.kind === "шкала" || entry.item.key === true || entry.item.direction !== 0,
  );
  if (!used.length) return null;

  const scales = used.filter((entry) => entry.normalized !== null);
  const mean = scales.length ? scales.reduce((sum, entry) => sum + (entry.normalized ?? 0), 0) / scales.length : null;
  const band = mean === null ? null : bandFromMean(mean);

  const pointerAt = (entry: (typeof used)[number]): Pointer =>
    entry.normalized !== null ? pointerOf(entry.normalized) : entry.item.kind === "указание" ? entry.item.direction : 0;

  const key = used.find((entry) => entry.item.kind === "указание" && entry.item.key === true);
  const bandPointer = band ? BAND_POINTER[band] : 0;
  // Если среднее по шкалам легло в середину, сторону задают только категориальные
  // ответы: отдельная шкала уже учтена в среднем и второй раз не голосует.
  const fromPointers = used
    .filter((entry) => entry.item.kind === "указание")
    .map((entry) => pointerAt(entry))
    .find((pointer) => pointer !== 0);
  const direction: Pointer =
    key && key.item.kind === "указание" ? key.item.direction : bandPointer !== 0 ? bandPointer : (fromPointers ?? 0);

  const conflicting = used.filter((entry) => direction !== 0 && pointerAt(entry) !== 0 && pointerAt(entry) !== direction);
  const agreeing = used.filter((entry) => entry === key || (direction !== 0 && pointerAt(entry) === direction));
  // Ответ, который не указывает ни в одну сторону, не спорит, но и не подтверждает.
  const quiet = used.filter((entry) => !conflicting.includes(entry) && !agreeing.includes(entry));

  // Правило расхождения: самоотчёт против ключевого поведенческого ответа не
  // понижает уверенность, а уходит во флаг и в раздел напряжения.
  const selfReport = key
    ? conflicting.filter((entry) => entry.item.kind === "шкала" || entry.item.selfReport === true)
    : [];
  const hard = conflicting.filter((entry) => !selfReport.includes(entry));

  const agreeingScales = agreeing.map((entry) => entry.normalized).filter((value): value is number => value !== null);
  const spread = agreeingScales.length ? Math.max(...agreeingScales) - Math.min(...agreeingScales) : 0;
  const lowWeightOnly = agreeing.every((entry) => entry.item.kind === "указание" && entry.item.lowWeight === true);
  const supported = agreeing.length + quiet.length;

  let confidence: Confidence;
  // Середина полосы: положение не определено. К ключевому ответу это не относится —
  // он даёт категорию, а не точку на шкале.
  if (key === undefined && direction === 0) confidence = "low";
  else if (options.confirmedByText) confidence = "high";
  else if (lowWeightOnly && agreeing.length < 2) confidence = "low";
  else if (!hard.length && agreeing.length >= 3 && spread <= 1) confidence = "high";
  else if (!hard.length && agreeing.length >= 2 && key !== undefined) confidence = "high";
  else if (supported >= 2 && direction !== 0) confidence = "medium";
  else if (key !== undefined) confidence = "medium";
  else confidence = "low";

  return {
    mean,
    band,
    spread,
    direction,
    confidence: capConfidence(confidence, options.cap),
    sources: used.map((entry) => entry.label),
    conflicting: hard.map((entry) => entry.label),
    selfReportConflicts: selfReport.map((entry) => entry.label),
  };
}

// ── Полюса координат и таблицы вариантов: общие для обеих ветвей ──────────────

/** Что означают верх, середина и низ оси координаты: [значение, код]. */
type AxisLabels = { high: [string, string]; mid: [string, string]; low: [string, string] };

/**
 * Полоса координаты растёт в сторону второго полюса из docs/02-coordinates.md.
 * Исключение — координата 5: полоса растёт к «определённости», а карта
 * разворачивает её при показе (`engine/src/map.ts`).
 */
const AXIS: Record<number, AxisLabels> = {
  1: {
    high: ["восстанавливается в одиночестве", "solitude"],
    mid: ["оба режима по ситуации", "mixed"],
    low: ["восстанавливается в контакте с людьми", "contact"],
  },
  2: {
    high: ["импульсы с провалами", "bursts"],
    mid: ["по-разному", "mixed"],
    low: ["ровный поток", "even"],
  },
  3: {
    high: ["связи, смыслы, возможности", "connections"],
    mid: ["оба режима по ситуации", "mixed"],
    low: ["конкретное и проверяемое", "concrete"],
  },
  4: {
    high: ["люди и влияние на них", "people"],
    mid: ["оба режима по ситуации", "mixed"],
    low: ["логика и критерии", "logic"],
  },
  5: {
    high: ["определённость и план", "structure"],
    mid: ["оба режима по ситуации", "mixed"],
    low: ["свобода и открытый финал", "openness"],
  },
  6: {
    high: ["опора на проверенное", "proven"],
    mid: ["оба режима по ситуации", "mixed"],
    low: ["тяга к незнакомому", "novelty"],
  },
  7: {
    high: ["задевает надолго", "holds_long"],
    mid: ["тяжёлое держится, обычное уходит", "selective"],
    low: ["отпускает быстро", "releases"],
  },
  11: {
    high: ["связка рвётся", "breaks"],
    mid: ["по-разному", "mixed"],
    low: ["довожу почти всё начатое", "completes"],
  },
  12: {
    high: ["продавливает своё", "competition"],
    mid: ["оба режима по ситуации", "mixed"],
    low: ["встраивается и уступает", "cooperation"],
  },
  13: {
    high: ["двигается на внешний запрос и срок", "needs_external_pull"],
    mid: ["по ситуации", "mixed"],
    low: ["начинает сам", "self_starting"],
  },
};

const labelFor = (coordinate: number, direction: Pointer): [string, string] => {
  const axis = AXIS[coordinate];
  if (!axis) throw new Error(`Для координаты ${coordinate} не заданы полюса`);
  return direction === 1 ? axis.high : direction === -1 ? axis.low : axis.mid;
};

type OptionRow = Omit<Assignment, "sources" | "confidence">;

/** Q4 / L1 — ритм расхода (координата 2). */
const RHYTHM: Record<string, OptionRow> = {
  A: { value: "ровный поток", code: "even", band: "low" },
  B: { value: "импульсы с провалами", code: "bursts", band: "high" },
  C: { value: "сильный старт, спад к середине", code: "front_loaded", band: "mid-high" },
  D: { value: "долгая раскачка, рывок к финишу", code: "late_surge", band: "mid-high" },
};

/** Q24 / L2 — где рвётся «решил — сделал» (координата 11). */
const COMPLETION: Record<string, OptionRow> = {
  A: { value: "не начинаю", code: "no_start", band: "high" },
  B: { value: "схожу на первой трудности", code: "first_obstacle", band: "mid-high" },
  C: { value: "рвётся на 80%", code: "at_80", band: "mid-high" },
  D: { value: "довожу с опозданием и надрывом", code: "late_strain", band: "mid-low" },
  E: { value: "довожу почти всё начатое", code: "completes", band: "low" },
};

/** Q20 / L3 — сценарий под стрессом (координата 9). */
const STRESS: Record<string, OptionRow> = {
  A: { value: "ускоряюсь и беру на себя больше", code: "acceleration", band: "high" },
  B: { value: "замираю", code: "freeze", band: "low" },
  C: { value: "забираю управление", code: "control", band: "high" },
  D: { value: "ухожу внутрь", code: "withdrawal", band: "low" },
  E: { value: "ищу, где и по чьей вине сломалось", code: "blame", band: "mid-high" },
  F: { value: "переключаюсь на тех, кому плохо", code: "rescue", band: "mid" },
};

/** Q34 / L8 — базовая уязвимость (координата 8). */
const VULNERABILITY: Record<string, { value: string; code: string }> = {
  A: { value: "не воспринимают всерьёз", code: "not_taken_seriously" },
  B: { value: "потеря контроля", code: "loss_of_control" },
  C: { value: "отвержение", code: "rejection" },
  D: { value: "ненужность", code: "insignificance" },
  E: { value: "оказаться неправым", code: "being_wrong" },
  F: { value: "ограничение", code: "restriction" },
  G: { value: "бессмысленность", code: "meaninglessness" },
};

/** Q29 — способ входа в дело (координата 13). Ключевого вопроса в лестнице нет. */
const ENTRY: Record<string, OptionRow> = {
  A: { value: "начинает сам", code: "self_starting", band: "low" },
  B: { value: "входит по приглашению", code: "invited", band: "high" },
  C: { value: "входит по чужому запросу", code: "on_request", band: "high" },
  D: { value: "пробует много и остаётся в том, что пошло", code: "many_tries", band: "mid" },
};

/** Q35 — ведущий мотив (координата 10). Значение берётся из текста варианта в банке. */
const MOTIVE_CODES: Record<string, string> = {
  A: "recognition",
  B: "safety",
  C: "freedom",
  D: "closeness",
  E: "rightness",
  F: "influence",
  G: "meaning",
};

/** Стойки для координаты 9 (content/scoring-rules.md). */
type Stance = "active" | "passive" | "other";

/** Q20 / L3 — что делаю, когда дело рушится. */
const STRESS_STANCE: Record<string, Stance> = {
  A: "active",
  C: "active",
  E: "active",
  B: "passive",
  D: "passive",
  F: "other",
};

/** Q21 / L4 — реакция на критику при других. */
const CRITIQUE_STANCE: Record<string, Stance> = { A: "active", E: "active", B: "passive", C: "passive", D: "passive" };

/** Согласие второго ответа с стойкой ключевого: 0 — стойки несравнимы. */
const stancePointer = (key: Stance | undefined, other: Stance | undefined): Pointer =>
  !key || !other || key === "other" || other === "other" ? 0 : key === other ? 1 : -1;

/** Q8 / L5 — первый вопрос о новой возможности: тип внимания (координата 3). */
const ATTENTION_POINTER: Record<string, Pointer> = { A: -1, B: -1, C: 0, D: 1 };

/** Q8 / L5 — то же для основания решений (координата 4). */
const DECISION_POINTER: Record<string, Pointer> = { A: -1, B: 0, C: 1, D: 0 };

/** Q11 — выбор между выгодой и людьми: основание решений (координата 4). */
const TRADEOFF_POINTER: Record<string, Pointer> = { A: -1, B: 1, C: -1, D: 0 };

/** Сигналы, которыми подтверждается уязвимость (content/scoring-rules.md). */
interface VulnerabilitySignals {
  /** Ответ про критику при других: Q21 в банке, L4 в лестнице. */
  critique?: { question: string; answer: string } | undefined;
  /** Ответ про рухнувшее дело: Q20 в банке, L3 в лестнице. */
  stress?: { question: string; answer: string } | undefined;
  /** Шкала «оставляю решение открытым»: Q13 в банке, L10 в лестнице. */
  openEnded?: { question: string; value: number } | undefined;
}

/** Второй ответ, подтверждающий выбранную уязвимость, или null. */
function vulnerabilitySupport(option: string, signals: VulnerabilitySignals): PointerEvidence | null {
  const { critique, stress, openEnded } = signals;
  const support = (source: { question: string; answer: string } | undefined): PointerEvidence | null =>
    source ? { kind: "указание", question: source.question, answer: source.answer, direction: 1 } : null;

  switch (option) {
    case "A":
      return critique && (critique.answer === "A" || critique.answer === "E") ? support(critique) : null;
    case "B":
      return stress && stress.answer === "C" ? support(stress) : null;
    case "C":
      return critique && (critique.answer === "B" || critique.answer === "C") ? support(critique) : null;
    case "D":
      return stress && stress.answer === "F" ? support(stress) : null;
    case "E":
      return critique && critique.answer === "A" ? support(critique) : null;
    case "F":
      return openEnded && openEnded.value >= 4
        ? { kind: "указание", question: openEnded.question, answer: String(openEnded.value), direction: 1 }
        : null;
    default:
      // G — бессмысленность: подтверждения закрытыми вопросами нет.
      return null;
  }
}

export interface ProfileOptions {
  profileId?: string;
  /** Результат синтеза ступени 4: сюжет из открытого ответа (координата 15). */
  storyline?: { value: string; code: string; confidence: Confidence };
  /** Результат синтеза открытого О3: задача периода (координата 16). */
  periodTask?: { value: string; code: string; confidence: Confidence };
}

/** Потолки confidence лестницы (content/scoring-rules.md, «Что лестница закрывает и что нет»). */
export const LADDER_CAP: Record<number, Confidence> = {
  2: "medium",
  3: "medium",
  4: "low",
  5: "medium",
  7: "medium",
  13: "low",
  15: "medium",
};

function createProfile(options: ProfileOptions): {
  profile: Profile;
  assign: (id: number, assignment: Assignment) => void;
} {
  const coordinates = emptyCoordinates();
  const flags: string[] = [];

  const profile: Profile = {
    profileId: options.profileId ?? "local",
    coordinates,
    flags,
    nodes: [],
    dominantNode: null,
    nextPaidOffer: rawContent.step3.offers["default"] ?? "slice_node_finish",
    configurations: [],
  };

  const assign = (id: number, assignment: Assignment): void => {
    const coordinate = coordinates[id];
    if (!coordinate) throw new Error(`Неизвестная координата ${id}`);
    coordinate.value = assignment.value;
    coordinate.code = assignment.code;
    coordinate.band = assignment.band;
    coordinate.confidence = assignment.confidence;
    coordinate.sources = assignment.sources;
    coordinate.flags = assignment.flags ?? [];
    for (const flag of coordinate.flags) if (!flags.includes(flag)) flags.push(flag);
  };

  return { profile, assign };
}

/** Координата 15 и 16 приходят из синтеза открытых ответов, а не из арифметики. */
function assignSynthesis(assign: (id: number, assignment: Assignment) => void, options: ProfileOptions): void {
  if (options.storyline) {
    assign(15, {
      value: options.storyline.value,
      code: options.storyline.code,
      band: null,
      confidence: options.storyline.confidence,
      sources: ["L12"],
    });
  }
  if (options.periodTask) {
    assign(16, {
      value: options.periodTask.value,
      code: options.periodTask.code,
      band: null,
      confidence: options.periodTask.confidence,
      sources: ["О3"],
    });
  }
}

// ── Ветка входа 1: бесплатная лестница 11+1 ───────────────────────────────────

export function buildProfile(answers: LadderAnswers, options: ProfileOptions = {}): Profile {
  const { profile, assign } = createProfile(options);

  const choice = (question: string, answer: string | undefined, direction: Pointer, key = false): PointerEvidence[] =>
    answer === undefined ? [] : [{ kind: "указание", question, answer, direction, key }];
  const scale = (question: string, value: number | undefined, reversed = false): ScaleEvidence[] =>
    value === undefined ? [] : [{ kind: "шкала", question, value, reversed }];
  const pointerScale = (question: string, value: number | undefined): PointerEvidence[] =>
    value === undefined ? [] : [{ kind: "указание", question, answer: String(value), direction: pointerOf(value) }];

  // Координата 2 — ритм расхода. Один ключевой ситуационный вопрос: потолок medium.
  const rhythm = answers.L1 ? RHYTHM[answers.L1] : undefined;
  if (rhythm) {
    const score = scoreCoordinate(choice("L1", answers.L1, BAND_POINTER[rhythm.band ?? "mid"], true), {
      cap: LADDER_CAP[2],
    });
    if (score) assign(2, { ...rhythm, confidence: score.confidence, sources: score.sources });
  }

  // Координата 11 — доведение. L2 поведенческий и главный, L11 — самооценка.
  const completion = answers.L2 ? COMPLETION[answers.L2] : undefined;
  if (completion) {
    const score = scoreCoordinate([
      ...choice("L2", answers.L2, answers.L2 === "E" ? -1 : 1, true),
      ...scale("L11", answers.L11),
    ]);
    // Флаг ставится по таблице раздела лестницы: самооценка «нужен внешний срок»
    // против поведенческого «довожу почти всё».
    const mismatch = answers.L2 === "E" && (answers.L11 ?? 0) >= 4;
    if (score) {
      assign(11, {
        ...completion,
        confidence: score.confidence,
        sources: score.sources,
        flags: mismatch ? ["self_report_mismatch_11"] : [],
      });
    }
  }

  // Координата 9 — сценарий под стрессом. L3 ключевой, L4 подтверждает стойку.
  const stress = answers.L3 ? STRESS[answers.L3] : undefined;
  if (stress && answers.L3) {
    const stance = STRESS_STANCE[answers.L3];
    const score = scoreCoordinate([
      ...choice("L3", answers.L3, 1, true),
      ...choice("L4", answers.L4, stancePointer(stance, answers.L4 ? CRITIQUE_STANCE[answers.L4] : undefined)),
    ]);
    if (score) assign(9, { ...stress, confidence: score.confidence, sources: score.sources });
  }

  // Координата 8 — базовая уязвимость. L8 ключевой, второй ответ подтверждает.
  const vulnerability = answers.L8 ? VULNERABILITY[answers.L8] : undefined;
  if (vulnerability && answers.L8) {
    const support = vulnerabilitySupport(answers.L8, {
      critique: answers.L4 ? { question: "L4", answer: answers.L4 } : undefined,
      stress: answers.L3 ? { question: "L3", answer: answers.L3 } : undefined,
      openEnded: answers.L10 !== undefined ? { question: "L10", value: answers.L10 } : undefined,
    });
    const score = scoreCoordinate([...choice("L8", answers.L8, 1, true), ...(support ? [support] : [])]);
    if (score) assign(8, { ...vulnerability, band: null, confidence: score.confidence, sources: score.sources });
  }

  // Координата 3 — тип внимания. L5 (категориальный) + L7 (обратная шкала).
  {
    const pointer = answers.L5 ? (ATTENTION_POINTER[answers.L5] ?? 0) : 0;
    const score = scoreCoordinate(
      [...choice("L5", answers.L5, pointer), ...scale("L7", answers.L7, true)],
      { cap: LADDER_CAP[3] },
    );
    if (score) {
      const [value, code] = labelFor(3, score.direction);
      const conflict = score.conflicting.length > 0;
      assign(3, {
        value: conflict ? "конкретика и связи спорят между собой" : value,
        code: conflict ? "mixed" : code,
        band: conflict ? "mid" : bandForDirection(score),
        confidence: score.confidence,
        sources: score.sources,
      });
    }
  }

  // Координата 4 — основание решений. В лестнице только косвенно, потолок low.
  {
    const pointer = answers.L5 ? (DECISION_POINTER[answers.L5] ?? 0) : 0;
    const score = pointer === 0 ? null : scoreCoordinate(choice("L5", answers.L5, pointer), { cap: LADDER_CAP[4] });
    if (score) {
      const [value, code] = labelFor(4, score.direction);
      assign(4, { value, code, band: bandOfPointer(score.direction), confidence: score.confidence, sources: score.sources });
    }
  }

  // Координата 5 — отношение к структуре. L9 прямой, L10 обратный.
  if (answers.L9 !== undefined && answers.L10 !== undefined) {
    const score = scoreCoordinate([...scale("L9", answers.L9), ...scale("L10", answers.L10, true)], {
      cap: LADDER_CAP[5],
    });
    const contradiction = answers.L9 >= 4 && answers.L10 >= 4;
    if (score) {
      const [value, code] = labelFor(5, score.direction);
      assign(5, {
        value: contradiction ? "хочет определённости и сам оставляет открытым" : value,
        code: contradiction ? "plan_vs_open" : code,
        band: contradiction ? "mid" : bandForDirection(score),
        confidence: contradiction ? "low" : score.confidence,
        sources: score.sources,
        flags: contradiction ? ["contradiction_plan_vs_open"] : [],
      });
    }
  }

  // Координата 7 — эмоциональная реактивность. L6 задаёт полосу, L4 подтверждает.
  if (answers.L6 !== undefined) {
    const holds = answers.L4 === "B" || answers.L4 === "C";
    const releases = answers.L4 === "A" || answers.L4 === "D";
    const score = scoreCoordinate(
      [...scale("L6", answers.L6), ...choice("L4", answers.L4, holds ? 1 : releases ? -1 : 0)],
      { cap: LADDER_CAP[7] },
    );
    if (score) {
      const band = score.band ?? "mid";
      const [value, code] = labelFor(7, BAND_POINTER[band]);
      assign(7, { value, code, band, confidence: score.confidence, sources: score.sources });
    }
  }

  // Координата 13 — способ входа. Ключевой Q29 в лестнице не задаётся: потолок low.
  if (answers.L11 !== undefined) {
    const score = scoreCoordinate(scale("L11", answers.L11), { cap: LADDER_CAP[13] });
    if (score) {
      const band = score.band ?? "mid";
      const [value, code] = labelFor(13, BAND_POINTER[band]);
      assign(13, { value, code, band, confidence: score.confidence, sources: score.sources });
    }
  }

  // Координаты 15 и 16 — только из синтеза открытых ответов.
  assignSynthesis(assign, options);

  return profile;
}

/** Полоса, согласованная с итоговым направлением: если среднее спорит с ним, берётся полюс. */
function bandForDirection(score: CoordinateScore): Band {
  if (!score.band) return bandOfPointer(score.direction);
  return BAND_POINTER[score.band] === score.direction || score.direction === 0
    ? score.band
    : bandOfPointer(score.direction);
}

// ── Ветка входа 2: полный банк 35+3 ───────────────────────────────────────────

const bankQuestion = (id: string) => {
  const question = rawContent.bank.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`В content/questions-full-bank.md нет вопроса ${id}`);
  return question;
};

const scaleAnswer = (answers: BankAnswers, id: string): number | undefined => {
  const value = answers[id];
  return typeof value === "number" ? value : undefined;
};

const choiceAnswer = (answers: BankAnswers, id: string): string | undefined => {
  const value = answers[id];
  return typeof value === "string" && value.length ? value : undefined;
};

/** Текст выбранного варианта из банка: значение координаты берётся из контента. */
const optionText = (id: string, answer: string): string => {
  const option = bankQuestion(id).options.find((candidate) => candidate.key === answer);
  if (!option) throw new Error(`${id}: в банке нет варианта ${answer}`);
  return option.text;
};

/**
 * Профиль по полному банку 35+3.
 *
 * Правила — content/scoring-rules.md, раздел «Полный банк: точные правила».
 * Арифметика — та же `scoreCoordinate`, что и в лестнице. Открытые ответы
 * движок не интерпретирует: координаты 15 и 16 приходят из синтеза.
 */
export function buildProfileFromBank(answers: BankAnswers, options: ProfileOptions = {}): Profile {
  const { profile, assign } = createProfile(options);

  /** Основной шкальный вопрос координаты: направление из банка, `mirror` — разворот группы к оси. */
  const scale = (id: string, mirror = false): ScaleEvidence[] => {
    const value = scaleAnswer(answers, id);
    if (value === undefined) return [];
    const reversed = (bankQuestion(id).direction === "обратный") !== mirror;
    return [{ kind: "шкала", question: id, value, reversed }];
  };

  /** Дополняющий шкальный вопрос: только указывает сторону оси, в усреднении не участвует. */
  const support = (id: string, mirror = false): PointerEvidence[] => {
    const value = scaleAnswer(answers, id);
    if (value === undefined) return [];
    const reversed = (bankQuestion(id).direction === "обратный") !== mirror;
    const normalized = reversed ? reverseScale(value) : value;
    return [
      { kind: "указание", question: id, answer: String(value), direction: pointerOf(normalized), selfReport: true },
    ];
  };

  /** Категориальный вопрос: направление по таблице вариантов. */
  const choice = (id: string, table: Record<string, Pointer>, key = false): PointerEvidence[] => {
    const answer = choiceAnswer(answers, id);
    if (answer === undefined) return [];
    const question = bankQuestion(id);
    return [
      {
        kind: "указание",
        question: id,
        answer,
        direction: table[answer] ?? 0,
        key,
        lowWeight: question.role === "низкий вес",
      },
    ];
  };

  const optionPointers = (table: Record<string, OptionRow>): Record<string, Pointer> =>
    Object.fromEntries(Object.entries(table).map(([key, row]) => [key, BAND_POINTER[row.band ?? "mid"]]));

  /** Шкальная координата: значение и полоса из среднего, confidence из общей функции. */
  const assignScaleCoordinate = (id: number, evidence: Evidence[], flags: string[] = []): CoordinateScore | null => {
    const score = scoreCoordinate(evidence);
    if (!score) return null;
    const band = bandForDirection(score);
    const [value, code] = labelFor(id, BAND_POINTER[band]);
    assign(id, {
      value,
      code,
      band,
      confidence: score.confidence,
      sources: score.sources,
      flags: [...flags, ...(score.selfReportConflicts.length ? [`self_report_mismatch_${id}`] : [])],
    });
    return score;
  };

  // 1 — источник энергии. Q1 прямой, Q2 обратный.
  assignScaleCoordinate(1, [...scale("Q1"), ...scale("Q2")]);

  // 2 — ритм расхода. Ключевой Q4, шкалы Q3 и обратный Q5.
  const rhythmAnswer = choiceAnswer(answers, "Q4");
  const rhythm = rhythmAnswer ? RHYTHM[rhythmAnswer] : undefined;
  const rhythmScore = scoreCoordinate([
    ...choice("Q4", optionPointers(RHYTHM), true),
    ...scale("Q3"),
    ...scale("Q5"),
  ]);
  if (rhythmScore) {
    const band = rhythm?.band ?? bandForDirection(rhythmScore);
    const [value, code] = rhythm ? [rhythm.value, rhythm.code] : labelFor(2, BAND_POINTER[band]);
    assign(2, {
      value,
      code,
      band,
      confidence: rhythmScore.confidence,
      sources: rhythmScore.sources,
      flags: rhythmScore.selfReportConflicts.length ? ["self_report_mismatch_2"] : [],
    });
  }

  // 3 — тип внимания. Q6 прямой, Q7 обратный, Q8 указывает сторону.
  assignScaleCoordinate(3, [...scale("Q6"), ...scale("Q7"), ...choice("Q8", ATTENTION_POINTER)]);

  // 4 — основание решений. Группа Q9/Q10 смотрит на «логику», ось — на «людей».
  assignScaleCoordinate(4, [
    ...scale("Q9", true),
    ...scale("Q10", true),
    ...choice("Q8", DECISION_POINTER),
    ...choice("Q11", TRADEOFF_POINTER),
  ]);

  // 5 — отношение к структуре. Q12 прямой, Q13 обратный, Q14 прямой.
  {
    const score = scoreCoordinate([...scale("Q12"), ...scale("Q13"), ...scale("Q14")]);
    const plan = scaleAnswer(answers, "Q12") ?? 0;
    const open = scaleAnswer(answers, "Q13") ?? 0;
    const contradiction = plan >= 4 && open >= 4;
    if (score) {
      const [value, code] = labelFor(5, score.direction);
      assign(5, {
        value: contradiction ? "хочет определённости и сам оставляет открытым" : value,
        code: contradiction ? "plan_vs_open" : code,
        band: contradiction ? "mid" : bandForDirection(score),
        confidence: contradiction ? "low" : score.confidence,
        sources: score.sources,
        flags: contradiction ? ["contradiction_plan_vs_open"] : [],
      });
    }
  }

  // 6 — открытость новому. Группа Q15/Q16 смотрит на «новое», ось — на «проверенное».
  assignScaleCoordinate(6, [...scale("Q15", true), ...scale("Q16", true)]);

  // 7 — эмоциональная реактивность. Q17, Q18 прямые, Q19 обратный, Q14 дополняет.
  assignScaleCoordinate(7, [...scale("Q17"), ...scale("Q18"), ...scale("Q19"), ...support("Q14")]);

  // 8 — базовая уязвимость. Ключевой Q34, подтверждение вторым ответом.
  const vulnerabilityAnswer = choiceAnswer(answers, "Q34");
  const vulnerability = vulnerabilityAnswer ? VULNERABILITY[vulnerabilityAnswer] : undefined;
  if (vulnerability && vulnerabilityAnswer) {
    const critique = choiceAnswer(answers, "Q21");
    const stressAnswer = choiceAnswer(answers, "Q20");
    const openEnded = scaleAnswer(answers, "Q13");
    const confirmation = vulnerabilitySupport(vulnerabilityAnswer, {
      critique: critique ? { question: "Q21", answer: critique } : undefined,
      stress: stressAnswer ? { question: "Q20", answer: stressAnswer } : undefined,
      openEnded: openEnded !== undefined ? { question: "Q13", value: openEnded } : undefined,
    });
    const score = scoreCoordinate([
      { kind: "указание", question: "Q34", answer: vulnerabilityAnswer, direction: 1, key: true },
      ...(confirmation ? [confirmation] : []),
    ]);
    if (score) assign(8, { ...vulnerability, band: null, confidence: score.confidence, sources: score.sources });
  }

  // 9 — сценарий под стрессом. Ключевой Q20, стойка Q21, шкала Q22.
  const stressAnswer = choiceAnswer(answers, "Q20");
  const stress = stressAnswer ? STRESS[stressAnswer] : undefined;
  if (stress && stressAnswer) {
    const stance = STRESS_STANCE[stressAnswer];
    const critiqueAnswer = choiceAnswer(answers, "Q21");
    const pressure = scaleAnswer(answers, "Q22");
    // Q22 «делаю больше, чем нужно» читается как активная стойка, низкий ответ — как пассивная.
    const pressureStance: Stance | undefined =
      pressure === undefined ? undefined : pointerOf(pressure) === 1 ? "active" : pointerOf(pressure) === -1 ? "passive" : undefined;
    const score = scoreCoordinate([
      { kind: "указание", question: "Q20", answer: stressAnswer, direction: 1, key: true },
      ...(critiqueAnswer
        ? [
            {
              kind: "указание" as const,
              question: "Q21",
              answer: critiqueAnswer,
              direction: stancePointer(stance, CRITIQUE_STANCE[critiqueAnswer]),
            },
          ]
        : []),
      ...(pressure !== undefined
        ? [
            {
              kind: "указание" as const,
              question: "Q22",
              answer: String(pressure),
              direction: stancePointer(stance, pressureStance),
              selfReport: true,
            },
          ]
        : []),
    ]);
    if (score) {
      assign(9, {
        ...stress,
        confidence: score.confidence,
        sources: score.sources,
        flags: score.selfReportConflicts.length ? ["self_report_mismatch_9"] : [],
      });
    }
  }

  // 10 — ведущий мотив. Только Q35 с ролью «низкий вес»: потолок low без подтверждения текстом.
  const motiveAnswer = choiceAnswer(answers, "Q35");
  if (motiveAnswer && MOTIVE_CODES[motiveAnswer]) {
    const score = scoreCoordinate(choice("Q35", { [motiveAnswer]: 1 }));
    if (score) {
      assign(10, {
        value: optionText("Q35", motiveAnswer),
        code: MOTIVE_CODES[motiveAnswer] ?? motiveAnswer,
        band: null,
        confidence: score.confidence,
        sources: score.sources,
      });
    }
  }

  // 11 — дисциплина и доведение. Ключевой Q24, шкалы Q23 и обратный Q25, дополняет Q26.
  const completionAnswer = choiceAnswer(answers, "Q24");
  const completion = completionAnswer ? COMPLETION[completionAnswer] : undefined;
  {
    const score = scoreCoordinate([
      ...choice("Q24", { A: 1, B: 1, C: 1, D: 1, E: -1 }, true),
      ...scale("Q23", true),
      ...scale("Q25", true),
      ...support("Q26", true),
    ]);
    if (score) {
      const band = completion?.band ?? bandForDirection(score);
      const [value, code] = completion ? [completion.value, completion.code] : labelFor(11, BAND_POINTER[band]);
      assign(11, {
        value,
        code,
        band,
        confidence: score.confidence,
        sources: score.sources,
        flags: score.selfReportConflicts.length ? ["self_report_mismatch_11"] : [],
      });
    }
  }

  // 12 — позиция среди людей. Группа Q27/Q28 смотрит на кооперацию, ось — на соперничество.
  assignScaleCoordinate(12, [...scale("Q27", true), ...scale("Q28", true)]);

  // 13 — способ входа в дело. Ключевой Q29, шкалы Q30 и Q31, дополняет Q26.
  const entryAnswer = choiceAnswer(answers, "Q29");
  const entry = entryAnswer ? ENTRY[entryAnswer] : undefined;
  {
    const score = scoreCoordinate([
      ...choice("Q29", optionPointers(ENTRY), true),
      ...scale("Q30"),
      ...scale("Q31"),
      ...support("Q26", true),
    ]);
    if (score) {
      const band = entry?.band ?? bandForDirection(score);
      const [value, code] = entry ? [entry.value, entry.code] : labelFor(13, BAND_POINTER[band]);
      assign(13, {
        value,
        code,
        band,
        confidence: score.confidence,
        sources: score.sources,
        flags: score.selfReportConflicts.length ? ["self_report_mismatch_13"] : [],
      });
    }
  }

  // 14 — способ решать. Категориальная: категория с наибольшим числом голосов.
  assignDecisionMode(answers, assign);

  // 15 и 16 — только из синтеза открытых ответов.
  assignSynthesis(assign, options);

  return profile;
}

/** Категории координаты 14 и вопросы, которые за них голосуют (content/scoring-rules.md). */
const DECISION_MODES: { code: string; value: string; scales: string[]; choices: Record<string, string[]> }[] = [
  { code: "analysis", value: "анализ и расчёт", scales: [], choices: { Q11: ["A", "C"] } },
  { code: "inner_response", value: "внутренний отклик", scales: ["Q33"], choices: { Q11: ["D"] } },
  { code: "discussion", value: "обсуждение вслух", scales: ["Q2"], choices: {} },
  { code: "pause", value: "пауза и время", scales: ["Q32"], choices: {} },
];

/**
 * Координата 14. Голос за категорию — шкальный ответ в верхней полосе (по общей
 * таблице полос) или названный вариант выбора. Ответ, отданный другой категории,
 * считается спорящим: confidence считает та же общая функция.
 */
function assignDecisionMode(answers: BankAnswers, assign: (id: number, assignment: Assignment) => void): void {
  const votes = DECISION_MODES.map((mode) => {
    const out: { question: string; answer: string }[] = [];
    for (const id of mode.scales) {
      const value = scaleAnswer(answers, id);
      // Вопрос читается как записан: направление из банка относится к его основной координате.
      if (value !== undefined && pointerOf(value) === 1) out.push({ question: id, answer: String(value) });
    }
    for (const [id, keys] of Object.entries(mode.choices)) {
      const answer = choiceAnswer(answers, id);
      if (answer !== undefined && keys.includes(answer)) out.push({ question: id, answer });
    }
    return { mode, out };
  });

  const leader = votes.reduce((best, candidate) => (candidate.out.length > best.out.length ? candidate : best), votes[0]!);
  if (!leader.out.length) return;

  const evidence: Evidence[] = [
    ...leader.out.map<PointerEvidence>(({ question, answer }) => ({ kind: "указание", question, answer, direction: 1 })),
    ...votes
      .filter((candidate) => candidate.mode.code !== leader.mode.code)
      .flatMap((candidate) =>
        candidate.out.map<PointerEvidence>(({ question, answer }) => ({
          kind: "указание",
          question,
          answer,
          direction: -1,
        })),
      ),
  ];

  const score = scoreCoordinate(evidence);
  if (!score) return;
  assign(14, {
    value: leader.mode.value,
    code: leader.mode.code,
    band: null,
    confidence: score.confidence,
    sources: score.sources,
  });
}

// ── Словарь кодов ядра: им ветви лестницы и банка называют положение ──────────

/**
 * Код → формулировка внутрь профиля по каждой координате, которую закрывают
 * лестница и полный банк. Собирается из тех же таблиц, по которым считает
 * скоринг: второго списка значений в коде быть не должно.
 */
export function codeValues(): Record<number, Record<string, string>> {
  const out: Record<number, Record<string, string>> = {};
  const put = (coordinate: number, code: string, value: string): void => {
    out[coordinate] = { ...(out[coordinate] ?? {}), [code]: value };
  };

  for (const [id, axis] of Object.entries(AXIS)) {
    for (const [value, code] of [axis.high, axis.mid, axis.low]) put(Number(id), code, value);
  }
  for (const row of Object.values(RHYTHM)) put(2, row.code, row.value);
  for (const row of Object.values(STRESS)) put(9, row.code, row.value);
  for (const row of Object.values(COMPLETION)) put(11, row.code, row.value);
  for (const row of Object.values(ENTRY)) put(13, row.code, row.value);
  for (const row of Object.values(VULNERABILITY)) put(8, row.code, row.value);
  for (const [key, code] of Object.entries(MOTIVE_CODES)) put(10, code, optionText("Q35", key));
  for (const mode of DECISION_MODES) put(14, mode.code, mode.value);
  return out;
}

/** Стойка кода координаты 9: по тем же таблицам, что и в обеих ветвях входа. */
export function stanceOfStressCode(code: string): "active" | "passive" | "other" | null {
  const key = Object.entries(STRESS).find(([, row]) => row.code === code)?.[0];
  return key ? (STRESS_STANCE[key] ?? null) : null;
}

/** Куда смотрит полоса: та же таблица, по которой считается направление. */
export const pointerOfBand = (band: Band | null): Pointer => (band ? BAND_POINTER[band] : 0);

// ── Несогласие с блоком ───────────────────────────────────────────────────────

/**
 * Что делает несогласие с блоком: content/scoring-rules.md, раздел «Несогласие с
 * блоком: точные правила». Текст блока не трогается ни в одном варианте — меняется
 * только уверенность в координатах, из которых блок собран.
 */
export const DISAGREEMENT_RULES: Record<DisagreementKind, { cap: Confidence; flag: (coordinate: number) => string }> = {
  "это не про меня": { cap: "low", flag: (coordinate) => `disagreed_${coordinate}` },
  частично: { cap: "medium", flag: (coordinate) => `disagreed_${coordinate}` },
  "слишком общо": { cap: "medium", flag: (coordinate) => `too_general_${coordinate}` },
};

/**
 * Координаты, из которых собран блок ступени. Ступени 1, 2 и 4 — координаты
 * вопросов той же ступени; ступень 3 — координаты сработавшего узла, потому что
 * её текст берётся из узла, а не из ответов напрямую.
 */
export function blockCoordinates(profile: Profile, step: 1 | 2 | 3 | 4): number[] {
  const ids =
    step === 3
      ? (profile.nodes[0]?.coordinates ?? [])
      : rawContent.questions.filter((question) => question.step === step).flatMap((question) => question.coordinates);
  return [...new Set(ids)].sort((left, right) => left - right);
}

/**
 * Несогласие как данные. Возвращает новый профиль: затронутые координаты теряют
 * `high` (полоса карты становится предположительной), появляются флаги координат
 * и флаг ступени. Блоки сюда не передаются вовсе — переписать их эта функция
 * не может по устройству.
 */
export function applyDisagreement(profile: Profile, disagreement: Disagreement): Profile {
  const rule = DISAGREEMENT_RULES[disagreement.kind];
  const coordinates = { ...profile.coordinates };

  for (const id of blockCoordinates(profile, disagreement.step)) {
    const state = coordinates[id];
    // Закрытая координата терять нечего: она и так пустая полоса.
    if (!state || !state.sources.length) continue;
    const flag = rule.flag(id);
    coordinates[id] = {
      ...state,
      confidence: capConfidence(state.confidence, rule.cap),
      flags: state.flags.includes(flag) ? state.flags : [...state.flags, flag],
    };
  }

  const flags = [
    ...profile.flags,
    `disagreement_step_${disagreement.step}`,
    ...Object.values(coordinates).flatMap((coordinate) => coordinate.flags),
  ];

  return { ...profile, coordinates, flags: [...new Set(flags)] };
}

/** Несколько несогласий подряд: потолки складываются, вниз и только вниз. */
export const applyDisagreements = (profile: Profile, disagreements: Disagreement[]): Profile =>
  disagreements.reduce(applyDisagreement, profile);

/** Координаты, по которым вход не даёт ничего: это и есть закрытые двери. */
export function unknownCoordinates(profile: Profile): CoordinateState[] {
  return Object.values(profile.coordinates).filter((coordinate) => coordinate.sources.length === 0);
}
