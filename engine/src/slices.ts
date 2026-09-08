/**
 * Скоринг вопросов-доборов платных срезов.
 *
 * Тексты, коды подтипов, пункты порога и уточняющие вопросы живут в
 * `content/slices/*.md` — здесь только условия срабатывания: прозой они
 * записаны свободно и однозначно не читаются. Общие правила доборов описаны
 * в `content/scoring-rules.md`, раздел «Доборы срезов: точные правила».
 *
 * Арифметика та же, что у лестницы и полного банка: уверенность считает
 * `scoreCoordinate` из `engine/src/scoring.ts`, второго набора правил нет.
 */

import { rawContent } from "./generated/content.js";
import { codeValues, pointerOfBand, scoreCoordinate, stanceOfStressCode, type Evidence } from "./scoring.js";
import type {
  Confidence,
  CoordinateState,
  Profile,
  SliceAnswers,
  SliceConfiguration,
  SliceTextFindings,
  SliceThreshold,
} from "./types.js";

// ── Чтение ответов добора ─────────────────────────────────────────────────────

const choice = (answers: SliceAnswers, id: string): string | undefined => {
  const value = answers[id];
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
};

const scale = (answers: SliceAnswers, id: string): number | undefined => {
  const value = answers[id];
  return typeof value === "number" ? value : undefined;
};

/** Тип «число»: одна величина или две, если вопрос спрашивает обе сразу. */
const numbers = (answers: SliceAnswers, id: string): number[] => {
  const value = answers[id];
  if (Array.isArray(value)) return value;
  return typeof value === "number" ? [value] : [];
};

const words = (answers: SliceAnswers, id: string): number => {
  const value = answers[id];
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;
};

const answered = (answers: SliceAnswers, id: string): boolean =>
  choice(answers, id) !== undefined || scale(answers, id) !== undefined || numbers(answers, id).length > 0;

const oneOf = (value: string | undefined, ...keys: string[]): boolean => value !== undefined && keys.includes(value);

const atLeast = (value: number | undefined, threshold: number): boolean => value !== undefined && value >= threshold;

const atMost = (value: number | undefined, threshold: number): boolean => value !== undefined && value <= threshold;

// ── Единый словарь подтипов координат ─────────────────────────────────────────

/**
 * Какой грубый код уточняет точный. Лестница знает про координату 13 только
 * «двигается на внешний запрос и срок» — ключевого вопроса у неё нет; банк
 * знает вариант Q29; добор называет конкретный пусковой механизм. Без этих
 * связей три источника называют одно положение разными словами.
 */
const REFINES: Record<string, string> = {
  // Координата 13: способ входа в дело.
  invited: "needs_external_pull",
  on_request: "needs_external_pull",
  social_commitment: "needs_external_pull",
  sunk_cost_trigger: "needs_external_pull",
  responds_to_request: "on_request",
  internal_shame: "self_starting",
  // Координата 11: где рвётся «решил — сделал».
  pre_show_polish: "at_80",
  pre_show_drop: "at_80",
  safe_witness_only: "at_80",
  post_feedback_stall: "at_80",
  // Координата 7: сила и длительность реакции.
  fast_short: "releases",
  fast_long: "holds_long",
  slow_long: "holds_long",
  // Координата 14: банк и срез называли одно и то же разными словами.
  analytic: "analysis",
  dialogic: "discussion",
  incubation: "pause",
};

export interface SubtypeEntry {
  /** Координата кода; null — конфигурация среза, отдельной координаты у неё нет. */
  coordinate: number | null;
  code: string;
  /** Формулировка внутрь профиля. */
  value: string;
  /** «ядро» — лестница и полный банк; иначе идентификатор среза. */
  source: string;
  /** Какой грубый код уточняет. */
  refines: string | null;
}

let registry: SubtypeEntry[] | null = null;

/** Единый словарь: коды ядра плюс подтипы всех срезов, у каждого — координата. */
export function subtypeRegistry(): SubtypeEntry[] {
  if (registry) return registry;

  const out: SubtypeEntry[] = [];
  for (const [coordinate, codes] of Object.entries(codeValues())) {
    for (const [code, value] of Object.entries(codes)) {
      out.push({ coordinate: Number(coordinate), code, value, source: "ядро", refines: REFINES[code] ?? null });
    }
  }
  for (const rules of SLICE_RULES) {
    for (const subtype of sliceContent(rules.slice).subtypes) {
      if (!(subtype.code in rules.owns)) throw new Error(`${rules.slice}: подтип ${subtype.code} не привязан в коде`);
      out.push({
        coordinate: rules.owns[subtype.code] ?? null,
        code: subtype.code,
        value: subtype.text,
        source: rules.slice,
        refines: REFINES[subtype.code] ?? null,
      });
    }
  }

  registry = out;
  return out;
}

