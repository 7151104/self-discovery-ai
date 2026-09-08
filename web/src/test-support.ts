/**
 * Опора тестов клиента: чтение стилей и вычисления по ним.
 *
 * Браузера в тестах нет, поэтому размеры считаются из объявленных стилей и
 * токенов. Это ловит всё, что задаётся значениями — цель меньше 44 px, полосу
 * вне экрана, длительность вне шкалы. Чего это не ловит — переносы, реальные
 * метрики шрифта и наложения; на них есть визуальные регрессии E11-04.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_FONT_SIZE_PX, TOKENS } from "../tokens/tokens.js";
import { parseCss, resolveVars, lengthPx, type Lookup, type Rule } from "./css.js";
import { webRoot } from "./paths.js";

const read = (directory: string, name: string): string => readFileSync(join(webRoot, directory, name), "utf8");

export const componentFiles = (): string[] =>
  readdirSync(join(webRoot, "components"))
    .filter((name) => name.endsWith(".css"))
    .sort();

export const componentCss = (name: string): string => read("components", name);

/** Все стили компонентов одним разбором: так же, как их видит браузер. */
export function componentLookup(): Lookup {
  const rules: Rule[] = componentFiles().flatMap((name) => parseCss(componentCss(name)));
  return { rules, tokens: TOKENS, rootFontSizePx: ROOT_FONT_SIZE_PX };
}

export const resolve = (value: string): string => resolveVars(value, TOKENS);

export const toPx = (value: string): number | null => lengthPx(resolve(value), ROOT_FONT_SIZE_PX);

/** Значение токена в пикселях. Бросает, если токена нет: тест должен падать. */
export function tokenPixels(name: string): number {
  const value = TOKENS[name];
  if (value === undefined) throw new Error(`нет токена --${name}`);
  const size = lengthPx(value, ROOT_FONT_SIZE_PX);
  if (size === null) throw new Error(`токен --${name} не длина: ${value}`);
  return size;
}

/** Высота строки текста: размер шрифта на межстрочное. */
export function lineHeightPx(fontSizeToken: string, leadingToken: string): number {
  const leading = TOKENS[leadingToken];
  if (leading === undefined) throw new Error(`нет токена --${leadingToken}`);
  return tokenPixels(fontSizeToken) * Number(leading);
}
