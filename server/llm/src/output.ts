/**
 * Машинный выход модели: контракт, разбор и проверка (E4-05, E4-07).
 *
 * Модель отдаёт не голый текст, а объект: текст блока, разметку утверждений и
 * сюжет для координаты 15. Причина не в удобстве, а в двух правилах продукта,
 * которые иначе не проверить:
 *
 *   регистр речи обязан соответствовать confidence координаты, о которой идёт
 *   речь, — а сопоставить фразу с координатой по смыслу нельзя, это угадывание
 *   (риск задачи E4-05); поэтому координату называет модель, а слой проверяет,
 *   что названная фраза в тексте есть и что регистр ей разрешён;
 *
 *   координата 15 заполняется только структурированным результатом синтеза
 *   (`docs/14-state.md`, решение о координатах 15 и 16), и невалидный машинный
 *   выход обязан быть отклонён, а не записан в профиль.
 *
 * Контракт — машинный, как контракт API в `server/src/contract/`: он описывает
 * форму данных и ни одного продуктового текста о человеке не содержит.
 */

import { containsPhrase, normalize, sentences } from "./text.js";
import type { Confidence } from "./engine.js";

/** Вид фразы. Три первых — регистры речи, два последних — не утверждения вовсе. */
export type StatementKind = "утверждение" | "вероятность" | "вопрос" | "цитата" | "неизвестное";

const KINDS: StatementKind[] = ["утверждение", "вероятность", "вопрос", "цитата", "неизвестное"];

/** Виды, которые говорят о человеке и обязаны называть координату. */
export const CLAIM_KINDS: StatementKind[] = ["утверждение", "вероятность", "вопрос"];

export interface Statement {
  phrase: string;
  kind: StatementKind;
  /** Координата, о которой фраза. `null` допустим только у цитаты и неизвестного. */
  coordinate: number | null;
}

export interface Storyline {
  value: string;
  code: string;
  confidence: Confidence;
}

export interface ModelOutput {
  text: string;
  statements: Statement[];
  /** `null` — срез: сюжет координаты 15 пишет финал лестницы, не отчёт среза. */
  storyline: Storyline | null;
}

/** Почему машинный выход отклонён. */
export interface OutputProblem {
  kind:
    | "не json"
    | "нет поля"
    | "пустой текст"
    | "неизвестный вид"
    | "нет координаты"
    | "лишняя координата"
    | "фразы нет в тексте"
    | "предложение без разметки"
    | "сюжет"
    | "лишнее поле";
  detail: string;
}

export type ParsedOutput = { ok: true; output: ModelOutput } | { ok: false; problems: OutputProblem[] };

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/** Имена полей конверта. Русские, как и весь машинный словарь проекта. */
const FIELD = {
  text: "текст",
  statements: "утверждения",
  phrase: "фраза",
  kind: "вид",
  coordinate: "координата",
  storyline: "сюжет",
  value: "значение",
  code: "код",
  confidence: "уверенность",
} as const;

/**
 * Описание контракта для промпта. Собирается из тех же имён полей, что и разбор:
 * второго списка имён в репозитории нет, поэтому промпт и разбор не разъезжаются.
 */
export function outputContractText(
  coordinates: number[],
  options: { storyline?: "required" | "optional" } = {},
): string {
  const storyline = options.storyline ?? "required";
  const storylineLines =
    storyline === "required"
      ? [
          `- «${FIELD.storyline}» — сюжет из открытого ответа для координаты 15:`,
          `  · «${FIELD.value}» — формулировка сюжета одной строкой, не длиннее 120 знаков;`,
          `  · «${FIELD.code}» — машинный код сюжета латиницей через подчёркивание, например solo_then_drop;`,
          `  · «${FIELD.confidence}» — ${CONFIDENCES.join(" | ")}.`,
        ]
      : [`- «${FIELD.storyline}» — не заполнять: сюжет координаты 15 этому отчёту не нужен.`];

  return [
    `Ответ — один объект JSON и ничего кроме него. Ни пояснений, ни разметки, ни заголовка.`,
    ``,
    `Поля:`,
    `- «${FIELD.text}» — текст блока: ровно то, что велит написать задание выше, без заголовка.`,
    `- «${FIELD.statements}» — список. Каждое предложение текста разобрано ровно одной записью:`,
    `  · «${FIELD.phrase}» — фраза дословно, как она стоит в тексте;`,
    `  · «${FIELD.kind}» — один из: ${KINDS.map((kind) => `«${kind}»`).join(", ")};`,
    `  · «${FIELD.coordinate}» — номер координаты, о которой фраза; у видов «цитата» и «неизвестное» — null.`,
    ...storylineLines,
    ``,
    `Вид фразы означает регистр речи:`,
    `- «утверждение» — только о координате с confidence high;`,
    `- «вероятность» — о координате с confidence medium или high, с проверяемым признаком;`,
    `- «вопрос» — о координате с любым confidence, и единственный допустимый вид при low;`,
    `- «цитата» — фраза из открытого ответа, о человеке ничего не утверждает;`,
    `- «неизвестное» — то, чего ты о человеке не знаешь; только в последнем абзаце.`,
    ``,
    `Доступные координаты: ${coordinates.length ? coordinates.join(", ") : "нет"}. Другие номера называть нельзя.`,
  ].join("\n");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Первый объект JSON в ответе: модель иногда обрамляет его блоком кода. */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(body) as unknown;
}

