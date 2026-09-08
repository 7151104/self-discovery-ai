/**
 * Разметка компонентов: описание узла, сборка строки и монтирование в браузер.
 *
 * Компонент возвращает дерево `VNode`, а не строку и не элемент DOM. Из одного
 * дерева получаются обе формы: тесты читают строку без браузера, страница
 * монтирует настоящие элементы. Второй реализации разметки в проекте нет,
 * поэтому проверенное тестом и показанное человеку — одно и то же.
 *
 * Это весь «фреймворк» клиента: решение E6-01 — не тянуть чужой рантайм,
 * когда бюджет первой загрузки считается в килобайтах.
 */

export type AttrValue = string | number | boolean | null | undefined;
export type Handler = (event: Event) => void;

export interface Attrs {
  [name: string]: AttrValue | Handler;
}

export interface VNode {
  tag: string;
  attrs: Attrs;
  children: Child[];
}

export type Child = VNode | string | null | undefined | false;

const VOID_TAGS = new Set(["area", "br", "col", "hr", "img", "input", "link", "meta", "source"]);

export function h(tag: string, attrs: Attrs = {}, ...children: (Child | Child[])[]): VNode {
  return { tag, attrs, children: children.flat() };
}

export const isVNode = (value: Child): value is VNode =>
  typeof value === "object" && value !== null && typeof (value as VNode).tag === "string";

const isHandler = (name: string, value: unknown): value is Handler => name.startsWith("on") && typeof value === "function";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Разметка строкой. Обработчики в строку не попадают: их некуда сериализовать. */
export function renderToString(node: Child): string {
  if (node === null || node === undefined || node === false) return "";
  if (!isVNode(node)) return escapeHtml(node);

  const attrs = Object.entries(node.attrs)
    .filter(([name, value]) => !isHandler(name, value) && value !== null && value !== undefined && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`))
    .join("");

  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  const inner = node.children.map((child) => renderToString(child)).join("");
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/** Монтирование в живой документ. Единственное место, где клиент трогает DOM. */
export function mount(node: Child, parent: Element): void {
  if (node === null || node === undefined || node === false) return;
  if (!isVNode(node)) {
    parent.appendChild(document.createTextNode(node));
    return;
  }

  const element = document.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (isHandler(name, value)) {
      element.addEventListener(name.slice(2).toLowerCase(), value);
      continue;
    }
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of node.children) mount(child, element);
  parent.appendChild(element);
}

/** Текст, который человек прочитает: только текстовые узлы, без атрибутов. */
export function visibleText(node: Child): string {
  if (node === null || node === undefined || node === false) return "";
  if (!isVNode(node)) return node;
  return node.children.map((child) => visibleText(child)).join(" ");
}

export interface FoundAttribute {
  tag: string;
  name: string;
  value: string;
}

/** Все атрибуты дерева: по ним проверяется, что наружу не ушли машинные коды. */
export function collectAttributes(node: Child): FoundAttribute[] {
  if (node === null || node === undefined || node === false || !isVNode(node)) return [];
  const own = Object.entries(node.attrs)
    .filter(([name, value]) => !isHandler(name, value) && value !== null && value !== undefined && typeof value !== "boolean")
    .map(([name, value]) => ({ tag: node.tag, name, value: String(value) }));
  return [...own, ...node.children.flatMap((child) => collectAttributes(child))];
}

/** Все узлы дерева с заданным тегом. */
export function findAll(node: Child, tag: string): VNode[] {
  if (!isVNode(node)) return [];
  const own = node.tag === tag ? [node] : [];
  return [...own, ...node.children.flatMap((child) => findAll(child, tag))];
}
