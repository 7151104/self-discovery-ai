/**
 * Изоляция пользовательского текста от инструкции (E4-09).
 *
 * Открытый ответ — единственное место, где человек пишет в задание модели
 * свободным текстом. Правило слоя: пользовательский текст никогда не склеивается
 * с инструкцией, а лежит в конверте с одноразовой границей, и инструкция говорит
 * о нём как о данных.
 *
 * Три уровня защиты, потому что одного не хватает:
 *   1. конверт с непредсказуемой границей — угадать её в тексте ответа нельзя;
 *   2. экранирование самого текста — границу, тройные кавычки и служебные
 *      символы внутри ответа обезвредить, иначе конверт закрывается досрочно;
 *   3. проверка выхода — признаки перехвата в ответе модели (`detectHijack`),
 *      поверх обязательного машинного конверта и валидатора.
 */

import { randomBytes } from "node:crypto";

/** Граница конверта. Шестнадцать знаков случайности: подобрать её текстом нельзя. */
export const newNonce = (): string => randomBytes(8).toString("hex");

const openTag = (nonce: string): string => `<<<ДАННЫЕ:${nonce}`;
const closeTag = (nonce: string): string => `ДАННЫЕ:${nonce}>>>`;

/**
 * Обезвреживание текста внутри конверта.
 *
 * Управляющие символы убираются: ими рисуют мнимый конец блока. Тройные кавычки
 * и угловые скобки границы разбиваются пробелом — форма ломается, смысл фразы
 * человека остаётся, а он его и писал.
 */
export function escapeUserText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
    .replace(/`{3,}/g, (run) => run.split("").join(" "))
    .replace(/<{3,}/g, (run) => run.split("").join(" "))
    .replace(/>{3,}/g, (run) => run.split("").join(" "))
    .replace(/\r\n?/g, "\n")
    .trim();
}

export interface Envelope {
  nonce: string;
  /** Текст конверта целиком: граница, экранированный текст, граница. */
  text: string;
  /** Что попало внутрь конверта после экранирования. */
  escaped: string;
}

/**
 * Конверт с пользовательским текстом. Заголовок конверта — часть данных, а не
 * инструкции: инструкцию слой собирает отдельно и не смешивает.
 */
export function wrapUserText(text: string, nonce: string = newNonce()): Envelope {
  const escaped = escapeUserText(text);
  return { nonce, escaped, text: `${openTag(nonce)}\n${escaped}\n${closeTag(nonce)}` };
}

/**
 * Формы, которыми переписывают задание. Список машинный: это не продуктовый
 * текст, а признаки перехвата, и он проверяется в ответе модели, а не в тексте
 * человека — запрещать человеку слова нельзя, он пишет о своей жизни.
 */
const OVERRIDE_MARKERS = [
  "игнорируй",
  "забудь инструкц",
  "предыдущие инструкц",
  "новая инструкц",
  "новые инструкц",
  "системная инструкц",
  "ignore previous",
  "ignore all previous",
  "disregard the above",
  "system prompt",
  "you are now",
];

/** Признак перехвата в ответе модели. */
export interface HijackSign {
  /** Машинный вид признака. */
  kind: "граница конверта" | "переписанная инструкция" | "чужой объём цитаты";
  detail: string;
}

export interface HijackCheck {
  nonce: string;
  /** Открытый ответ как его написал человек: нужен для проверки объёма цитаты. */
  openAnswer: string;
  /**
   * Сколько слов подряд из ответа человека допустимо перенести в текст.
   * Инструкция требует дословной фразы, поэтому цитата законна — незаконен
   * пересказ ответа целиком вместо разбора.
   */
  maxQuotedWords?: number;
}

const fold = (text: string): string => text.toLowerCase().replace(/ё/g, "е");

const words = (text: string): string[] => fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Самая длинная общая цепочка слов двух текстов. */
function longestSharedRun(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  let best = 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1]! + 1;
        if (current[j]! > best) best = current[j]!;
      }
    }
    previous = current;
  }
  return best;
}

/**
 * Признаки перехвата в сгенерированном тексте.
 *
 * Проверка не заменяет ни машинный конверт, ни валидатор: инъекция, которая
 * ломает форму выхода, отклоняется разбором конверта, а инъекция, которая меняет
 * тон, — реестром запретов. Здесь ловится то, что обе проверки пропустили бы:
 * утёкшая граница, переписанная инструкция и ответ человека вместо разбора.
 */
export function detectHijack(text: string, check: HijackCheck): HijackSign[] {
  const signs: HijackSign[] = [];
  const folded = fold(text);

  if (text.includes(check.nonce) || /<{3}|>{3}|данные:\s*[0-9a-f]{4}/i.test(text))
    signs.push({ kind: "граница конверта", detail: "в выходе видна граница конверта" });

  for (const marker of OVERRIDE_MARKERS) {
    if (folded.includes(fold(marker))) signs.push({ kind: "переписанная инструкция", detail: marker });
  }

  const limit = check.maxQuotedWords ?? 30;
  const shared = longestSharedRun(words(text), words(check.openAnswer));
  if (shared > limit)
    signs.push({ kind: "чужой объём цитаты", detail: `подряд перенесено слов: ${shared}, предел ${limit}` });

  return signs;
}