const chainOf = (code: string): string[] => {
  const out = [code];
  let current: string | undefined = REFINES[code];
  while (current) {
    out.push(current);
    current = REFINES[current];
  }
  return out;
};

/** Два кода называют одно положение — один точнее другого или это один код. */
export function sameSubtype(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return chainOf(left).includes(right) || chainOf(right).includes(left);
}

const valueForCode = (coordinate: number | null, code: string): string => {
  const entry = subtypeRegistry().find(
    (candidate) => candidate.code === code && candidate.coordinate === coordinate,
  );
  if (!entry) throw new Error(`Для кода ${code} нет формулировки ни в контенте, ни в словаре ядра`);
  return entry.value;
};

// ── Правила срезов ────────────────────────────────────────────────────────────

/** Подтип координаты, определённый ответами добора. */
interface Determination {
  coordinate: number;
  code: string;
  /** Вопросы, по которым определён; первый — решающий поведенческий. */
  questions: string[];
}

/** Ответ добора, который соглашается с уже известным кодом координаты или спорит. */
interface Confirmation {
  coordinate: number;
  question: string;
  /** null — ответ ничего не сообщает. */
  agrees: boolean | null;
}

interface SliceRules {
  slice: string;
  /** Код подтипа → координата (null — конфигурация). Состав сверяется с файлом среза. */
  owns: Record<string, number | null>;
  /** Подтипы координат: первая подходящая строка таблицы выигрывает. */
  refine?: (answers: SliceAnswers, profile: Profile) => Determination[];
  /** Конфигурации: находка среза, которая не принадлежит одной координате. */
  configure?: (answers: SliceAnswers) => { code: string; questions: string[] }[];
  /** Ответы, которые соглашаются с уже известным кодом координаты или спорят. */
  confirm?: (answers: SliceAnswers, profile: Profile) => Confirmation[];
  flags?: (answers: SliceAnswers, profile: Profile) => { code: string; coordinate: number | null }[];
  /** Потолок уверенности: выше поднимает только подтверждение открытым текстом. */
  caps?: (answers: SliceAnswers) => { coordinate: number; cap: Confidence }[];
  /** Отчёт не пишем и уточняющих не задаём: нужен кризисный контур (E2-07). */
  crisis?: (answers: SliceAnswers) => string | null;
  /** Пункты порога: порядок и число — как в чек-листе файла среза. */
  threshold: ((context: ThresholdContext) => boolean)[];
  /** Условия строк «Следующие двери», кроме последней «иначе». */
  doors: ((answers: SliceAnswers, profile: Profile) => boolean)[];
}

interface ThresholdContext {
  answers: SliceAnswers;
  /** Профиль после применения добора. */
  profile: Profile;
  /** Профиль до добора: нужен пунктам вида «L8 давал high». */
  before: Profile;
  findings: SliceTextFindings;
  slice: string;
}

const state = (profile: Profile, coordinate: number): CoordinateState | undefined => profile.coordinates[coordinate];

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Координата закрыта не хуже указанной уверенности. */
const known = (profile: Profile, coordinate: number, min: Confidence = "medium"): boolean => {
  const current = state(profile, coordinate);
  if (!current || !current.sources.length) return false;
  return RANK[current.confidence] >= RANK[min];
};

/** Код координаты — один из подтипов этого среза, а не грубый код ядра. */
const refinedBySlice = (profile: Profile, coordinate: number, slice: string): boolean => {
  const code = state(profile, coordinate)?.code ?? null;
  if (!code) return false;
  return Object.entries(rulesFor(slice).owns).some(([own, id]) => own === code && id === coordinate);
};

/** Сколько координат профиля закрыто не хуже medium. */
const mediumOrBetter = (profile: Profile): number =>
  Object.values(profile.coordinates).filter((coordinate) => coordinate.sources.length && coordinate.confidence !== "low")
    .length;

/** Первая подходящая строка таблицы подтипов. */
const firstMatch = (
  coordinate: number,
  rows: { code: string; when: boolean; questions: string[] }[],
): Determination[] => {
  const row = rows.find((candidate) => candidate.when);
  return row ? [{ coordinate, code: row.code, questions: row.questions }] : [];
};

const allAnswered = (slice: string, answers: SliceAnswers, allowSkipped: number): boolean =>
  sliceContent(slice).questions.filter((question) => !answered(answers, question.id)).length <= allowSkipped;

