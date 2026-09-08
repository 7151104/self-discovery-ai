/**
 * Снимок состояния страницы: дерево разметки плюс применённые значения токенов.
 *
 * Браузера в репозитории нет и ставить его нельзя (E6-01, `lint:budget`).
 * Снимок — не картинка, а детерминированная сериализация того, что клиент
 * реально собирает:
 *
 *   1. дерево узлов `VNode` — та же функция `renderPersonalPage`, что витрина
 *      и живой клиент монтируют в DOM;
 *   2. стили компонентов из `web/dist/app.css` с подставленными токенами
 *      и длинами, переведёнными в пиксели, на выбранной ширине.
 *
 * Почему это ловит правку отступа и цвета. В разметке нет литеральных
 * пикселей и цветов — только классы и `var(--space-3)`, `var(--color-text)`.
 * Если сериализовать только HTML, смена `--space-3` с 12 px на 16 px снимок
 * не сломает. Поэтому в раздел «стили» попадают уже разрешённые значения:
 * `padding: 12px`, `color: #14161a`. Правка токена меняет эти строки.
 * Ширина входит в снимок: на 360 px правило `min-width: 30rem` выключено,
 * на 1280 px поля страницы другие — два эталона не совпадают.
 *
 * Обновление эталона — отдельная команда `npm run snapshots:update`. Прогон
 * сверки файлы не трогает.
 */

import { mediaMatches, type Viewport } from "./viewport.js";

/** Узел разметки клиента. Совпадает с `web/src/dom.ts`, чтобы не импортировать `web/` в сборку тестов. */
export interface VNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: Child[];
}

export type Child = VNode | string | null | undefined | false;

export interface Rule {
  selector: string;
  at: string[];
  declarations: { property: string; value: string; line: number }[];
}

export interface CaptureContext {
  rules: Rule[];
  tokens: Record<string, string>;
  rootFontSizePx: number;
}

export interface SnapshotMeta {
  source: "витрина" | "живой";
  state: string;
  viewport: Viewport;
}

const VOID_TAGS = new Set(["area", "br", "col", "hr", "img", "input", "link", "meta", "source"]);

export const isVNode = (value: Child): value is VNode =>
  typeof value === "object" && value !== null && typeof (value as VNode).tag === "string";

/** Обход дерева с цепочкой предков: имена и цели считаются с учётом подписи-обёртки. */
export function walkTree(
  node: Child,
  visit: (node: VNode, ancestors: VNode[]) => void,
  ancestors: VNode[] = [],
): void {
  if (!isVNode(node)) return;
  visit(node, ancestors);
  for (const child of node.children) walkTree(child, visit, [...ancestors, node]);
}

const isHandler = (name: string, value: unknown): boolean => name.startsWith("on") && typeof value === "function";

/** Идентификатор профиля и токена шеринга: 22 символа base64url. */
const ID_VALUE = /^[A-Za-z0-9_-]{22}$/;

export function stabilize(value: string): string {
  if (ID_VALUE.test(value)) return "«id»";
  return value
    .replace(/\/p\/[A-Za-z0-9_-]{22}/g, "/p/«профиль»")
    .replace(/\/s\/[A-Za-z0-9_-]{22}/g, "/s/«токен»")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "«время»");
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attrEntries = (attrs: Record<string, unknown>): [string, string][] =>
  Object.entries(attrs)
    .filter(([name, value]) => !isHandler(name, value) && value !== null && value !== undefined && value !== false)
    .map(([name, value]) => [name, value === true ? "" : stabilize(String(value))] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right, "ru"));

/** Дерево разметки с устойчивым порядком атрибутов. Обработчики в снимок не входят. */
export function serializeTree(node: Child, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (node === null || node === undefined || node === false) return "";
  if (!isVNode(node)) {
    const text = stabilize(node).replace(/\s+/g, " ").trim();
    return text === "" ? "" : `${pad}${escapeHtml(text)}\n`;
  }

  const attrs = attrEntries(node.attrs)
    .map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join("");

  if (VOID_TAGS.has(node.tag)) return `${pad}<${node.tag}${attrs}>\n`;

  const children = node.children.map((child) => serializeTree(child, indent + 1)).join("");
  if (children === "") return `${pad}<${node.tag}${attrs}></${node.tag}>\n`;
  return `${pad}<${node.tag}${attrs}>\n${children}${pad}</${node.tag}>\n`;
}

