/**
 * Поиск запрещённых формулировок по реестру `content/forbidden.md`.
 *
 * Русских строк здесь нет: все формы, исключения и обоснования приходят из
 * контента. Код отвечает только за то, как форма сопоставляется с текстом.
 *
 * Три степени запрета читаются так:
 *   жёсткий      — совпадение всегда ошибка;
 *   по контексту — совпадение проверяется по исключениям своей строки и по общему
 *                  списку формулировок-исключений;
 *   подозрение   — совпадение возвращается, но ошибкой не является: решает человек.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import { findForm, fold, patternFor, sentenceAround } from "./forms.js";
import type { ForbiddenDegree, ForbiddenScope } from "./content-extra-types.js";

export type { ForbiddenDegree, ForbiddenScope } from "./content-extra-types.js";

export interface ForbiddenHit {
  /** Идентификатор группы реестра, например `FORBIDDEN_METHODS`. */
  group: string;
  degree: ForbiddenDegree;
  /** Форма из реестра, которая совпала. */
  form: string;
  /** Совпавший фрагмент текста как он написан. */
  match: string;
  reason: string;
}

/** Особое значение в колонке исключений: совпадение законно под отрицанием. */
const NEGATION_EXCEPTION = "отрицание";

const NEGATIONS = ["не", "ни", "нет", "без", "ничего"];

/**
 * Отрицание ищется во всём предложении, а не только слева от совпадения:
 * «предсказаний здесь нет» отрицает после, «не является диагнозом» — до.
 */
function underNegation(sentence: string): boolean {
  const folded = fold(sentence);
  return NEGATIONS.some((word) => findForm(folded, word).length > 0);
}

function excused(text: string, index: number, exceptions: string[]): boolean {
  const { sentence, offset } = sentenceAround(text, index);
  const folded = fold(sentence);
  for (const exception of exceptions) {
    if (exception === NEGATION_EXCEPTION) {
      if (underNegation(sentence)) return true;
      continue;
    }
    const pattern = patternFor(exception);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(folded)) !== null) {
      if (offset >= match.index && offset < match.index + match[0].length) return true;
    }
  }
  return false;
}

export interface ScanOptions {
  /** Какие степени интересуют. По умолчанию — те, что означают ошибку. */
  degrees?: ForbiddenDegree[];
  /** Проверять только эту группу реестра. */
  group?: string;
}

const DEFAULT_DEGREES: ForbiddenDegree[] = ["жёсткий", "по контексту"];

/** Все совпадения реестра в одном тексте для заданной области. */
export function scanText(text: string, scope: ForbiddenScope, options: ScanOptions = {}): ForbiddenHit[] {
  const degrees = options.degrees ?? DEFAULT_DEGREES;
  const folded = fold(text);
  const hits: ForbiddenHit[] = [];

  for (const group of rawExtraContent.forbidden.groups) {
    if (options.group && group.id !== options.group) continue;
    if (!group.scopes.includes(scope)) continue;
    if (!degrees.includes(group.degree)) continue;

    const soft = group.degree !== "жёсткий";
    for (const entry of group.entries) {
      const exceptions = soft ? [...entry.exceptions, ...rawExtraContent.forbidden.allowed] : [];
      for (const form of entry.forms) {
        const pattern = patternFor(form);
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(folded)) !== null) {
          if (exceptions.length && excused(text, match.index, exceptions)) continue;
          hits.push({
            group: group.id,
            degree: group.degree,
            form,
            match: text.slice(match.index, match.index + match[0].length),
            reason: entry.reason,
          });
        }
      }
    }
  }
  return hits;
}

/** То же по набору текстов: возвращает первое совпадение на текст. */
export function scanTexts(
  texts: string[],
  scope: ForbiddenScope,
  options: ScanOptions = {},
): { text: string; hit: ForbiddenHit }[] {
  const found: { text: string; hit: ForbiddenHit }[] = [];
  for (const text of texts) {
    const [hit] = scanText(text, scope, options);
    if (hit) found.push({ text, hit });
  }
  return found;
}

/** Человекочитаемая строка для сообщения теста или линтера. */
export const describeHit = (text: string, hit: ForbiddenHit): string =>
  `${hit.group} · ${hit.degree} · «${hit.match}» (${hit.form}) в: ${text.slice(0, 80)}`;
