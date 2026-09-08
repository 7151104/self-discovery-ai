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
import { declared, declaredPx, parseCss, resolveVars, lengthPx, type Lookup, type Rule } from "./css.js";
import { isVNode, type Child, type VNode } from "./dom.js";
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

/** Классы узла списком. */
export const classesOf = (node: VNode): string[] => String(node.attrs["class"] ?? "").split(/\s+/).filter(Boolean);

export interface FoundElement {
  node: VNode;
  /** Классы предков, ближайший первым. */
  ancestors: string[][];
}

/** Обход дерева с сохранением цепочки предков. */
export function walk(node: Child, visit: (found: FoundElement) => void, ancestors: string[][] = []): void {
  if (!isVNode(node)) return;
  visit({ node, ancestors });
  const next = [classesOf(node), ...ancestors];
  for (const child of node.children) walk(child, visit, next);
}

/** Теги, которые человек нажимает или в которые он пишет. */
export const INTERACTIVE_TAGS = new Set(["button", "a", "summary", "textarea", "select", "input"]);

export interface Box {
  height: number | null;
  width: number | null;
  /** Ширина не ограничена явно: элемент растягивается по контейнеру. */
  wide: boolean;
}

/** Габариты класса по объявленным стилям. */
export function boxOf(lookup: Lookup, className: string): Box {
  const selector = `.${className}`;
  const height = declaredPx(lookup, selector, "min-height") ?? declaredPx(lookup, selector, "height");
  const minWidth = declaredPx(lookup, selector, "min-width");
  const width = declaredPx(lookup, selector, "width");
  const rawWidth = declared(lookup, selector, "width");
  const wide = width === null || rawWidth === "100%" || rawWidth === "auto";
  return { height, width: minWidth ?? width, wide };
}
export function lineHeightPx(fontSizeToken: string, leadingToken: string): number {
  const leading = TOKENS[leadingToken];
  if (leading === undefined) throw new Error(`нет токена --${leadingToken}`);
  return tokenPixels(fontSizeToken) * Number(leading);
}
