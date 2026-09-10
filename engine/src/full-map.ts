/**
 * Добор полной карты (`content/slices/full-map.md`).
 *
 * Файл среза задаёт только порядок: вопросы приходят из полного банка по
 * идентификатору. Здесь — доступ к этому порядку и вычитание того, на что ответ уже
 * есть: вопрос, заданный на лестнице или в прошлой порции, второй раз не задаётся
 * (Закон 2). Арифметика профиля живёт в `scoring.ts` и сюда не переезжает.
 */

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";
import {
  bankAnswersFromLadder,
  bankScales,
  buildProfile,
  buildProfileFromBank,
  capConfidence,
  pointerOfBand,
  scoreCoordinate,
  unknownCoordinates,
  type ProfileOptions,
} from "./scoring.js";
import { applySlice, mediumOrBetter } from "./slices.js";
import type {
  RawFullMap,
  RawFullMapAxis,
  RawFullMapInterlude,
  RawFullMapPortion,
  RawFullMapQuestion,
} from "./content-extra-types.js";
import type {
  BankAnswers,
  Confidence,
  InterludeBlock,
  LadderAnswers,
  Profile,
  SliceAnswers,
  SliceConfiguration,
  SliceTextFindings,
  SliceThreshold,
} from "./types.js";

export type {
  RawFullMap,
  RawFullMapAxis,
  RawFullMapInterlude,
  RawFullMapPortion,
  RawFullMapQuestion,
} from "./content-extra-types.js";

const map = (): RawFullMap => rawExtraContent.fullMap;

export const fullMap = (): RawFullMap => map();

export const fullMapPortions = (): RawFullMapPortion[] => map().portions;

/** Все вопросы добора в порядке порций. */
export const fullMapQuestions = (): RawFullMapQuestion[] =>
  map().portions.flatMap((portion) => portion.questions);

export function fullMapPortion(number: number): RawFullMapPortion {
  const portion = map().portions.find((candidate) => candidate.number === number);
  if (!portion) throw new Error(`content/slices/full-map.md: нет порции ${number}`);
  return portion;
}

/**
 * Остаток добора: вопросы порций, на которые ответа ещё нет.
 *
 * `answered` — идентификаторы банка, уже закрытые лестницей (по таблице mapping) и
 * прошлыми порциями. Порядок сохраняется, поэтому следующая порция — это первые
 * непройденные вопросы, а не пересчёт состава заново.
 */
export const fullMapRemaining = (answered: Iterable<string> = []): RawFullMapQuestion[] => {
  const done = new Set(answered);
  return fullMapQuestions().filter((question) => !done.has(question.id));
};

export function fullMapInterlude(number: number): RawFullMapInterlude {
  const interlude = map().interludes.find((candidate) => candidate.number === number);
  if (!interlude) throw new Error(`content/slices/full-map.md: нет промежуточного блока ${number}`);
  return interlude;
}

/**
 * Текст промежуточного блока по ключам двух осей. Ключ полосы — `низко`, `середина`,
 * `высоко`; ключ варианта — буква из банка. Пары покрыты полностью, поэтому пустого
 * ответа тут не бывает: отсутствие пары — ошибка контента, а не состояние человека.
 */
export function fullMapInterludeText(number: number, first: string, second: string): string {
  const interlude = fullMapInterlude(number);
  const pair = interlude.pairs.find((candidate) => candidate.first === first && candidate.second === second);
  if (!pair) throw new Error(`content/slices/full-map.md: в блоке ${number} нет пары ${first}×${second}`);
  return pair.text;
}

// ── Что у человека уже есть ───────────────────────────────────────────────────

/** Один срез, добор которого человек уже прошёл. */
export interface FullMapSlice {
  slice: string;
  answers: SliceAnswers;
  /** Что разбор открытых ответов среза дал в машинном виде. */
  findings?: SliceTextFindings;
}