function parseStoryline(value: unknown, problems: OutputProblem[]): Storyline | null {
  if (!isRecord(value)) {
    problems.push({ kind: "нет поля", detail: FIELD.storyline });
    return null;
  }

  const text = value[FIELD.value];
  const code = value[FIELD.code];
  const confidence = value[FIELD.confidence];

  if (typeof text !== "string" || !text.trim() || text.trim().length > 120)
    problems.push({ kind: "сюжет", detail: `${FIELD.value}: строка от 1 до 120 знаков` });
  if (typeof code !== "string" || !/^[a-z][a-z0-9_]{2,39}$/.test(code))
    problems.push({ kind: "сюжет", detail: `${FIELD.code}: латиница, подчёркивание, 3–40 знаков` });
  if (typeof confidence !== "string" || !CONFIDENCES.includes(confidence as Confidence))
    problems.push({ kind: "сюжет", detail: `${FIELD.confidence}: ${CONFIDENCES.join(" | ")}` });

  if (problems.some((problem) => problem.kind === "сюжет")) return null;
  return { value: (text as string).trim(), code: code as string, confidence: confidence as Confidence };
}

export interface ParseOptions {
  /** Координаты профиля, о которых модели разрешено говорить. */
  knownCoordinates: number[];
  /** По умолчанию обязателен: финал лестницы без сюжета не закрывает координату 15. */
  storyline?: "required" | "optional";
  /** По умолчанию обязателен. У среза в тестах можно принять текст без разметки. */
  statements?: "required" | "optional";
}

/**
 * Разбор и проверка формы. Проверяется именно форма: что текст есть, что каждая
 * названная фраза в нём стоит, что каждое предложение разобрано и что сюжет
 * годится в профиль. Смысл текста проверяет валидатор, регистры — `registers.ts`.
 */
export function parseModelOutput(raw: string, options: ParseOptions): ParsedOutput {
  let envelope: unknown;
  try {
    envelope = extractJson(raw);
  } catch (error) {
    return { ok: false, problems: [{ kind: "не json", detail: (error as Error).message }] };
  }

  if (!isRecord(envelope)) return { ok: false, problems: [{ kind: "не json", detail: "ответ не объект" }] };

  const problems: OutputProblem[] = [];

  for (const extra of Object.keys(envelope)) {
    if (extra !== FIELD.text && extra !== FIELD.statements && extra !== FIELD.storyline)
      problems.push({ kind: "лишнее поле", detail: extra });
  }

  const text = envelope[FIELD.text];
  if (typeof text !== "string" || !text.trim()) problems.push({ kind: "пустой текст", detail: FIELD.text });

  const statementsRequired = options.statements ?? "required";
  const storylineRequired = options.storyline ?? "required";

  const rawStatements = envelope[FIELD.statements];
  const statements: Statement[] = [];
  if (!Array.isArray(rawStatements) || !rawStatements.length) {
    if (statementsRequired === "required") problems.push({ kind: "нет поля", detail: FIELD.statements });
  } else {
    for (const [index, entry] of rawStatements.entries()) {
      if (!isRecord(entry)) {
        problems.push({ kind: "нет поля", detail: `${FIELD.statements}[${index}]` });
        continue;
      }
      const phrase = entry[FIELD.phrase];
      const kind = entry[FIELD.kind];
      const coordinate = entry[FIELD.coordinate] ?? null;

      if (typeof phrase !== "string" || !phrase.trim()) {
        problems.push({ kind: "нет поля", detail: `${FIELD.statements}[${index}].${FIELD.phrase}` });
        continue;
      }
      if (typeof kind !== "string" || !KINDS.includes(kind as StatementKind)) {
        problems.push({ kind: "неизвестный вид", detail: `${FIELD.statements}[${index}]: ${String(kind)}` });
        continue;
      }

      const claim = CLAIM_KINDS.includes(kind as StatementKind);
      if (claim && typeof coordinate !== "number") {
        problems.push({ kind: "нет координаты", detail: phrase });
        continue;
      }
      if (!claim && coordinate !== null) {
        problems.push({ kind: "лишняя координата", detail: `${kind}: ${phrase}` });
        continue;
      }
      if (typeof coordinate === "number" && !options.knownCoordinates.includes(coordinate)) {
        problems.push({ kind: "лишняя координата", detail: `координата ${coordinate} профилю не известна` });
        continue;
      }

      statements.push({
        phrase: phrase.trim(),
        kind: kind as StatementKind,
        coordinate: typeof coordinate === "number" ? coordinate : null,
      });
    }
  }

  const storyline =
    envelope[FIELD.storyline] === undefined || envelope[FIELD.storyline] === null
      ? null
      : parseStoryline(envelope[FIELD.storyline], problems);
  if (storylineRequired === "required" && !storyline && !problems.some((problem) => problem.kind === "сюжет" || problem.kind === "нет поля"))
    problems.push({ kind: "нет поля", detail: FIELD.storyline });

  if (typeof text === "string" && statements.length) {
    for (const statement of statements) {
      if (!containsPhrase(text, statement.phrase))
        problems.push({ kind: "фразы нет в тексте", detail: statement.phrase });
    }
    for (const sentence of sentences(text)) {
      const covered = statements.some(
        (statement) =>
          normalize(sentence).includes(normalize(statement.phrase)) ||
          normalize(statement.phrase).includes(normalize(sentence)),
      );
      if (!covered) problems.push({ kind: "предложение без разметки", detail: sentence });
    }
  }

  if (problems.length || typeof text !== "string") return { ok: false, problems };
  if (storylineRequired === "required" && !storyline) return { ok: false, problems };
  return { ok: true, output: { text, statements, storyline } };
}

export const describeProblem = (problem: OutputProblem): string => `${problem.kind}: ${problem.detail}`;
