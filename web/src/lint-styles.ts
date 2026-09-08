/**
 * Линтер стилей. Одна мысль: в CSS компонентов не бывает значений «на глаз».
 *
 * Литеральный цвет, литеральный пиксель, размер шрифта вне шкалы, отступ вне
 * шкалы, длительность вне шкалы и ссылка на несуществующий токен — каждая из
 * этих шести вещей роняет линтер. Линтер входит в `npm test`, поэтому «падает»
 * значит «ломает сборку», а не «пишет предупреждение».
 *
 * Приёмка E6-02, E6-03, E6-04.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { TOKENS } from "../tokens/tokens.js";
import { parseCss, type Declaration } from "./css.js";
import { repoRoot, webRoot } from "./paths.js";

export interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

/** Идентификаторы правил. Тест на фикстуре требует, чтобы сработало каждое. */
export const RULES = [
  "literal-color",
  "raw-length",
  "font-size-scale",
  "spacing-scale",
  "duration-scale",
  "unknown-token",
] as const;

export type RuleId = (typeof RULES)[number];

const NAMED_COLORS = new Set([
  "white", "black", "red", "green", "blue", "gray", "grey", "silver", "navy", "teal",
  "orange", "yellow", "purple", "pink", "brown", "gold", "beige", "ivory", "lime", "aqua",
]);

const SPACING_PROPERTIES = new Set([
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-inline", "margin-block-start", "margin-block-end",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-inline",
  "gap", "row-gap", "column-gap",
]);

const TIME_PROPERTIES = new Set([
  "transition", "transition-duration", "transition-delay",
  "animation", "animation-duration", "animation-delay",
]);

/** Значения, разрешённые в отступах помимо шкалы. */
const SPACING_KEYWORDS = new Set(["0", "auto", "inherit", "initial", "unset", "revert"]);

const FONT_SIZE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert"]);

const localCustomProperties = (declarations: Declaration[]): Set<string> =>
  new Set(declarations.filter((item) => item.property.startsWith("--")).map((item) => item.property.slice(2)));

const usedTokens = (value: string): string[] =>
  [...value.matchAll(/var\(\s*--([\w-]+)/g)].map((match) => match[1] as string);

const withoutStrings = (value: string): string => value.replace(/"[^"]*"|'[^']*'/g, "");

/** Проверка одного файла стилей. */
export function lintCss(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const rules = parseCss(source);
  const declarations = rules.flatMap((rule) => rule.declarations);
  const locals = localCustomProperties(declarations);

  const report = (line: number, rule: RuleId, message: string) => violations.push({ file, line, rule, message });

  for (const declaration of declarations) {
    const property = declaration.property.toLowerCase();
    if (property === "content") continue;
    const value = withoutStrings(declaration.value);
    const lower = value.toLowerCase();

    if (/#[0-9a-f]{3,8}\b/i.test(value) || /\b(rgba?|hsla?|color-mix|oklch)\s*\(/i.test(value)) {
      report(declaration.line, "literal-color", `литеральный цвет в «${property}: ${declaration.value}» — только var(--color-…)`);
    } else if (/color|background|border|outline|fill|stroke|shadow/.test(property)) {
      for (const word of lower.split(/[\s,()/]+/)) {
        if (NAMED_COLORS.has(word)) {
          report(declaration.line, "literal-color", `цвет по имени «${word}» в «${property}» — только var(--color-…)`);
        }
      }
    }

    if (/(^|[\s(,:])-?[\d.]+px\b/.test(value)) {
      report(declaration.line, "raw-length", `пиксели мимо шкалы в «${property}: ${declaration.value}» — значение берётся токеном`);
    }

    if (property === "font" ) {
      report(declaration.line, "font-size-scale", "сокращённое «font» прячет размер мимо шкалы — свойства пишутся по отдельности");
    }

    if (property === "font-size" && !FONT_SIZE_KEYWORDS.has(lower)) {
      const tokens = usedTokens(value);
      if (tokens.length !== 1 || !tokens[0]?.startsWith("text-")) {
        report(declaration.line, "font-size-scale", `размер шрифта «${declaration.value}» вне шкалы — только var(--text-…)`);
      }
    }

    if (property === "font-weight" && !FONT_SIZE_KEYWORDS.has(lower)) {
      const tokens = usedTokens(value);
      if (tokens.length !== 1 || !tokens[0]?.startsWith("weight-")) {
        report(declaration.line, "font-size-scale", `начертание «${declaration.value}» вне шкалы — только var(--weight-…)`);
      }
    }

    if (property === "line-height" && !FONT_SIZE_KEYWORDS.has(lower)) {
      const tokens = usedTokens(value);
      if (tokens.length !== 1 || !tokens[0]?.startsWith("leading-")) {
        report(declaration.line, "font-size-scale", `межстрочное «${declaration.value}» вне шкалы — только var(--leading-…)`);
      }
    }

    if (SPACING_PROPERTIES.has(property)) {
      for (const part of value.split(/\s+/).filter(Boolean)) {
        if (SPACING_KEYWORDS.has(part) || part.endsWith("%")) continue;
        const tokens = usedTokens(part);
        if (tokens.length === 1 && (tokens[0]?.startsWith("space-") || tokens[0]?.startsWith("size-"))) continue;
        report(declaration.line, "spacing-scale", `отступ «${part}» вне шкалы — только var(--space-…)`);
      }
    }

    if (property === "border-radius") {
      const tokens = usedTokens(value);
      if (!(lower === "0" || lower === "50%") && (tokens.length === 0 || !tokens.every((name) => name.startsWith("radius-")))) {
        report(declaration.line, "spacing-scale", `радиус «${declaration.value}» вне шкалы — только var(--radius-…)`);
      }
    }

    if (property === "box-shadow" && lower !== "none") {
      const tokens = usedTokens(value);
      if (tokens.length !== 1 || !tokens[0]?.startsWith("shadow-")) {
        report(declaration.line, "spacing-scale", `тень «${declaration.value}» вне шкалы — только var(--shadow-…)`);
      }
    }

    if (TIME_PROPERTIES.has(property) && /(^|[\s(,])-?[\d.]+m?s\b/.test(value)) {
      report(declaration.line, "duration-scale", `длительность «${declaration.value}» вне шкалы — только var(--duration-…)`);
    }

    for (const name of usedTokens(value)) {
      if (TOKENS[name] === undefined && !locals.has(name)) {
        report(declaration.line, "unknown-token", `токена --${name} нет в web/tokens/tokens.ts`);
      }
    }
  }

  return violations;
}

const listCss = (directory: string): string[] => {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) entries.push(...listCss(path));
    else if (name.endsWith(".css")) entries.push(path);
  }
  return entries;
};

/**
 * Все стили клиента, кроме собранных и кроме фикстур с намеренными нарушениями.
 * `web/dist/tokens.css` не проверяется: он и есть шкала.
 */
export function styleFiles(): string[] {
  return [join(webRoot, "components"), join(webRoot, "showcase")]
    .flatMap((directory) => listCss(directory))
    .sort();
}

export function lintProject(): Violation[] {
  return styleFiles().flatMap((path) => lintCss(relative(repoRoot, path), readFileSync(path, "utf8")));
}

/** Запуск из командной строки: `npm run lint:styles`. */
if (process.argv[1] !== undefined && process.argv[1].endsWith("lint-styles.js")) {
  const found = lintProject();
  for (const violation of found) {
    console.error(`${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
  }
  console.error(found.length === 0 ? "Стили чисты." : `Нарушений: ${found.length}`);
  process.exit(found.length === 0 ? 0 : 1);
}