/**
 * Всё, что человек ответил к моменту добора полной карты.
 *
 * Три входа, но профиль по ним собирается один (`buildFullMapProfile`): лестница
 * переводится в идентификаторы банка по таблице mapping, порции добора приходят
 * идентификаторами банка сразу, а доборы срезов идентификаторов банка не имеют и
 * состав добора не меняют.
 */
export interface FullMapInput {
  ladder: LadderAnswers;
  /** Ответы порций добора: `Q1`–`Q40`, `О2`, `О3`. */
  bank?: BankAnswers;
  slices?: FullMapSlice[];
}

const answeredText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const answeredInBank = (answers: BankAnswers, id: string): boolean => {
  const value = answers[id];
  return typeof value === "number" || answeredText(value);
};

/** Ответы банка целиком: лестница по таблице mapping плюс порции добора. */
export const fullMapBankAnswers = (input: FullMapInput): BankAnswers => ({
  ...bankAnswersFromLadder(input.ladder),
  ...(input.bank ?? {}),
});

/** Идентификаторы банка, которые лестница задаёт: таблица mapping, включая открытый `О1`. */
const ladderBankIds = (): Set<string> => new Set(rawContent.questions.map((question) => question.source));

/**
 * Идентификаторы банка, на которые ответ уже есть: заданные на лестнице по
 * таблице mapping и отвеченные в прошлых порциях добора.
 *
 * Вопрос лестницы считается закрытым по таблице, а не по наличию ответа: он уже
 * задан, и второй раз его не задают ни при пропуске, ни при возврате на страницу.
 */
export const fullMapAnswered = (input: FullMapInput): string[] => {
  const answers = fullMapBankAnswers(input);
  const ladder = ladderBankIds();
  return rawContent.bank
    .filter((question) => ladder.has(question.id) || answeredInBank(answers, question.id))
    .map((question) => question.id);
};

/**
 * Остаток банка: вопросы, на которые ответа ещё нет, в порядке порций файла среза.
 *
 * Состав именно вычитается из полного банка, а не переписывается руками: вопрос,
 * заданный на лестнице или в прошлой порции, второй раз не задаётся (Закон 2).
 * Доборы срезов в вычитании не участвуют — идентификаторов банка у них нет,
 * поэтому состав добора от числа купленных срезов не зависит.
 */
export function fullMapRemainder(input: FullMapInput): RawFullMapQuestion[] {
  const answered = new Set(fullMapAnswered(input));
  const order = fullMapQuestions();
  const byId = new Map(order.map((question, index) => [question.id, index]));

  return rawContent.bank
    .filter((question) => !answered.has(question.id))
    .map((question) => {
      const index = byId.get(question.id);
      if (index === undefined)
        throw new Error(`content/slices/full-map.md: вопрос ${question.id} остался без ответа и без порции`);
      return index;
    })
    .sort((left, right) => left - right)
    .map((index) => order[index]!);
}

// ── Порции добора ─────────────────────────────────────────────────────────────

/** Порция добора полной карты: 10 + 11 + 10 по файлу среза. */
export interface FullMapPortion {
  number: number;
  /** Сколько всего порций у добора. */
  count: number;
  /** Вопросы порции — как они стоят в файле среза. */
  questions: RawFullMapQuestion[];
  /** Номер промежуточного блока после этой порции; null — дальше идёт разбор. */
  interlude: number | null;
}

/**
 * Порция, которую человек проходит сейчас: первая, где остался неотвеченный
 * вопрос. `null` — добор выдан до конца.
 *
 * Состав порции не пересчитывается: человек возвращается на ту же порцию, а не
 * получает новый набор (`docs/11-ui-page-spec.md`, краевое состояние «уход на
 * середине»). Вычитание уже отвеченного — на составе добора (`fullMapRemainder`),
 * а не внутри порции.
 */
export function nextFullMapPortion(input: FullMapInput): FullMapPortion | null {
  const remainder = new Set(fullMapRemainder(input).map((question) => question.id));
  const portions = fullMapPortions();

  for (const [index, portion] of portions.entries()) {
    if (!portion.questions.some((question) => remainder.has(question.id))) continue;
    return {
      number: portion.number,
      count: portions.length,
      questions: portion.questions,
      interlude: index < portions.length - 1 ? portion.number : null,
    };
  }
  return null;
}