const SLICE_RULES: SliceRules[] = [
  {
    slice: "slice_node_finish",
    owns: {
      pre_show_polish: 11,
      pre_show_drop: 11,
      safe_witness_only: 11,
      post_feedback_stall: 11,
      never_finished: 11,
    },
    refine: (a) => {
      const s1 = choice(a, "S1");
      const s2 = choice(a, "S2");
      return firstMatch(11, [
        { code: "pre_show_polish", when: s1 === "A" && oneOf(s2, "A", "B"), questions: ["S1", "S2"] },
        { code: "pre_show_drop", when: s1 === "A" && oneOf(s2, "C", "E"), questions: ["S1", "S2"] },
        { code: "safe_witness_only", when: s1 === "B", questions: ["S1"] },
        { code: "post_feedback_stall", when: s1 === "C", questions: ["S1"] },
        { code: "never_finished", when: s1 === "D", questions: ["S1"] },
      ]);
    },
    // S7 уточняет вариант координаты 8: адрес страха либо подтверждает выбранную
    // уязвимость, либо смотрит в сторону «оказаться неправым».
    confirm: (a, profile) => {
      const s7 = choice(a, "S7");
      if (s7 === undefined) return [];
      const implied =
        s7 === "A" ? "not_taken_seriously" : s7 === "C" ? "insignificance" : s7 === "B" ? "being_wrong" : null;
      const code = state(profile, 8)?.code ?? null;
      return [{ coordinate: 8, question: "S7", agrees: implied === null ? null : sameSubtype(code, implied) }];
    },
    flags: (a) =>
      atLeast(scale(a, "S4"), 4) && oneOf(choice(a, "S2"), "A", "B") && oneOf(choice(a, "S3"), "C", "D")
        ? [{ code: "rationalized_polish", coordinate: 11 }]
        : [],
    // S7=D — адреса страха нет, выше medium координата 8 не поднимается.
    caps: (a) => (choice(a, "S7") === "D" ? [{ coordinate: 8, cap: "medium" }] : []),
    threshold: [
      ({ profile, answers, slice }) =>
        known(profile, 11, "high") &&
        refinedBySlice(profile, 11, slice) &&
        answered(answers, "S1") &&
        answered(answers, "S2"),
      ({ profile, before, answers }) =>
        known(profile, 8) && (choice(answers, "S7") !== "D" || known(before, 8, "high")),
      ({ profile }) => known(profile, 9),
      ({ answers }) => words(answers, "S8") > 15 || (answered(answers, "S9") && choice(answers, "S9") !== "D"),
    ],
    doors: [
      (a) => choice(a, "S10") === "C",
      (a, profile) => oneOf(choice(a, "S6"), "B", "D") && pointerOfBand(state(profile, 7)?.band ?? null) === 1,
      (a, profile) => choice(a, "S9") === "A" && sameSubtype(state(profile, 13)?.code ?? null, "on_request"),
      (_a, profile) => mediumOrBetter(profile) / 16 >= 0.6,
    ],
  },
  {
    slice: "slice_motivation",
    owns: {
      responds_to_request: 13,
      social_commitment: 13,
      sunk_cost_trigger: 13,
      internal_shame: 13,
      fear_gated: 13,
    },
    refine: (a) => {
      const s3 = choice(a, "S3");
      const s7 = choice(a, "S7");
      // S7 отличает мотив связи от мотива репутации и от мотива цены
      // (колонка «Зачем в отчёте» у S7); вариант D мотива не называет.
      const motive = s7 === "A" ? "closeness" : s7 === "B" ? "recognition" : s7 === "C" ? "safety" : null;
      return [
        ...firstMatch(13, [
          { code: "responds_to_request", when: oneOf(s3, "A", "F"), questions: ["S3"] },
          { code: "social_commitment", when: s3 === "B", questions: ["S3"] },
          { code: "sunk_cost_trigger", when: s3 === "C", questions: ["S3"] },
          { code: "internal_shame", when: s3 === "D", questions: ["S3"] },
          { code: "fear_gated", when: s3 === "E", questions: ["S3"] },
        ]),
        ...(motive ? [{ coordinate: 10, code: motive, questions: ["S7"] }] : []),
      ];
    },
    flags: (a) =>
      atLeast(scale(a, "S2"), 4) && oneOf(choice(a, "S1"), "A", "B")
        ? [{ code: "self_report_mismatch_11", coordinate: 11 }]
        : [],
    // high по мотиву — только при согласии S7 и открытого S9, а открытое считает LLM.
    caps: () => [{ coordinate: 10, cap: "medium" }],
    threshold: [
      ({ profile }) => known(profile, 11),
      ({ profile, answers, slice }) => refinedBySlice(profile, 13, slice) && answered(answers, "S3"),
      ({ profile, answers }) => known(profile, 10) && answered(answers, "S7") && words(answers, "S9") > 0,
      ({ answers }) => words(answers, "S8") > 15 || atLeast(numbers(answers, "S5")[1], 1),
    ],
    // Отдельный случай из файла: начинал много, до чужих глаз не дошло ни разу.
    doors: [
      (a) => {
        const [started, shown] = numbers(a, "S5");
        return atLeast(started, 4) && shown === 0;
      },
    ],
  },
  {
    slice: "slice_stress",
    owns: { no_outlet: 12, learned_self_reliance: 12, has_outlet: 12, cant_refuse: 12 },
    refine: (a) => {
      const s2 = choice(a, "S2");
      const s3 = choice(a, "S3");
      const refusal = atLeast(numbers(a, "S5")[0], 4) && atLeast(scale(a, "S4"), 4);
      return firstMatch(12, [
        { code: "no_outlet", when: oneOf(s2, "A", "B", "E") && s3 === "D", questions: ["S2", "S3"] },
        { code: "learned_self_reliance", when: oneOf(s2, "A", "B") && s3 === "C", questions: ["S2", "S3"] },
        { code: "has_outlet", when: oneOf(s2, "C", "D"), questions: ["S2"] },
        { code: "cant_refuse", when: refusal, questions: ["S5", "S4"] },
      ]);
    },
    // Координата 9 поднимается до high, когда S1 и S2 стоят в той же стойке, что
    // и её код; координата 7 — когда S7 согласен с полосой L6/Q18.
    confirm: (a, profile) => {
      const stance = stanceOfStressCode(state(profile, 9)?.code ?? "");
      const agreesWith = (own: "active" | "passive" | null): boolean | null =>
        !stance || stance === "other" || own === null ? null : stance === own;
      const out: Confirmation[] = [];

      const s1 = choice(a, "S1");
      if (s1 !== undefined) {
        out.push({
          coordinate: 9,
          question: "S1",
          agrees: agreesWith(oneOf(s1, "A", "B", "C") ? "active" : oneOf(s1, "D", "E") ? "passive" : null),
        });
      }
      const s2 = choice(a, "S2");
      if (s2 !== undefined) {
        out.push({
          coordinate: 9,
          question: "S2",
          agrees: agreesWith(oneOf(s2, "A", "B") ? "active" : s2 === "E" ? "passive" : null),
        });
      }
      const s7 = choice(a, "S7");
      if (s7 !== undefined) {
        const holds = oneOf(s7, "C", "D") ? 1 : oneOf(s7, "A", "B") ? -1 : 0;
        const band = pointerOfBand(state(profile, 7)?.band ?? null);
        out.push({ coordinate: 7, question: "S7", agrees: holds === 0 || band === 0 ? null : holds === band });
      }
      return out;
    },
    flags: (a) => {
      const out: { code: string; coordinate: number | null }[] = [];
      if (atLeast(numbers(a, "S5")[0], 4) && atLeast(scale(a, "S4"), 4))
        out.push({ code: "self_report_mismatch_12", coordinate: 12 });
      if (oneOf(choice(a, "S6"), "E", "F")) out.push({ code: "no_early_signal", coordinate: 7 });
      return out;
    },
    // Структурная часть кризисной проверки; лексическую даёт E2-07.
    crisis: (a) => {
      if (choice(a, "S1") === "F") return "S1=F: человек до сих пор в невыносимом состоянии";
      if (oneOf(choice(a, "S1"), "A", "E") && words(a, "S9") === 0)
        return "S9 пустой при S1=A/E: выход из перегруза телесный, канала наружу нет";
      return null;
    },
    threshold: [
      ({ profile }) => known(profile, 9, "high"),
      ({ profile }) => known(profile, 7),
      ({ profile, answers, slice }) =>
        refinedBySlice(profile, 12, slice) &&
        answered(answers, "S2") &&
        answered(answers, "S3") &&
        answered(answers, "S5"),
      ({ answers }) => words(answers, "S8") > 10 || words(answers, "S9") > 10,
    ],
    doors: [(a) => words(a, "S9") === 0],
  },
  {
    slice: "slice_reactivity",
    owns: {
      truth_hit: 8,
      injustice_hit: 8,
      contempt_hit: 8,
      exposure_hit: 8,
      attachment_hit: 8,
      fast_short: 7,
      fast_long: 7,
      slow_long: 7,
      unrecognized: 7,
    },
    refine: (a) => {
      const s2 = choice(a, "S2");
      const s3 = choice(a, "S3");
      const s8 = choice(a, "S8");
      return [
        ...firstMatch(8, [
          { code: "truth_hit", when: s2 === "A", questions: ["S2"] },
          { code: "injustice_hit", when: s2 === "B", questions: ["S2"] },
          { code: "contempt_hit", when: s2 === "C", questions: ["S2"] },
          { code: "exposure_hit", when: s2 === "D", questions: ["S2"] },
          { code: "attachment_hit", when: s2 === "E", questions: ["S2"] },
        ]),
        ...firstMatch(7, [
          { code: "fast_short", when: oneOf(s8, "A", "B") && oneOf(s3, "A", "B"), questions: ["S8", "S3"] },
          { code: "fast_long", when: oneOf(s8, "A", "B") && oneOf(s3, "C", "D"), questions: ["S8", "S3"] },
          { code: "slow_long", when: s8 === "C" && oneOf(s3, "C", "D"), questions: ["S8", "S3"] },
          { code: "unrecognized", when: s8 === "D", questions: ["S8"] },
        ]),
      ];
    },
    flags: (a) =>
      atLeast(scale(a, "S6"), 4) && oneOf(choice(a, "S3"), "C", "D")
        ? [{ code: "self_report_mismatch_7", coordinate: 7 }]
        : [],
    // high по координате 8 — только когда открытый S9 совпал с S2, а это считает LLM.
    caps: () => [{ coordinate: 8, cap: "medium" }],
    threshold: [
      ({ profile, answers, slice }) =>
        known(profile, 7, "high") &&
        refinedBySlice(profile, 7, slice) &&
        answered(answers, "S3") &&
        answered(answers, "S8"),
      ({ profile, answers, slice }) => known(profile, 8) && refinedBySlice(profile, 8, slice) && answered(answers, "S2"),
      ({ answers }) => words(answers, "S1") > 20,
      ({ answers }) => words(answers, "S9") > 0,
    ],
    doors: [(a) => choice(a, "S2") === "E", (a) => oneOf(choice(a, "S7"), "A", "B")],
  },
  {
    slice: "slice_decisions",
    owns: { analytic: 14, dialogic: 14, incubation: 14, pressure_gated: 14 },
    refine: (a) => {
      const s1 = choice(a, "S1");
      const s2 = choice(a, "S2");
      const s3 = choice(a, "S3");
      // S1 — поведение с отложенным решением против самооценки L9/L10: закрыл
      // его сам или дал закрыться обстоятельствам и времени.
      const structure = s1 === "A" ? "structure" : oneOf(s1, "B", "C", "D") ? "openness" : null;
      return [
        ...firstMatch(14, [
          { code: "analytic", when: oneOf(s2, "A", "D") && s3 === "C", questions: ["S3", "S2"] },
          { code: "dialogic", when: s2 === "B" && s3 === "E", questions: ["S3", "S2"] },
          { code: "incubation", when: oneOf(s2, "C", "E") && s3 === "D", questions: ["S3", "S2"] },
          { code: "pressure_gated", when: oneOf(s3, "A", "B"), questions: ["S3"] },
        ]),
        ...(structure ? [{ coordinate: 5, code: structure, questions: ["S1"] }] : []),
      ];
    },
    flags: (a, profile) => {
      const out: { code: string; coordinate: number | null }[] = [];
      // «S5=C при L9 ≥ 4» читается через профиль: он хочет определённости —
      // полосой координаты 5 или прямым противоречием плана и открытого финала —
      // и сам её отменяет.
      const wantsCertainty =
        pointerOfBand(state(profile, 5)?.band ?? null) === 1 || profile.flags.includes("contradiction_plan_vs_open");
      if (choice(a, "S5") === "C" && wantsCertainty) out.push({ code: "commitment_reversal", coordinate: 5 });
      if (atLeast(scale(a, "S4"), 4) && choice(a, "S1") === "A")
        out.push({ code: "open_after_close", coordinate: 14 });
      return out;
    },
    threshold: [
      ({ profile, answers, slice }) =>
        refinedBySlice(profile, 14, slice) && answered(answers, "S2") && answered(answers, "S3"),
      ({ profile }) => known(profile, 5),
      ({ answers }) => words(answers, "S7") > 15,
      ({ answers }) => words(answers, "S9") > 0 || words(answers, "S10") > 0,
    ],
    doors: [(_a, profile) => profile.flags.includes("self_report_mismatch_12"), (a) => words(a, "S10") > 0],
  },
  {
    slice: "slice_work",
    owns: {
      starter_no_finisher: null,
      executor_no_direction: null,
      architect_no_finisher: null,
      systemizer: null,
      single_mode: null,
    },
    // S1 — способ входа по факту: те же четыре варианта, что у ключевого Q29 банка.
    refine: (a) => {
      const s1 = choice(a, "S1");
      const entry =
        s1 === "A"
          ? "self_starting"
          : s1 === "B"
            ? "invited"
            : s1 === "C"
              ? "on_request"
              : s1 === "D"
                ? "many_tries"
                : null;
      return entry ? [{ coordinate: 13, code: entry, questions: ["S1"] }] : [];
    },
    configure: (a) => {
      const s4 = choice(a, "S4");
      const s5 = choice(a, "S5");
      if (s4 === undefined || s5 === undefined) return [];
      const code =
        s4 === "A" && s5 === "C"
          ? "starter_no_finisher"
          : s4 === "C" && s5 === "A"
            ? "executor_no_direction"
            : s4 === "B" && s5 === "C"
              ? "architect_no_finisher"
              : s4 === "D" && s5 === "C"
                ? "systemizer"
                : s4 === s5
                  ? "single_mode"
                  : null;
      return code ? [{ code, questions: ["S4", "S5"] }] : [];
    },
    // S18 подтверждает способ входа: «не начинал своё» согласен с внешним
    // входом, остальные варианты — с самостоятельным старом.
    confirm: (a, profile) => {
      const s18 = choice(a, "S18");
      if (s18 === undefined) return [];
      const external = sameSubtype(state(profile, 13)?.code ?? null, "needs_external_pull");
      return [{ coordinate: 13, question: "S18", agrees: s18 === "A" ? external : !external }];
    },
    flags: (a) =>
      atMost(scale(a, "S13"), 2) && words(a, "S14") > 0 ? [{ code: "self_report_mismatch_10", coordinate: 10 }] : [],
    threshold: [
      ({ answers, slice }) => allAnswered(slice, answers, 2),
      ({ answers }) => answered(answers, "S4") && answered(answers, "S5"),
      ({ profile }) => known(profile, 13),
      ({ profile }) => known(profile, 11),
      ({ answers }) =>
        [
          words(answers, "S9") > 0,
          words(answers, "S14") > 0,
          words(answers, "S16") > 0,
          words(answers, "S20") > 0,
          numbers(answers, "S10").length > 0,
        ].filter(Boolean).length >= 3,
    ],
    doors: [
      (a) => atLeast(numbers(a, "S10")[0], 50) && oneOf(choice(a, "S18"), "B", "C"),
      (_a, profile) => profile.flags.includes("fork_ahead"),
    ],
  },
  {
    slice: "slice_relationships",
    owns: {
      pursue_then_flee: null,
      mutual_withdrawal: null,
      direct_contact: null,
      earned_closeness: null,
      indirect_protest: null,
    },
    // S7 — распределение работы по восстановлению связи: уступает он или другой.
    refine: (a) => {
      const s7 = choice(a, "S7");
      const position = s7 === "A" ? "cooperation" : s7 === "B" ? "competition" : oneOf(s7, "C", "D") ? "mixed" : null;
      return position ? [{ coordinate: 12, code: position, questions: ["S7"] }] : [];
    },
    configure: (a) => {
      const s4 = choice(a, "S4");
      const s5 = choice(a, "S5");
      if (s4 === undefined) return [];
      const code =
        s4 === "D" && s5 === "B"
          ? "pursue_then_flee"
          : s4 === "C" && s5 === "B"
            ? "mutual_withdrawal"
            : s4 === "A" && s5 === "A"
              ? "direct_contact"
              : s4 === "D" && s5 === "C"
                ? "earned_closeness"
                : s4 === "E"
                  ? "indirect_protest"
                  : null;
      return code ? [{ code, questions: s4 === "E" ? ["S4"] : ["S4", "S5"] }] : [];
    },
    flags: (a) => {
      const out: { code: string; coordinate: number | null }[] = [];
      const [canCallHim, canHeCall] = numbers(a, "S18");
      if (canCallHim !== undefined && canHeCall !== undefined && canCallHim - canHeCall >= 2)
        out.push({ code: "one_way_support", coordinate: 12 });
      if (atLeast(scale(a, "S8"), 4) && oneOf(choice(a, "S12"), "B", "C", "D"))
        out.push({ code: "self_report_mismatch_12", coordinate: 12 });
      return out;
    },
    threshold: [
      ({ answers, slice }) => allAnswered(slice, answers, 2),
      ({ answers }) => answered(answers, "S4") && answered(answers, "S5"),
      ({ profile }) => known(profile, 12),
      ({ profile }) => known(profile, 15) && Boolean(state(profile, 15)?.code),
      ({ answers }) => words(answers, "S11") > 20,
    ],
    doors: [],
  },
  {
    slice: "slice_decision_moment",
    // Профиль здесь не пересчитывается: срез применяет уже собранный, поэтому
    // типы зависания — находки среза, а не подтипы координат.
    owns: { unknowable_gap: null, permission_seeking: null, procedure_loop: null, no_forcing_function: null },
    // Три типа из четырёх опираются на открытые S3 и S5 — их движок не читает,
    // они приходят разбором открытых ответов. Своё правило только у четвёртого.
    configure: (a) =>
      choice(a, "S2") === "D" && choice(a, "S6") === "D"
        ? [{ code: "no_forcing_function", questions: ["S2", "S6"] }]
        : [],
    threshold: [
      ({ answers, slice }) => words(answers, "entry") >= entryMinWords(slice),
      ({ profile }) => mediumOrBetter(profile) >= 8,
      ({ profile }) => Boolean(state(profile, 14)?.code),
      ({ answers }) => words(answers, "S1") > 0 && words(answers, "S5") > 0 && words(answers, "S7") > 0,
      ({ findings }) => findings.safeTopic === true,
    ],
    doors: [],
  },
];

