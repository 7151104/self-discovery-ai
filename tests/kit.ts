/**
 * Собранные модули клиента для тестов качества.
 *
 * Тесты не импортируют `web/src` — иначе `rootDir` сборки тестов расползся бы
 * на клиент. Тот же приём, что у живых снимков: загрузка из `web/dist`.
 */

import { web } from "./load.js";
import type { Child, Rule, VNode } from "./visual/capture.js";

export interface Lookup {
  rules: Rule[];
  tokens: Record<string, string>;
  rootFontSizePx: number;
}

export interface Box {
  height: number | null;
  width: number | null;
  wide: boolean;
}

export interface Kit {
  h: (tag: string, attrs?: Record<string, unknown>, ...children: unknown[]) => VNode;
  visibleText: (node: Child) => string;
  findAll: (node: Child, tag: string) => VNode[];
  focusable: (node: Child) => VNode[];
  byClass: (node: Child, className: string) => VNode[];
  walk: (node: Child, visit: (found: { node: VNode; ancestors: string[][] }) => void) => void;
  boxOf: (lookup: Lookup, className: string) => Box;
  componentLookup: () => Lookup;
  INTERACTIVE_TAGS: Set<string>;
  tokenPixels: (name: string) => number;
  declaredPx: (lookup: Lookup, selector: string, property: string) => number | null;
  parseCss: (source: string) => Rule[];
  TOKENS: Record<string, string>;
  ROOT_FONT_SIZE_PX: number;
}

export async function loadKit(): Promise<Kit> {
  const [dom, support, css, tokens] = await Promise.all([
    web<Pick<Kit, "h" | "visibleText" | "findAll">>("src/dom.js"),
    web<Pick<Kit, "focusable" | "byClass" | "walk" | "boxOf" | "componentLookup" | "INTERACTIVE_TAGS" | "tokenPixels">>(
      "src/test-support.js",
    ),
    web<Pick<Kit, "declaredPx" | "parseCss">>("src/css.js"),
    web<Pick<Kit, "TOKENS" | "ROOT_FONT_SIZE_PX">>("tokens/tokens.js"),
  ]);
  return { ...dom, ...support, ...css, ...tokens };
}
