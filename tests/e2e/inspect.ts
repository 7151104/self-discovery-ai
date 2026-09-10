/**
 * Разбор дерева живой страницы для сквозных проверок.
 *
 * Числа и порядок читаются с того же дерева, которое монтирует клиент,
 * а не из DTO: иначе проверка прошла бы мимо отрисовки.
 */

import type { Child, VNode } from "../visual/capture.js";
import type { Kit } from "../kit.js";

const isNode = (value: Child): value is VNode =>
  typeof value === "object" && value !== null && typeof (value as VNode).tag === "string";

const classesOf = (node: VNode): string[] => String(node.attrs["class"] ?? "").split(/\s+/).filter(Boolean);

export function pageNode(tree: Child, kit: Kit): VNode {
  const page = kit.byClass(tree, "page")[0];
  if (!page) throw new Error("на дереве нет .page");
  return page;
}

/** Заполненные полосы карты: `data-fill` не `empty`. */
export function filledBarCount(tree: Child, kit: Kit): number {
  return kit.byClass(tree, "bar").filter((node) => node.attrs["data-fill"] !== "empty").length;
}

export function mapBarCount(tree: Child, kit: Kit): number {
  return kit.byClass(tree, "bar").length;
}

/** Идентификаторы блоков разбора в порядке дерева. */
export function blockOrder(tree: Child, kit: Kit): string[] {
  return kit.byClass(tree, "block").map((node) => String(node.attrs["data-block"]));
}

function slotOf(node: VNode): string | null {
  const classes = classesOf(node);
  if (classes.includes("head")) return "head";
  if (classes.includes("hook")) return "hook";
  if (classes.includes("map")) return "map";
  if (classes.includes("block")) return "block";
  if (classes.includes("wait")) return "wait";
  if (classes.includes("portion")) return "portion";
  if (classes.includes("offer")) return "offer";
  if (classes.includes("route")) return "route";
  return null;
}

function isWrapper(node: VNode): boolean {
  const classes = classesOf(node);
  return classes.includes("page__portrait") || classes.includes("reading");
}

function collectSlots(nodes: Child[], slots: string[]): void {
  for (const child of nodes) {
    if (!isNode(child)) continue;
    if (isWrapper(child)) {
      collectSlots(child.children, slots);
      continue;
    }
    const kind = slotOf(child);
    if (kind) slots.push(kind);
  }
}

/** Слоты экрана в визуальном порядке. Обёртки портрета и чтения прозрачны. */
export function screenSlots(tree: Child, kit: Kit): string[] {
  const slots: string[] = [];
  collectSlots(pageNode(tree, kit).children, slots);
  return slots;
}

/**
 * Ожидаемый порядок слотов на конкретном состоянии.
 *
 * На `s0` работа — вопрос: порция (или пауза «собираю») сразу под шапкой,
 * пустые крючок и карта ниже. С `s1` экран совпадает со схемой в `docs/11`:
 * крючок, карта, блоки, порция или предложение, маршрут. Крючок всегда на
 * месте: на `s0` это зарезервированная фраза, после первой порции — настоящий.
 * Ступень 4 в ожидании занимает место блока слотом `wait`, а не `.block`.
 * После готового сюжета порцию сменяет предложение.
 */
export function expectedSlots(input: {
  blocks: string[];
  waiting: boolean;
  offer: boolean;
  portion: boolean;
  emptyCabinet?: boolean;
}): string[] {
  if (input.emptyCabinet === true) {
    const slots: string[] = ["head"];
    if (input.portion) slots.push("portion");
    else if (input.waiting) slots.push("wait");
    slots.push("hook", "map");
    for (const id of input.blocks) {
      slots.push(input.waiting && id === "step4" ? "wait" : "block");
    }
    slots.push("route");
    return slots;
  }
  const slots: string[] = ["head", "hook", "map"];
  for (const id of input.blocks) {
    slots.push(input.waiting && id === "step4" ? "wait" : "block");
  }
  if (input.waiting && !input.blocks.includes("step4")) slots.push("wait");
  if (input.portion) slots.push("portion");
  else if (input.offer && !input.waiting) slots.push("offer");
  slots.push("route");
  return slots;
}