const rulesFor = (slice: string): SliceRules => {
  const rules = SLICE_RULES.find((candidate) => candidate.slice === slice);
  if (!rules) throw new Error(`Для среза ${slice} нет правил скоринга доборов`);
  return rules;
};

const sliceContent = (slice: string) => {
  const found = rawContent.slices.find((candidate) => candidate.id === slice);
  if (!found || !found.file) throw new Error(`В content/slices нет файла среза ${slice}`);
  return found;
};

/** Минимум слов обязательного входа среза — число записано в файле среза. */
const entryMinWords = (slice: string): number => {
  const minimum = sliceContent(slice).threshold?.entryMinWords;
  if (!minimum) throw new Error(`${slice}: в файле среза не найден минимум слов обязательного входа`);
  return minimum;
};

/** Срезы, у которых есть правила скоринга доборов. */
export const SCORED_SLICES: string[] = SLICE_RULES.map((rules) => rules.slice);

/** Подтипы и конфигурации, которые срез умеет ставить: сверяется с его файлом. */
export const sliceOwnedCodes = (slice: string): Record<string, number | null> => rulesFor(slice).owns;

// ── Применение добора к профилю ───────────────────────────────────────────────

/**
 * Уточняет профиль ответами добора: подтипы координат, конфигурации и флаги.
 * Числа считает `scoreCoordinate` — та же функция, что у лестницы и банка.
 * Открытые ответы движок не интерпретирует: их разбор приходит в `findings`.
 */
