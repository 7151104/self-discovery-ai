/**
 * Минимальный разбор CSS: правила, объявления, подстановка токенов и перевод
 * длины в пиксели.
 *
 * Нужен там, где приёмка требует числа: размер цели не меньше 44 px, карта в
 * 360×640, длительность маркера в 400–600 мс. Браузера в тестах нет, поэтому
 * значения берутся из стилей и токенов, а не из живого layout. Пиксельно точная
 * проверка — визуальные регрессии E11-04.
 */

export interface Declaration {
  property: string;
  value: string;
  line: number;
}

export interface Rule {
  selector: string;
  /** Внешние блоки: `@media (…)`, `@keyframes …`. Пусто — правило верхнего уровня. */
  at: string[];
  declarations: Declaration[];
}

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));

/** Разбор в плоский список правил. Вложенность at-правил сохраняется в `at`. */
export function parseCss(source: string): Rule[] {
  const text = stripComments(source);
  const rules: Rule[] = [];
  const stack: string[] = [];
  let buffer = "";
  let line = 1;
  let declarations: Declaration[] = [];

  const flush = (prelude: string) => {
    if (declarations.length === 0) return;
    const at = stack.slice(0, -1).filter((item) => item.startsWith("@"));
    rules.push({ selector: prelude, at, declarations });
    declarations = [];
  };

  const pushDeclaration = (raw: string, at: number) => {
    const colon = raw.indexOf(":");
    if (colon < 0) return;
    const property = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (property === "" || value === "") return;
    declarations.push({ property, value, line: at });
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "\n") line += 1;

    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
      declarations = [];
      continue;
    }

    if (char === "}") {
      pushDeclaration(buffer, line);
      buffer = "";
      const prelude = stack[stack.length - 1] ?? "";
      if (!prelude.startsWith("@")) flush(prelude);
      else declarations = [];
      stack.pop();
      continue;
    }

    if (char === ";") {
      pushDeclaration(buffer, line);
      buffer = "";
      continue;
    }

    buffer += char;
  }

  return rules;
}

/** Подстановка токенов: `var(--space-4)` → значение из реестра. */
export function resolveVars(value: string, tokens: Record<string, string>): string {
  let result = value;
  for (let depth = 0; depth < 8 && result.includes("var("); depth += 1) {
    result = result.replace(/var\(\s*--([\w-]+)\s*(?:,([^()]*))?\)/g, (_match, name: string, fallback?: string) => {
      const token = tokens[name];
      if (token !== undefined) return token;
      return (fallback ?? "").trim();
    });
  }
  return result;
}

/** Длина в пикселях. `rem` и `em` считаются от корневого размера. */
export function lengthPx(value: string, rootFontSizePx: number): number | null {
  const match = /^(-?[\d.]+)(px|rem|em)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "px" ? amount : amount * rootFontSizePx;
}

/** Длительность в миллисекундах. */
export function durationMs(value: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
}

export interface Lookup {
  rules: Rule[];
  tokens: Record<string, string>;
  rootFontSizePx: number;
}

/** Последнее объявление свойства у селектора — то, которое победит в каскаде. */
export function declared(lookup: Lookup, selector: string, property: string): string | null {
  let found: string | null = null;
  for (const rule of lookup.rules) {
    if (rule.at.length > 0) continue;
    const selectors = rule.selector.split(",").map((item) => item.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of rule.declarations) {
      if (declaration.property === property) found = declaration.value;
    }
  }
  return found === null ? null : resolveVars(found, lookup.tokens);
}

/** То же в пикселях. */
export function declaredPx(lookup: Lookup, selector: string, property: string): number | null {
  const value = declared(lookup, selector, property);
  return value === null ? null : lengthPx(value, lookup.rootFontSizePx);
}

/** Все объявления свойства у селектора, включая объявления внутри at-правил. */
export function allDeclarations(lookup: Lookup, selector: string): Declaration[] {
  const result: Declaration[] = [];
  for (const rule of lookup.rules) {
    const selectors = rule.selector.split(",").map((item) => item.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of rule.declarations) {
      result.push({ ...declaration, value: resolveVars(declaration.value, lookup.tokens) });
    }
  }
  return result;
}