/** Добор выдан до конца: на все вопросы всех порций есть ответы. */
export const fullMapDelivered = (input: FullMapInput): boolean => nextFullMapPortion(input) === null;

// ── Промежуточные блоки между порциями ────────────────────────────────────────

/**
 * Ключ оси промежуточного блока. Полоса пары шкальных вопросов считается той же
 * `scoreCoordinate`, что и профиль: своей арифметики у блока нет. `null` — на
 * вопрос оси ответа нет, и блок не выдаётся: догадок в нём не бывает.
 */
function axisKey(axis: RawFullMapAxis, answers: BankAnswers): string | null {
  if (axis.kind === "вариант") {
    const value = answers[axis.ids[0] ?? ""];
    return typeof value === "string" && axis.keys.includes(value) ? value : null;
  }

  const evidence = bankScales(axis.ids, answers);
  if (evidence.length !== axis.ids.length) return null;
  const score = scoreCoordinate(evidence);
  if (!score) return null;

  // Ключи полосы записаны в файле от низкого полюса к высокому.
  const [low, middle, high] = axis.keys;
  const pointer = pointerOfBand(score.band);
  return (pointer === 1 ? high : pointer === -1 ? low : middle) ?? null;
}

/**
 * Промежуточный блок после названной порции: lookup по двум осям
 * (`content/slices/full-map.md`, «Промежуточный блок N»). `null` — ответов осей
 * ещё нет.
 */
export function buildFullMapInterlude(number: number, input: FullMapInput): InterludeBlock | null {
  const interlude = fullMapInterlude(number);
  const answers = fullMapBankAnswers(input);

  const [first, second] = interlude.axes.map((axis) => axisKey(axis, answers));
  if (!first || !second) return null;

  return {
    slice: fullMap().slice,
    afterPortion: number,
    heading: interlude.heading,
    paragraphs: [fullMapInterludeText(number, first, second)],
    source: "lookup",
  };
}

// ── Профиль: один расчёт на три входа ─────────────────────────────────────────

/** Число из строки контента: пороги и потолки живут в файле среза, а не в коде. */
function numberIn(text: string, pattern: RegExp, where: string): number {
  const found = pattern.exec(text);
  if (!found) throw new Error(`${fullMap().file}: в ${where} не найдено число («${text}»)`);
  return Number(found[1]);
}

const checkAt = (index: number): string => {
  const check = fullMap().threshold.checks[index];
  if (!check) throw new Error(`${fullMap().file}: нет пункта порога ${index + 1}`);
  return check;
};

/**
 * Подтипы и флаги, которые ветка добора умеет ставить. Список нужен сверке кода с
 * контентом: пропавшая строка в файле среза или подтип без правила ломают тест
 * (E2-12).
 */
export const FULL_MAP_SUBTYPES: string[] = [
  "map_full",
  "map_motive_hypothesis",
  "map_open_thin",
  "entry_mismatch",
];

const subtypeText = (code: string): string => {
  const subtype = fullMap().subtypes.find((candidate) => candidate.code === code);
  if (!subtype) throw new Error(`${fullMap().file}: нет подтипа ${code}`);
  return subtype.text;
};

/** Минимум слов в открытом ответе: пункт порога про `О2` и `О3`. */
const openMinWords = (): number => numberIn(checkAt(2), /не меньше (\d+) слов/, "пункте порога об открытых");

/** Сколько координат нужно закрыть не ниже medium: пункт порога о числе координат. */
const mapFullCount = (): number =>
  numberIn(subtypeText("map_full"), /не меньше (\d+) координат/, "формулировке подтипа map_full");

/**
 * Потолок точности из раздела «Границы точности», если он ещё записан как действующий.
 * После калибровки банка (E5-11) координат на двух вопросах не осталось: строка
 * про прежний предел medium больше не задаёт потолок, и функция возвращает null.
 */