export function applySlice(
  slice: string,
  profile: Profile,
  answers: SliceAnswers,
  findings: SliceTextFindings = {},
): Profile {
  const rules = rulesFor(slice);
  const content = sliceContent(slice);
  const codes = new Set(content.subtypes.map((subtype) => subtype.code));

  for (const code of findings.codes ?? []) {
    if (!codes.has(code)) throw new Error(`${slice}: подтипа ${code} нет в файле среза`);
  }

  const fromText = (findings.codes ?? []).map((code) => ({
    coordinate: rules.owns[code] ?? null,
    code,
    questions: ["разбор открытых"],
  }));

  const determinations: Determination[] = [
    ...(rules.refine?.(answers, profile) ?? []),
    ...fromText.filter((item): item is Determination => item.coordinate !== null),
  ];
  const confirmations = rules.confirm?.(answers, profile) ?? [];
  const flags = [
    ...(rules.flags?.(answers, profile) ?? []),
    ...(findings.flags ?? []).map((code) => ({ code, coordinate: null })),
  ];
  const caps = rules.caps?.(answers) ?? [];

  const coordinates: Record<number, CoordinateState> = { ...profile.coordinates };
  const touched = new Set<number>([
    ...determinations.map((determination) => determination.coordinate),
    ...confirmations.map((confirmation) => confirmation.coordinate),
  ]);

  for (const coordinate of touched) {
    const before = coordinates[coordinate];
    if (!before) throw new Error(`Неизвестная координата ${coordinate}`);
    const determination = determinations.find((candidate) => candidate.coordinate === coordinate);
    const own = confirmations.filter((candidate) => candidate.coordinate === coordinate);
    const code = determination?.code ?? before.code;
    if (!code) continue;

    const evidence: Evidence[] = [];
    const sources: string[] = [];

    determination?.questions.forEach((question, index) => {
      sources.push(`${slice}:${question}`);
      evidence.push({
        kind: "указание",
        question: `${slice}:${question}`,
        answer: code,
        direction: 1,
        key: index === 0,
      });
    });
    for (const confirmation of own) {
      if (confirmation.agrees === null) continue;
      sources.push(`${slice}:${confirmation.question}`);
      evidence.push({
        kind: "указание",
        question: `${slice}:${confirmation.question}`,
        answer: confirmation.agrees ? "согласен" : "спорит",
        direction: confirmation.agrees ? 1 : -1,
      });
    }
    /*
     * Прежнее чтение координаты. Если словарь подтипов говорит, что оно называет
     * то же положение, — это согласный ответ. Если связь неизвестна, ответ молчит:
     * спорящим его объявлять нельзя, иначе любое уточнение выглядело бы как
     * расхождение. Настоящие расхождения у каждого среза записаны своим условием.
     * Когда добор код не меняет, прежний код и есть ключевой ответ координаты.
     */
    if (before.sources.length) {
      evidence.push({
        kind: "указание",
        question: before.sources.join(","),
        answer: before.code ?? "",
        direction: sameSubtype(before.code, code) ? 1 : 0,
        key: determination === undefined,
      });
    }

    const cap = caps.find((candidate) => candidate.coordinate === coordinate)?.cap;
    const score = scoreCoordinate(evidence, cap ? { cap } : {});
    if (!score) continue;

    const ownFlags = flags.filter((flag) => flag.coordinate === coordinate).map((flag) => flag.code);

    coordinates[coordinate] = {
      ...before,
      value: determination ? valueForCode(coordinate, code) : before.value,
      code,
      confidence: score.confidence,
      sources: [...new Set([...before.sources, ...sources])],
      flags: [...new Set([...before.flags, ...ownFlags])],
    };
  }

  // Флаги координат, которых добор не уточнял, тоже попадают в профиль.
  for (const flag of flags) {
    if (flag.coordinate === null) continue;
    const target = coordinates[flag.coordinate];
    if (!target || target.flags.includes(flag.code)) continue;
    coordinates[flag.coordinate] = { ...target, flags: [...target.flags, flag.code] };
  }

  const configured = [
    ...(rules.configure?.(answers) ?? []),
    ...fromText.filter((item) => item.coordinate === null).map((item) => ({ code: item.code, questions: item.questions })),
  ];
  const configurations: SliceConfiguration[] = configured.map((configuration) => ({
    slice,
    code: configuration.code,
    value: valueForCode(null, configuration.code),
    sources: configuration.questions.map((question) => `${slice}:${question}`),
  }));

  const allFlags = [
    ...profile.flags,
    ...flags.map((flag) => flag.code),
    ...Object.values(coordinates).flatMap((coordinate) => coordinate.flags),
  ];

  return {
    ...profile,
    coordinates,
    flags: [...new Set(allFlags)],
    configurations: [...profile.configurations, ...configurations],
  };
}