/** Подстановка токенов и перевод `rem`/`em` в пиксели. `ch` и `%` остаются как есть. */
export function canonicalize(value: string, tokens: Record<string, string>, rootFontSizePx: number): string {
  let result = value;
  for (let depth = 0; depth < 8 && result.includes("var("); depth += 1) {
    result = result.replace(/var\(\s*--([\w-]+)\s*(?:,([^()]*))?\)/g, (_match, name: string, fallback?: string) => {
      const token = tokens[name];
      if (token !== undefined) return token;
      return (fallback ?? "").trim();
    });
  }
  result = result.replace(/(-?[\d.]+)(rem|em)\b/g, (_match, amount: string) => `${Number(amount) * rootFontSizePx}px`);
  return result.replace(/\s+/g, " ").trim();
}

const classesOf = (node: VNode): string[] => String(node.attrs["class"] ?? "").split(/\s+/).filter(Boolean);

function collectMarks(node: Child, classes: Set<string>, tags: Set<string>): void {
  if (!isVNode(node)) return;
  tags.add(node.tag);
  for (const name of classesOf(node)) classes.add(name);
  for (const child of node.children) collectMarks(child, classes, tags);
}

const selectorClasses = (selector: string): string[] =>
  [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1] as string);

const leadingTag = (selector: string): string | null => {
  const match = /^([a-z][a-z0-9]*)/i.exec(selector.trim());
  return match?.[1]?.toLowerCase() ?? null;
};

/**
 * Правило относится к этому дереву, если все классы селектора на странице
 * есть. Состояние в селекторе (`[data-state=selected]`) не требуется:
 * иначе смена цвета выбранного варианта не ломала бы снимок покоя.
 * Глобальные `html`, `body`, `:focus-visible` входят всегда.
 */
export function ruleApplies(selector: string, classes: Set<string>, tags: Set<string>): boolean {
  const parts = selector.split(",").map((item) => item.trim()).filter(Boolean);
  return parts.some((part) => {
    if (/^:focus-visible\b/.test(part) || part === ":root") return true;
    const found = selectorClasses(part);
    if (found.length > 0) return found.every((name) => classes.has(name));
    const tag = leadingTag(part.replace(/::?[a-z-]+(\([^)]*\))?/gi, "").replace(/\[.*?\]/g, "").trim());
    if (tag === "html" || tag === "body") return true;
    if (tag) return tags.has(tag);
    return false;
  });
}

function appliedStyles(node: Child, viewportPx: number, ctx: CaptureContext): string {
  const classes = new Set<string>();
  const tags = new Set<string>();
  collectMarks(node, classes, tags);

  const bySelector = new Map<string, Map<string, string>>();

  for (const rule of ctx.rules) {
    if (rule.at.some((item) => item.startsWith("@keyframes"))) continue;
    if (rule.at.some((item) => !mediaMatches(item, viewportPx))) continue;
    if (!ruleApplies(rule.selector, classes, tags)) continue;

    let bucket = bySelector.get(rule.selector);
    if (bucket === undefined) {
      bucket = new Map();
      bySelector.set(rule.selector, bucket);
    }
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith("--")) continue;
      bucket.set(declaration.property, canonicalize(declaration.value, ctx.tokens, ctx.rootFontSizePx));
    }
  }

  const selectors = [...bySelector.keys()].sort((left, right) => left.localeCompare(right));
  const blocks: string[] = [];
  for (const selector of selectors) {
    const props = bySelector.get(selector);
    if (props === undefined || props.size === 0) continue;
    const lines = [...props.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([property, value]) => `  ${property}: ${value};`);
    blocks.push(`${selector} {\n${lines.join("\n")}\n}`);
  }
  return blocks.join("\n\n");
}

function tokenDump(tokens: Record<string, string>, rootFontSizePx: number): string {
  return Object.keys(tokens)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `--${name}: ${canonicalize(tokens[name] ?? "", tokens, rootFontSizePx)};`)
    .join("\n");
}

/** Полный текст снимка. Разделители разделов устойчивы: по ним удобно смотреть diff. */
export function capture(node: Child, meta: SnapshotMeta, ctx: CaptureContext): string {
  const tree = serializeTree(node).trimEnd();
  const styles = appliedStyles(node, meta.viewport.px, ctx);
  const tokens = tokenDump(ctx.tokens, ctx.rootFontSizePx);
  return [
    "снимок v1",
    `источник: ${meta.source}`,
    `состояние: ${meta.state}`,
    `ширина: ${meta.viewport.id}`,
    `окно: ${meta.viewport.px}`,
    "",
    "--- дерево ---",
    tree,
    "",
    "--- стили ---",
    styles,
    "",
    "--- токены ---",
    tokens,
    "",
  ].join("\n");
}

export function snapshotName(source: "showcase" | "live", state: string, viewport: ViewportIdOfMeta): string {
  return `${source}-${state}-${viewport}.txt`;
}

type ViewportIdOfMeta = SnapshotMeta["viewport"]["id"];
