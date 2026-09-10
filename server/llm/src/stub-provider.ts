/**
 * Рабочая заглушка провайдера (E4-12).
 *
 * Это заглушка, а не модель. Она не притворяется умной: её работа — дать
 * структурно правильный ответ, чтобы контур продукта работал целиком, пока
 * настоящий провайдер не выбран основателем (открытый вопрос 5 в
 * `docs/14-state.md`). Внутренние счётчики вроде «проход 6» и «круг 11» в текст
 * не попадают: это не сюжет, а след набора объёма, и его видно человеку.
 *
 * На вход — только `GenerationRequest`, тот же порт, что у настоящей модели:
 * никаких обходных путей в движок и никакого доступа к заданию кроме полей
 * `instruction` и `data`. Выход собирается из того, что уже лежит в промпте:
 * доступные координаты, профиль с confidence, открытый ответ, тип отчёта.
 * При одном и том же задании ответ один и тот же.
 */

import { ladderCapOf, registerMarkers, volumeOf, type WordRange } from "./content.js";
import { scanText, type Confidence } from "./engine.js";
import { LADDER_FINAL } from "./validator.js";
import type { ModelOutput, Statement, StatementKind, Storyline } from "./output.js";
import {
  GenerationError,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type TokenPricing,
} from "./provider.js";
import { wordCount, words } from "./text.js";

const FREE: TokenPricing = { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 };

interface FilledCoordinate {
  id: number;
  confidence: Confidence;
  code: string | null;
}

interface ParsedTask {
  coordinates: number[];
  profile: FilledCoordinate[];
  openAnswer: string;
  reportType: string;
  storyline: boolean;
  periodTask: boolean;
}

interface Draft {
  phrase: string;
  kind: StatementKind;
  coordinate: number | null;
}

const UNKNOWNS = [
  "Чего я о тебе не знаю: когда этот круг встал впервые и что было тогда на выходе.",
  "Не знаю, чья оценка стоит у тебя на этом шаге — одного человека или всех сразу.",
  "Не знаю, что происходит в те разы, когда ты всё-таки показал сделанное.",
  "Механизм я вижу, начала у него — нет.",
];

function capitalize(text: string): string {
  const first = text[0];
  if (!first) return text;
  return first.toLocaleUpperCase("ru") + text.slice(1);
}