// ── Порог генерации ───────────────────────────────────────────────────────────

/**
 * Порог генерации среза: пункты и уточняющие вопросы — из файла среза, условия
 * срабатывания — здесь. Порог не взят → отчёт не пишем, отдаём уточняющие
 * (Правило 8 из docs/04-alignment-rules.md). Пороги заданы строго: лучше не
 * выдать отчёт, чем выдать пустой; калибровка — E12-05.
 */
export function checkThreshold(
  slice: string,
  profile: Profile,
  answers: SliceAnswers,
  findings: SliceTextFindings = {},
  before: Profile = profile,
): SliceThreshold {
  const rules = rulesFor(slice);
  const checks = sliceContent(slice).threshold?.checks ?? [];
  const followUps = sliceContent(slice).threshold?.followUps ?? [];

  if (checks.length !== rules.threshold.length)
    throw new Error(`${slice}: пунктов порога в контенте ${checks.length}, условий в коде ${rules.threshold.length}`);

  const blocked = rules.crisis?.(answers) ?? null;
  if (blocked) return { passed: false, missing: checks, followUps: [], blocked };

  const context: ThresholdContext = { answers, profile, before, findings, slice };
  const missing = checks.filter((_check, index) => !rules.threshold[index]!(context));

  return { passed: missing.length === 0, missing, followUps: missing.length ? followUps : [], blocked: null };
}

// ── Следующая дверь ───────────────────────────────────────────────────────────

/**
 * Следующий срез после закрытия этого: первая подходящая строка таблицы
 * «Следующие двери» его файла. Последняя строка — «иначе», поэтому
 * предложение всегда одно.
 */
export function nextSliceAfter(
  slice: string,
  profile: Profile,
  answers: SliceAnswers,
  purchased: string[] = [],
): string {
  const rules = rulesFor(slice);
  const rows = sliceContent(slice).nextDoors;
  const closed = new Set([slice, ...purchased]);

  if (rows.length - 1 !== rules.doors.length)
    throw new Error(`${slice}: условий «Следующие двери» в контенте ${rows.length - 1}, в коде ${rules.doors.length}`);

  for (const [index, row] of rows.slice(0, -1).entries()) {
    if (closed.has(row.slice)) continue;
    if (rules.doors[index]!(answers, profile)) return row.slice;
  }
  return rows[rows.length - 1]!.slice;
}