function accuracyCeiling(): { coordinates: number[]; cap: Confidence } | null {
  const line = fullMap().accuracy.find((item) => /потолок — `/.test(item) || /потолок —`/.test(item));
  if (!line) return null;

  const bold = /\*\*([\d,\sи]+)\*\*/.exec(line);
  const level = /`(low|medium|high)`/.exec(line);
  if (!bold || !level) throw new Error(`${fullMap().file}: строка о потолке не разобрана («${line}»)`);

  const coordinates = [...bold[1]!.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (!coordinates.length) throw new Error(`${fullMap().file}: в строке о потолке не названы координаты`);
  return { coordinates, cap: level[1] as Confidence };
}

/**
 * Координата, которая держится на вопросе с ролью «низкий вес»: сама по себе она
 * даёт только гипотезу, подтверждение приходит из открытых ответов
 * (`content/slices/full-map.md`, «Границы точности»).
 */
function lowWeightCoordinate(): number {
  const question = rawContent.bank.find((candidate) => candidate.role === "низкий вес");
  if (!question) throw new Error("content/questions-full-bank.md: нет вопроса с ролью «низкий вес»");
  const coordinate = question.coordinates[0];
  if (coordinate === undefined) throw new Error(`${question.id}: вопрос низкого веса не привязан к координате`);
  return coordinate;
}

/**
 * Координата, названная в формулировке подтипа. Номеров координат в коде этого
 * среза нет: подтип `entry_mismatch` говорит про способ входа, а какая это
 * координата — сказано в `docs/02-coordinates.md` её названием.
 */
function coordinateNamedIn(text: string, where: string): number {
  const folded = text.toLowerCase();
  const matched = rawContent.coordinates.filter((coordinate) =>
    folded.includes(coordinate.name.toLowerCase().split(/\s+/).slice(0, 2).join(" ")),
  );
  if (matched.length !== 1)
    throw new Error(
      `${fullMap().file}: в ${where} названа не одна координата (${matched.map((item) => item.id).join(", ") || "ни одной"})`,
    );
  return matched[0]!.id;
}

const wordsOf = (value: unknown): number =>
  typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;

/** Открытые ответы добора: `О2` и `О3`. Арифметики они не дают, их читает модель. */
const openAnswers = (input: FullMapInput): string[] =>
  fullMapQuestions()
    .filter((question) => question.type === "открытый")
    .map((question) => String(input.bank?.[question.id] ?? ""));

/**
 * Профиль после добора полной карты — один расчёт на три входа.
 *
 * Лестница переводится в идентификаторы банка, порции добора уже в них, и всё
 * вместе уходит в `buildProfileFromBank`: инверсия обратных, среднее, полоса и
 * confidence считает та же `scoreCoordinate`, что лестницу и доборы срезов
 * (`content/slices/full-map.md`, раздел «Скоринг добора»). Второго набора правил
 * на один профиль здесь нет и быть не может.
 *
 * Ответы лестницы не заменяются: они входят в расчёт наравне с ответами добора,
 * поэтому совпадение полос поднимает confidence само, а расхождение разбирается
 * «Правилом расхождения» внутри `scoreCoordinate`, а не усреднением.
 *
 * Доборы купленных срезов применяются после — тем же `applySlice`, что и раньше:
 * они уточняют коды координат, а не пересчитывают числа заново.
 */
export function buildFullMapProfile(input: FullMapInput, options: ProfileOptions = {}): Profile {
  const single = buildProfileFromBank(fullMapBankAnswers(input), options);

  const withSlices = (input.slices ?? []).reduce(
    (profile, purchased) => applySlice(purchased.slice, profile, purchased.answers, purchased.findings),
    single,
  );

  return applyFullMapFindings(withSlices, input);
}

/**
 * Подтипы, флаги и потолки самого добора (`content/slices/full-map.md`, разделы
 * «Скоринг добора» и «Границы точности»). Числа здесь уже посчитаны — это
 * называние того, что получилось, а не второй расчёт.
 */
function applyFullMapFindings(profile: Profile, input: FullMapInput): Profile {
  const slice = fullMap().slice;
  const ceiling = accuracyCeiling();
  const coordinates = { ...profile.coordinates };

  // Потолок пар: если в границах точности он ещё записан, координата выше него не поднимается.
  if (ceiling) {
    for (const id of ceiling.coordinates) {
      const state = coordinates[id];
      if (!state || !state.sources.length) continue;
      coordinates[id] = { ...state, confidence: capConfidence(state.confidence, ceiling.cap) };
    }
  }

  const filled = (id: number): boolean => (coordinates[id]?.sources.length ?? 0) > 0;
  const minWords = openMinWords();

  const configurations: SliceConfiguration[] = [];
  const configure = (code: string, sources: string[]): void => {
    if (!FULL_MAP_SUBTYPES.includes(code)) throw new Error(`${fullMap().file}: подтип ${code} не объявлен в коде`);
    configurations.push({ slice, code, value: subtypeText(code), sources });
  };

  if (mediumOrBetter({ ...profile, coordinates }) >= mapFullCount()) {
    configure("map_full", ["весь добор"]);
  }
  if (
    ceiling &&
    FULL_MAP_SUBTYPES.includes("map_thin_pairs") &&
    ceiling.coordinates.every(filled) &&
    ceiling.coordinates.every((id) => coordinates[id]?.confidence !== "high")
  ) {
    configure(
      "map_thin_pairs",
      ceiling.coordinates.flatMap((id) => coordinates[id]?.sources ?? []),
    );
  }
  // Мотив держится на одном вопросе с низким весом: подтверждение — только из открытых.
  const motive = coordinates[lowWeightCoordinate()];
  if (motive && motive.sources.length === 1 && motive.confidence === "low") {
    configure("map_motive_hypothesis", motive.sources);
  }
  const open = openAnswers(input);
  if (open.some((answer) => wordsOf(answer) < minWords)) {
    configure(
      "map_open_thin",
      fullMapQuestions()
        .filter((question) => question.type === "открытый")
        .map((question) => question.id),
    );
  }

  /*
   * `entry_mismatch` — то же расхождение, что общее «Правило расхождения» уже
   * нашло внутри `scoreCoordinate`: ключевой способ входа против своих шкал.
   * Здесь оно только получает имя этого среза, значение остаётся по ключевому.
   */
  const entryCoordinate = coordinateNamedIn(subtypeText("entry_mismatch"), "формулировке подтипа entry_mismatch");
  const entry = coordinates[entryCoordinate];
  const entryFlags = entry?.flags ?? [];
  const flags = [...profile.flags];
  if (entry && entryFlags.includes(`self_report_mismatch_${entryCoordinate}`)) {
    if (!entryFlags.includes("entry_mismatch")) {
      coordinates[entryCoordinate] = { ...entry, flags: [...entryFlags, "entry_mismatch"] };
    }
    if (!flags.includes("entry_mismatch")) flags.push("entry_mismatch");
  }

  return {
    ...profile,
    coordinates,
    flags,
    configurations: [...profile.configurations, ...configurations],
  };
}

// ── Порог генерации добора ────────────────────────────────────────────────────

interface FullMapContext {
  input: FullMapInput;
  profile: Profile;
  /** Профиль по одной лестнице: нужен пункту про координаты, которые она оставляла пустыми. */
  ladderOnly: Profile;
}

/**
 * Пункты чек-листа порога (`content/slices/full-map.md`, «Порог генерации»).
 * Порядок и число — как в файле; тексты пунктов и уточняющие живут в контенте.
 */
const THRESHOLD: ((context: FullMapContext) => boolean)[] = [
  ({ input }) => {
    const skipped = fullMapRemainder(input).filter((question) => question.type !== "открытый").length;
    const reached = fullMapPortions().every((portion) =>
      portion.questions.some((question) => answeredInBank(fullMapBankAnswers(input), question.id)),
    );
    return reached && skipped <= numberIn(checkAt(0), /не больше (\d+)/, "первом пункте порога");
  },
  ({ profile }) => mediumOrBetter(profile) >= numberIn(checkAt(1), /Не меньше (\d+) координат/, "втором пункте порога"),
  ({ input }) => {
    const minWords = openMinWords();
    const open = openAnswers(input);
    return open.length > 0 && open.every((answer) => wordsOf(answer) >= minWords);
  },
  ({ profile, ladderOnly }) =>
    unknownCoordinates(ladderOnly).every((coordinate) => (profile.coordinates[coordinate.id]?.sources.length ?? 0) > 0),
  // Полоса — координата, у которой есть положение на шкале; коды без полосы
  // (уязвимость, мотив, способ решать, сюжет и задача периода) сюда не попадают.
  ({ profile }) =>
    Object.values(profile.coordinates).every(
      (coordinate) => !coordinate.sources.length || coordinate.band === null || coordinate.sources.length >= 2,
    ),
];

/**
 * Порог генерации добора: не взят — отчёт не пишем и отдаём уточняющие из файла
 * среза (Правило 8 из `docs/04-alignment-rules.md`).
 */
export function fullMapThreshold(
  input: FullMapInput,
  profile: Profile,
  options: ProfileOptions = {},
): SliceThreshold {
  const { checks, followUps } = fullMap().threshold;
  if (checks.length !== THRESHOLD.length)
    throw new Error(
      `${fullMap().file}: пунктов порога в контенте ${checks.length}, условий в коде ${THRESHOLD.length}`,
    );

  const context: FullMapContext = { input, profile, ladderOnly: buildProfile(input.ladder, options) };
  const missing = checks.filter((_check, index) => !THRESHOLD[index]!(context));

  return { passed: missing.length === 0, missing, followUps: missing.length ? followUps : [], blocked: null };
}

/**
 * Порог до синтеза О3. Задача периода (координата 16) пишется тем же вызовом,
 * что текст, поэтому до провайдера её ещё нет: без зонда пункт про пустые
 * координаты и счётчик `medium+` (шестнадцатая может быть двенадцатой) валят
 * порог ложно. Короткий О3 зонд не спасает — провайдера не вызываем.
 */
export function fullMapThresholdBeforeSynthesis(
  input: FullMapInput,
  options: ProfileOptions = {},
): SliceThreshold {
  const periodTask = options.periodTask ?? {
    value: "ожидание синтеза",
    code: "period_task_probe",
    confidence: "medium" as const,
  };
  const probed = { ...options, periodTask };
  return fullMapThreshold(input, buildFullMapProfile(input, probed), probed);
}

/** Итог по добору полной карты: что показываем сейчас и можно ли собирать отчёт. */
export interface FullMapReport {
  ready: boolean;
  /** Порция, которую человек проходит сейчас; `null` — добор выдан до конца. */
  portion: FullMapPortion | null;
  /** Промежуточный блок, который выдаётся вместо следующих вопросов; `null` — не время. */
  interlude: InterludeBlock | null;
  threshold: SliceThreshold;
  profile: Profile;
}

/**
 * Состояние добора по текущим ответам. Отчёт собирается только после третьей
 * порции: до конца добора его не существует, за него уже заплачено, а ответы
 * ещё не отданы (`content/slices/README.md`, правила 5 и 6).
 */
export function fullMapReport(input: FullMapInput, options: ProfileOptions = {}): FullMapReport {
  const profile = buildFullMapProfile(input, options);
  const portion = nextFullMapPortion(input);
  const threshold = fullMapThreshold(input, profile, options);

  /*
   * Промежуточный блок выдаётся, когда порция перед ним закрыта: по Закону 1
   * ценность приходит раньше, чем запрошен следующий шаг, поэтому блок стоит
   * между порциями, а не после отчёта.
   */
  const previous = portion ? portion.number - 1 : fullMapPortions().length;
  const interlude =
    previous >= 1 && previous < fullMapPortions().length ? buildFullMapInterlude(previous, input) : null;

  return { ready: portion === null && threshold.passed, portion, interlude, threshold, profile };
}
