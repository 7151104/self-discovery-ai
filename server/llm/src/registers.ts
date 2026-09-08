/**
 * Соответствие регистров речи и confidence координат (E4-05).
 *
 * Правило 4 из `docs/04-alignment-rules.md`: high — утверждение, medium —
 * вероятность с проверяемым признаком, low — вопрос. «Никогда наоборот»: регистр
 * сильнее разрешённого — ошибка, и именно она здесь ловится.
 *
 * Эшелон 3 отдельной проверки не требует и получить её не может: символический
 * слой физически не поднимается выше `low` (`docs/03-models-and-tiers.md`), а дата
 * рождения в скоринг не входит вообще. Поэтому «символика утверждает» — это то же
 * самое, что «утверждение при low», и проверяется одним правилом.
 *
 * Формулировки, по которым регистр опознаётся в тексте, берутся из
 * `content/forbidden.md` (раздел «Формулировки-исключения», пометка регистра), а
 * не из списка в коде: правка контента меняет проверку без правки кода.
 */

import { registerMarkers } from "./content.js";
import { CLAIM_KINDS, type ModelOutput, type Statement, type StatementKind } from "./output.js";
import { normalize, paragraphs, words } from "./text.js";
import type { Confidence, Profile } from "./engine.js";

/** Какие виды фраз разрешает confidence координаты. */
const ALLOWED: Record<Confidence, StatementKind[]> = {
  high: ["утверждение", "вероятность", "вопрос"],
  medium: ["вероятность", "вопрос"],
  low: ["вопрос"],
};

export interface RegisterProblem {
  kind:
    | "регистр сильнее confidence"
    | "координата пуста"
    | "форма не соответствует виду"
    | "цитата не из ответа"
    | "неизвестное не в последнем абзаце";
  phrase: string;
  detail: string;
}

const isQuestion = (phrase: string): boolean => /\?\s*[»"”)]?\s*$/.test(phrase.trim());

const hasMarker = (phrase: string, markers: string[]): boolean => {
  const folded = normalize(phrase);
  return markers.some((marker) => folded.includes(normalize(marker)));
};

/**
 * Есть ли в фразе цепочка из `least` слов подряд, взятая из открытого ответа.
 * Сравниваются слова, а не строки: между «сам, никого» и «сам никого» разницы
 * для цитаты нет, а для сравнения строк она есть.
 */
function borrowsFrom(phrase: string, source: string, least: number): boolean {
  const left = words(normalize(phrase));
  const right = words(normalize(source));
  for (let start = 0; start + least <= left.length; start += 1) {
    const run = left.slice(start, start + least);
    for (let at = 0; at + least <= right.length; at += 1) {
      if (run.every((word, offset) => word === right[at + offset])) return true;
    }
  }
  return false;
}

export interface RegisterCheck {
  profile: Profile;
  /** Открытый ответ человека: цитата обязана быть из него, а не сочинённой. */
  openAnswer: string;
}

function checkClaim(statement: Statement, check: RegisterCheck): RegisterProblem[] {
  const problems: RegisterProblem[] = [];
  const coordinate = statement.coordinate === null ? undefined : check.profile.coordinates[statement.coordinate];

  if (!coordinate || coordinate.sources.length === 0) {
    problems.push({
      kind: "координата пуста",
      phrase: statement.phrase,
      detail: `координата ${String(statement.coordinate)} в профиле не заполнена`,
    });
    return problems;
  }

  if (!ALLOWED[coordinate.confidence].includes(statement.kind)) {
    problems.push({
      kind: "регистр сильнее confidence",
      phrase: statement.phrase,
      detail: `вид «${statement.kind}» при confidence ${coordinate.confidence} координаты ${coordinate.id}`,
    });
  }

  const markers = registerMarkers();
  if (statement.kind === "вопрос" && !isQuestion(statement.phrase)) {
    problems.push({
      kind: "форма не соответствует виду",
      phrase: statement.phrase,
      detail: "вид «вопрос», а фраза не вопрос",
    });
  }
  if (statement.kind === "утверждение" && isQuestion(statement.phrase)) {
    problems.push({
      kind: "форма не соответствует виду",
      phrase: statement.phrase,
      detail: "вид «утверждение», а фраза — вопрос",
    });
  }
  if (statement.kind === "вероятность" && !hasMarker(statement.phrase, markers.medium)) {
    problems.push({
      kind: "форма не соответствует виду",
      phrase: statement.phrase,
      detail: "вид «вероятность» без оговорки и проверяемого признака",
    });
  }

  return problems;
}

/** Сверка каждой размеченной фразы с профилем. */
export function checkRegisters(output: ModelOutput, check: RegisterCheck): RegisterProblem[] {
  const problems: RegisterProblem[] = [];
  const last = paragraphs(output.text).at(-1) ?? output.text;

  for (const statement of output.statements) {
    if (CLAIM_KINDS.includes(statement.kind)) {
      problems.push(...checkClaim(statement, check));
      continue;
    }

    if (statement.kind === "цитата" && !borrowsFrom(statement.phrase, check.openAnswer, 4)) {
      problems.push({
        kind: "цитата не из ответа",
        phrase: statement.phrase,
        detail: "в открытом ответе такой последовательности слов нет",
      });
    }

    if (statement.kind === "неизвестное" && !normalize(last).includes(normalize(statement.phrase))) {
      problems.push({
        kind: "неизвестное не в последнем абзаце",
        phrase: statement.phrase,
        detail: "обрыв на неизвестном стоит последним абзацем",
      });
    }
  }

  return problems;
}

export const describeRegisterProblem = (problem: RegisterProblem): string =>
  `${problem.kind}: ${problem.detail} — «${problem.phrase.slice(0, 60)}»`;
