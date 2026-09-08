/**
 * Добор полной карты (`content/slices/full-map.md`).
 *
 * Файл среза задаёт только порядок: вопросы приходят из полного банка по
 * идентификатору. Здесь — доступ к этому порядку и вычитание того, на что ответ уже
 * есть: вопрос, заданный на лестнице или в прошлой порции, второй раз не задаётся
 * (Закон 2). Арифметика профиля живёт в `scoring.ts` и сюда не переезжает.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import type {
  RawFullMap,
  RawFullMapInterlude,
  RawFullMapPortion,
  RawFullMapQuestion,
} from "./content-extra-types.js";

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
