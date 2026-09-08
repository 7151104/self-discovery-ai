/**
 * Рабочая заглушка провайдера (E4-12).
 *
 * Это заглушка, а не модель. Она не притворяется умной: её работа — дать
 * структурно правильный ответ, чтобы контур продукта работал целиком, пока
 * настоящий провайдер не выбран основателем (открытый вопрос 5 в
 * `docs/14-state.md`).
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
    `В проходе ${n} ты довёл дело до последнего шага и остановился, не отдав сделанное чужой оценке.`,
    `На круге ${n} ты берёшь дело целиком и оставляешь последнюю часть несделанной.`,
    `Дальше на круге ${n} дело не заканчивается: оно стоит в почти готовом виде и продолжает забирать место.`,
  ];
  return variants[n % variants.length]!;
}

function mediumPhrase(n: number, marker: string, markers: string[]): string {
  if (marker === "проверь") {
    return `Проверь по трём последним делам, сколько из них в проходе ${n} началось рывком.`;
  }
  const check = markers.includes("проверь")
    ? " — проверь по трём последним делам, сколько из них началось именно так"
    : "";
  const rest = `в проходе ${n} расход у тебя выше возврата${check}.`;
  if (marker.endsWith("что") || marker.endsWith("похоже")) return `${capitalize(marker)} ${rest}`;
  return `${capitalize(marker)}, ${rest}`;
}

function lowPhrase(n: number): string {
  const variants = [
    `Может ли быть, что в проходе ${n} открытым ты оставляешь не замысел, а именно точку показа?`,
    `А что если на круге ${n} ты держишь дело открытым не потому, что оно не готово?`,
    `И что на круге ${n} ты называешь причиной остановки чаще — что дело ещё не готово или что не готов ты?`,
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
  return {
    phrase: `Чего я ещё не знаю про круг ${index}: с какого шага он собирается заново.`,
    kind: "неизвестное",
    coordinate: null,
  };
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

function buildOutput(task: ParsedTask): ModelOutput {
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
  });
}

/** Собрать машинный конверт из задания. Нужно тестам заглушки, не серверу. */
export function stubEnvelope(request: GenerationRequest): string {
  return serialize(buildOutput(parseTask(request)));
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