function sectionBody(text: string, title: string): string {
  const heading = `## ${title}`;
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const after = text.slice(start + heading.length).replace(/^\n/, "");
  const next = after.search(/\n## /);
  return (next < 0 ? after : after.slice(0, next)).trim();
}

function parseCoordinates(instruction: string): number[] {
  const match = /Доступные координаты:\s*([^\n]+)/.exec(instruction);
  if (!match) return [];
  const rest = match[1]!.split(".")[0]!.trim();
  if (!rest || rest === "нет") return [];
  return rest
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function parseProfile(data: string): FilledCoordinate[] {
  const body = sectionBody(data, "ПРОФИЛЬ КООРДИНАТ");
  const rows: FilledCoordinate[] = [];
  for (const line of body.split("\n")) {
    const match =
      /^(\d+)\.\s+.+\s·\sположение:\s.*\s·\sкод:\s(.+?)\s·\sполоса:\s.*\s·\sconfidence:\s(high|medium|low)\s·/.exec(
        line.trim(),
      );
    if (!match) continue;
    const code = match[2]!.trim();
    rows.push({
      id: Number(match[1]),
      code: code === "—" ? null : code,
      confidence: match[3] as Confidence,
    });
  }
  return rows;
}

function parseOpenAnswer(data: string): string {
  const found: string[] = [];
  const pattern = /<<<ДАННЫЕ:([0-9a-f]+)\n([\s\S]*?)\nДАННЫЕ:\1>>>/g;
  for (const match of data.matchAll(pattern)) found.push(match[2]!.trim());
  return found.join("\n");
}

function parseReportType(instruction: string): string {
  const match = /Тип отчёта:\s*([a-zа-яё_]+)/iu.exec(instruction);
  return match?.[1] ?? LADDER_FINAL;
}

function parseStorylineNeeded(instruction: string): boolean {
  if (/«сюжет»\s*—\s*не заполнять/.test(instruction)) return false;
  if (/«сюжет»\s*—\s*сюжет/.test(instruction)) return true;
  return parseReportType(instruction) === LADDER_FINAL;
}

function parsePeriodTaskNeeded(instruction: string): boolean {
  return /«задача_периода»\s*—\s*задача периода/.test(instruction);
}

function parseOpenNamed(data: string, title: string): string {
  return parseOpenAnswer(sectionBody(data, title));
}

function parseTask(request: GenerationRequest): ParsedTask {
  const instruction = request.instruction.replace(/\r\n?/g, "\n");
  const data = request.data.replace(/\r\n?/g, "\n");
  const coordinates = parseCoordinates(instruction);
  const profile = parseProfile(data).filter((row) => coordinates.includes(row.id));
  return {
    coordinates,
    profile,
    openAnswer: parseOpenAnswer(data),
    reportType: parseReportType(instruction),
    storyline: parseStorylineNeeded(instruction),
    periodTask: parsePeriodTaskNeeded(instruction),
  };
}

function volumeFor(type: string): WordRange {
  try {
    return volumeOf(type);
  } catch {
    return volumeOf(type === LADDER_FINAL ? LADDER_FINAL : "срез_узел");
  }
}

/** Четыре слова подряд из ответа: валидатор требует дословную цитату. */
function pickQuote(source: string): string {
  const tokens = words(source);
  for (let start = 0; start + 4 <= tokens.length; start += 1) {
    const run = tokens.slice(start, start + 4).join(" ");
    if (scanText(run, "разбор").length === 0) return run;
  }
  if (tokens.length >= 4) return tokens.slice(0, 4).join(" ");
  return tokens.join(" ");
}

function quoteDraft(openAnswer: string): Draft {
  const taken = pickQuote(openAnswer).replace(/[.?!]+$/u, "");
  const core = taken || "дело стоит на месте";
  return { phrase: `Ты назвал это так: ${core}.`, kind: "цитата", coordinate: null };
}

function highPhrase(n: number): string {
  const variants = [
    "Ты берёшь дело целиком и доводишь его до состояния, когда сделано почти всё, а последняя часть остаётся несделанной.",
    "Дальше дело не заканчивается и не бросается насовсем: оно стоит в почти готовом виде и продолжает забирать место.",
    "Ты довёл дело до последнего шага и остановился, не отдав сделанное чужой оценке.",
    "Сделанное у тебя уже есть, а закрытым оно не становится: последняя часть так и остаётся при тебе.",
    "Ты держишь дело открытым не на старте, а там, где его уже можно было бы отдать.",
    "Круг замыкается не на усталости, а на шаге показа, и поэтому он повторяется с делами, которые тебе важны.",
    "Ты входишь в дело рывком и тащишь его сам до того места, где остаётся только показать результат.",
    "Почти готовое дело у тебя не уходит в сторону: оно занимает место и ждёт шага, которого нет.",
    "Ты оставляешь последнюю часть несделанной даже тогда, когда всё остальное уже стоит на месте.",
    "Остановка у тебя случается не в начале и не в середине, а там, где дело уже можно считать готовым.",
    "Ты не бросаешь замысел: ты останавливаешься у точки, где сделанное должно выйти к другому человеку.",
    "Дело у тебя живёт в почти готовом виде дольше, чем в работе: закрытие для тебя отдельно от изготовления.",
  ];
  return variants[n % variants.length]!;
}

function mediumPhrase(n: number, marker: string, markers: string[]): string {
  if (marker === "проверь") {
    return "Проверь по трём последним делам, сколько из них началось рывком и сколько так и осталось почти готовыми.";
  }
  const check = markers.includes("проверь")
    ? " — проверь по трём последним делам, сколько из них началось именно так"
    : "";
  const variants = [
    `ты связывал это с силами, а начинается круг раньше и в другом месте${check}.`,
    `под нагрузкой ты не снимаешь с себя объём, а добавляешь: к последней четверти список у тебя длиннее, чем в начале.`,
    `один разговор о сделанном забирает у тебя не вечер, а несколько дней, и всё это время дело стоит.`,
    `ты входишь в дело рывком, на подъёме, и первые дни расход у тебя выше возврата${check}.`,
    `закрыть для тебя и значит показать, а показать — отдать сделанное чужой оценке.`,
    `ты держишь последнюю часть при себе не из лени, а потому что незакрытое ещё нельзя потерять.`,
    `дело стоит готовым дольше, чем ты сам себе в этом признаёшься${check}.`,
    `ты добавляешь ещё одну задачу вместо того, чтобы отдать уже сделанную.`,
    `остановка собирается не из нехватки сил, а из шага, где появляется чужая оценка.`,
    `ты возвращаешься к почти готовому делу уже без желания, и круг начинается снова.`,
    `ты берёшь следующий кусок раньше, чем закрыл предыдущий, и список растёт к финишу.`,
    `показанное один раз меняет для тебя цену всего, что ещё не отдано.`,
  ];
  const rest = variants[n % variants.length]!;
  if (marker.endsWith("что")) return `${capitalize(marker)} ${rest}`;
  return `${capitalize(marker)}, ${rest}`;
}

function lowPhrase(n: number): string {
  const variants = [
    "Может ли быть, что открытым ты оставляешь не замысел, а именно точку показа?",
    "А что если ты держишь дело открытым не потому, что оно не готово, а потому, что незакрытое ещё нельзя потерять?",
    "И что ты называешь причиной остановки чаще — что дело ещё не готово или что не готов ты?",
    "Что если круг собирается заново не от нового дела, а от того же шага показа?",
    "Может ли быть, что чужая оценка для тебя стоит дороже, чем само сделанное?",
    "А что если последняя часть остаётся несделанной именно затем, чтобы дело ещё нельзя было оценить?",
    "И что происходит в те разы, когда ты всё-таки показал сделанное — круг ломается или собирается снова?",
    "Может ли быть, что список к финишу растёт потому, что закрытие для тебя равнозначно отдаче?",
    "А что если рывок в начале уже содержит эту остановку, только она ещё не видна?",
    "И кому ты на этом шаге отдаёшь право сказать, готово ли дело?",
    "Может ли быть, что ты останавливаешься не перед работой, а перед тем, чтобы её увидели?",
    "Что если готовое дело для тебя ещё не существует, пока его не принял другой человек?",
  ];
  return variants[n % variants.length]!;
}

function claimDraft(n: number, coordinate: FilledCoordinate, markers: string[]): Draft {
  if (coordinate.confidence === "high") {
    return { phrase: highPhrase(n), kind: "утверждение", coordinate: coordinate.id };
  }
  if (coordinate.confidence === "medium") {
    const marker = markers[n % markers.length]!;
    return { phrase: mediumPhrase(n, marker, markers), kind: "вероятность", coordinate: coordinate.id };
  }
  return { phrase: lowPhrase(n), kind: "вопрос", coordinate: coordinate.id };
}

function unknownDraft(index: number): Draft {
  if (index < UNKNOWNS.length) return { phrase: UNKNOWNS[index]!, kind: "неизвестное", coordinate: null };
  const extras = [
    "Не знаю, с какого шага этот круг собирается заново, когда дело уже было почти готово.",
    "Не знаю, меняется ли для тебя цена показа от человека к человеку.",
    "Не знаю, что ты оставляешь себе, когда всё-таки доводишь дело до чужих глаз.",
    "Не знаю, был ли когда-то финиш, после которого круг не собрался снова.",
  ];
  return { phrase: extras[(index - UNKNOWNS.length) % extras.length]!, kind: "неизвестное", coordinate: null };
}

function asStatement(draft: Draft): Statement {
  return { phrase: draft.phrase, kind: draft.kind, coordinate: draft.coordinate };
}

function paragraphOf(items: Draft[]): string {
  return items.map((item) => item.phrase).join(" ");
}

function totalWords(parts: Draft[][]): number {
  return wordCount(parts.map(paragraphOf).filter(Boolean).join("\n\n"));
}

function buildStoryline(task: ParsedTask): Storyline | null {
  if (!task.storyline) return null;
  const cap = ladderCapOf(15);
  const confidence: Confidence = cap ?? "low";
  const compact = task.openAnswer.replace(/\s+/g, " ").trim();
  const value = (compact || "круг из открытого ответа").slice(0, 120);
  return { value, code: "stub_open_loop", confidence };
}

function buildPeriodTask(task: ParsedTask, data: string): Storyline | null {
  if (!task.periodTask && task.reportType !== "полная_карта") return null;
  const o3 = parseOpenNamed(data, "ОТКРЫТЫЙ ОТВЕТ О3") || parseOpenNamed(data, "ОТКРЫТЫЙ ОТВЕТ O3");
  const source = o3 || task.openAnswer;
  const compact = source.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return { value: compact.slice(0, 120), code: "stub_period_task", confidence: "medium" };
}

function buildOutput(task: ParsedTask, data: string): ModelOutput {
  const volume = volumeFor(task.reportType);
  const ladder = task.reportType === LADDER_FINAL;
  const markers = registerMarkers().medium;
  const pool = task.profile.length ? task.profile : [];

  const quote = quoteDraft(task.openAnswer);
  const unknowns = [unknownDraft(0), unknownDraft(1), unknownDraft(2)];
  const claims: Draft[] = [];
  let n = 1;
  const nextClaim = (): Draft | null => {
    if (!pool.length) return null;
    const coordinate = pool[(n - 1) % pool.length]!;
    const draft = claimDraft(n, coordinate, markers);
    n += 1;
    return draft;
  };

  const first = nextClaim();
  const second = nextClaim();
  const lead = [quote, ...(first ? [first] : []), ...(second ? [second] : [])];
  const rest: Draft[] = [];
  const last = unknowns;

  const parts = (): Draft[][] => (ladder ? [lead, rest, last] : [lead.concat(rest), last]);

  while (totalWords(parts()) < volume.min) {
    const extra = nextClaim();
    if (!extra) break;
    rest.push(extra);
    if (totalWords(parts()) > volume.max) {
      rest.pop();
      break;
    }
  }

  const paragraphs = parts()
    .map(paragraphOf)
    .filter((part) => part.trim().length > 0);
  const text = paragraphs.join("\n\n");
  const drafts = ladder ? [...lead, ...rest, ...last] : [...lead, ...rest, ...last];

  return {
    text,
    statements: drafts.map(asStatement),
    storyline: buildStoryline(task),
    periodTask: buildPeriodTask(task, data),
  };
}

function serialize(output: ModelOutput): string {
  return JSON.stringify({
    текст: output.text,
    утверждения: output.statements.map((item) => ({
      фраза: item.phrase,
      вид: item.kind,
      координата: item.coordinate,
    })),
    ...(output.storyline
      ? {
          сюжет: {
            значение: output.storyline.value,
            код: output.storyline.code,
            уверенность: output.storyline.confidence,
          },
        }
      : {}),
    ...(output.periodTask
      ? {
          задача_периода: {
            значение: output.periodTask.value,
            код: output.periodTask.code,
            уверенность: output.periodTask.confidence,
          },
        }
      : {}),
  });
}

/** Собрать машинный конверт из задания. Нужно тестам заглушки, не серверу. */
export function stubEnvelope(request: GenerationRequest): string {
  const task = parseTask(request);
  return serialize(buildOutput(task, request.data.replace(/\r\n?/g, "\n")));
}

export interface StubProviderOptions {
  pricing?: TokenPricing;
  model?: string;
}

export class StubProvider implements GenerationProvider {
  readonly id = "stub";
  readonly model: string;
  readonly pricing: TokenPricing;

  constructor(options: StubProviderOptions = {}) {
    this.pricing = options.pricing ?? FREE;
    this.model = options.model || "stub-local";
  }

  async generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult> {
    if (signal.aborted) throw new GenerationError("временный отказ", "прекращено");
    const text = stubEnvelope(request);
    return {
      text,
      usage: {
        inputTokens: Math.ceil((request.instruction.length + request.data.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
      model: this.model,
    };
  }
}
