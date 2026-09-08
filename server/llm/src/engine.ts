/**
 * Единственная точка, где слой LLM видит движок.
 *
 * Тот же приём, что в `server/src/engine.ts`: движок — единственная реализация
 * правил, слой генерации ими не владеет. Файлы `engine/` слой не меняет.
 */

export * from "../../../engine/dist/index.js";
export { rawExtraContent } from "../../../engine/dist/generated/content-extra.js";

/**
 * `ForbiddenHit` в публичном перечне движка не назван, хотя `scanText` его
 * возвращает. Берём тип из модуля напрямую и `engine/` не правим; когда движок
 * добавит его в свой `index.ts`, эта строка уйдёт.
 */
export type { ForbiddenHit } from "../../../engine/dist/forbidden.js";
