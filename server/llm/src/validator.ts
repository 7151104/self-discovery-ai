/**
 * Валидатор выхода модели (E4-04).
 *
 * Фактическое ТЗ — чеклист `docs/09-validation.md`. Часть его пунктов ловится
 * словами и проверяется здесь; часть на словах не выражается и остаётся человеку —
 * так и записано в `content/forbidden.md`, раздел «Что реестр не проверяет».
 *
 * Порядок важности задан задачей: валидатор, который режет хорошие тексты, будет
 * выключен при первом живом прогоне. Поэтому:
 *
 *   отклоняют — жёсткие запреты и запреты по контексту из реестра, названия
 *   методик, Barnum-шаблоны, объём не по типу отчёта и каркас финала лестницы;
 *
 *   предупреждают, но не отклоняют — группы степени `подозрение`, про которые
 *   реестр прямо говорит «различает человек»: формы с двойным чтением и вода.
 *   Их совпадение уходит в `warnings` и остаётся решением человека.
 *
 * Реестр запретов слой не повторяет: сканирует его `engine/src/forbidden.ts`,
 * формы живут в `content/forbidden.md`.
 */

import { negationWords, volumeOf, type ReportType } from "./content.js";
import { scanText, type ForbiddenHit } from "./engine.js";
import { normalize, paragraphs, wordCount } from "./text.js";

/** Машинный тип финала лестницы: единственный отчёт, каркас которого — три абзаца. */
export const LADDER_FINAL: ReportType = "финал_лестницы";

/** Правило, по которому текст отклонён или помечен. */
export type ValidationRule = "реестр" | "методика" | "Barnum" | "совет" | "объём" | "каркас" | "вода";

export interface Violation {
  rule: ValidationRule;
  /** Группа реестра, если нарушение пришло оттуда. */
  group: string | null;
  detail: string;
}

export interface TextCheckOptions {
  /** Машинный тип отчёта из `docs/06-report-structure.md`: от него объём и каркас. */
  type: ReportType;
  /**
   * Текст — фрагмент, а не готовый отчёт: объём и каркас не проверяются.
   * Так проверяются эталоны из `examples/` и lookup-тексты ступеней 1–3.
   */
  fragment?: boolean;
}

export interface TextVerdict {
  ok: boolean;
  /** Причины отказа. Пусто — текст принят. */
  violations: Violation[];
  /** Места для человека: реестр про них говорит «решает человек». */
  warnings: Violation[];
}

/**
 * Группа, которую валидатор поднимает из подозрения в ошибку. Barnum поднят по
 * прямому указанию `docs/04-alignment-rules.md`: анти-Barnum фильтр написан «для
 * LLM и редакторов», и формы для него собраны именно в этой группе. Линтер
 * контента её по-прежнему только показывает — там текст читает человек.
 */
const ESCALATED = new Set(["FORBIDDEN_BARNUM"]);

/**
 * Группы, чьё совпадение остаётся человеку: реестр про них прямо пишет «различает
 * человек». Поднимать их в ошибку нельзя — они ловят законные употребления
 * («тебе нужно» как описание нужды, «потенциал» как то, что видно раньше других).
 */
const ADVISORY = new Set(["FORBIDDEN_DOUBLE", "FORBIDDEN_VAGUE"]);

/**
 * Предложение вокруг первого вхождения формы. Нужно правилу отрицания: поднимая
 * группу в ошибку, валидатор обязан дать ей те же исключения, что есть у степени
 * `по контексту`, иначе он начинает ловить снятые ярлыки и сравнения с другими.
 */
function sentenceWith(text: string, match: string): string {
  const at = text.indexOf(match);
  if (at < 0) return text;
  const before = text.slice(0, at);
  const start = Math.max(...[".", "!", "?", ";", "\n"].map((mark) => before.lastIndexOf(mark))) + 1;
  const rest = text.slice(at);
  const end = at + (/[.!?;\n]/.exec(rest)?.index ?? rest.length);
  return text.slice(start, end);
}

function underNegation(text: string, match: string): boolean {
  const sentence = normalize(sentenceWith(text, match));
  return negationWords().some((word) => new RegExp(`(?<![\\p{L}\\p{N}_])${word}(?![\\p{L}\\p{N}_])`, "u").test(sentence));
}

function ruleOf(hit: ForbiddenHit): ValidationRule {
  if (hit.group === "FORBIDDEN_METHODS") return "методика";
  if (hit.group === "FORBIDDEN_BARNUM") return "Barnum";
  if (hit.group === "FORBIDDEN_ADVICE") return "совет";
  if (hit.group === "FORBIDDEN_VAGUE" || hit.group === "FORBIDDEN_DOUBLE") return "вода";
  return "реестр";
}

const violationOf = (hit: ForbiddenHit): Violation => ({
  rule: ruleOf(hit),
  group: hit.group,
  detail: `«${hit.match}» (${hit.form}): ${hit.reason}`,
});

/** Список действий вместо трёх абзацев: финал лестницы советов не даёт вовсе. */
const listLine = /^\s*(?:[-*•]|\d+[.)])\s+\S/m;

export function validateText(text: string, options: TextCheckOptions): TextVerdict {
  const violations: Violation[] = [];
  const warnings: Violation[] = [];

  for (const hit of scanText(text, "разбор")) violations.push(violationOf(hit));

  for (const group of [...ESCALATED, ...ADVISORY]) {
    for (const hit of scanText(text, "разбор", { degrees: ["подозрение"], group })) {
      const error = ESCALATED.has(group) && !underNegation(text, hit.match);
      (error ? violations : warnings).push(violationOf(hit));
    }
  }

  if (!options.fragment) {
    const volume = volumeOf(options.type);
    const count = wordCount(text);
    if (count < volume.min || count > volume.max) {
      violations.push({
        rule: "объём",
        group: null,
        detail: `слов ${count}, тип «${options.type}» требует ${volume.min}–${volume.max}`,
      });
    }

    if (options.type === LADDER_FINAL) {
      const parts = paragraphs(text);
      if (parts.length !== 3)
        violations.push({ rule: "каркас", group: null, detail: `абзацев ${parts.length}, требуется 3` });
      if (listLine.test(text))
        violations.push({ rule: "совет", group: null, detail: "список действий в финале лестницы" });
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}

export const describeViolation = (violation: Violation): string =>
  `${violation.rule}${violation.group ? ` · ${violation.group}` : ""}: ${violation.detail}`;
