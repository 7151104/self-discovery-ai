/**
 * Состояния страницы, которые снимаем и проверяем на доступность.
 *
 * Состав сверяется с таблицей «Состояния страницы» в `docs/11-ui-page-spec.md`.
 * Краевые и ожидание сборки в этот набор не входят: это не отдельные состояния
 * страницы (решение E6-12).
 *
 * Числа заполненных полос и накопленный состав блоков читаются из той же
 * таблицы, а не копируются в тест: правка спецификации без кода и правка кода
 * без спецификации обе роняют сквозную проверку.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.js";

export const PAGE_STATES = ["s0", "s1", "s2", "s3", "s4", "paid_pending", "paid_done"] as const;

export type PageStateId = (typeof PAGE_STATES)[number];

export const SHOWCASE_KEYS = {
  s0: "s0",
  s1: "s1",
  s2: "s2",
  s3: "s3",
  s4: "s4",
  paid_pending: "paidPending",
  paid_done: "paidDone",
} as const;

/** Текст UI-сценария. Один источник правды для снимков, a11y и сквозного пути. */
export const uiSpecDoc = (): string => readFileSync(join(repoRoot, "docs", "11-ui-page-spec.md"), "utf8");

/** Строки таблицы сразу под заголовком, без шапки. */
export function specTable(doc: string, heading: string): string[][] {
  const start = doc.indexOf(heading);
  if (start < 0) throw new Error(`в docs/11-ui-page-spec.md нет раздела «${heading}»`);
  const rest = doc.slice(start);
  const next = rest.slice(heading.length).search(/\n## /);
  const body = next === -1 ? rest : rest.slice(0, heading.length + next);
  return body
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("---"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .slice(1);
}

/** Машинные имена состояний страницы: `s0` … `paid_done`. */
export const specPageStates = (doc: string = uiSpecDoc()): string[] =>
  specTable(doc, "## Состояния страницы").map((row) => (row[0] ?? "").replace(/`/g, ""));

/**
 * Сколько полос карты заполнены в каждом состоянии.
 *
 * Число берётся из колонки «Что на экране». «Пустая карта» — ноль. Если
 * состояние число не называет (ступени 4 и платные), наследуется последнее
 * известное: сюжет в семь полос не входит.
 */
export function specFilledBars(doc: string = uiSpecDoc()): Record<string, number> {
  const counts: Record<string, number> = {};
  let last = 0;
  for (const row of specTable(doc, "## Состояния страницы")) {
    const id = (row[0] ?? "").replace(/`/g, "");
    const screen = row[1] ?? "";
    if (/пуст(ая|ую)\s+карт/.test(screen)) last = 0;
    else {
      const match = screen.match(/(\d+)\s+полос/);
      if (match?.[1] !== undefined) last = Number(match[1]);
    }
    counts[id] = last;
  }
  return counts;
}

/**
 * Накопленный состав блоков разбора по состояниям.
 *
 * `+ блок N` из таблицы добавляет `stepN`. Платный «блок среза» в бесплатный
 * путь не входит — его идентификатор из таблицы не восстановить.
 */
export function specLadderBlocks(doc: string = uiSpecDoc()): Record<string, string[]> {
  const byState: Record<string, string[]> = {};
  const ids: string[] = [];
  for (const row of specTable(doc, "## Состояния страницы")) {
    const state = (row[0] ?? "").replace(/`/g, "");
    const screen = row[1] ?? "";
    const match = screen.match(/\+\s*блок\s+(\d+)/);
    if (match?.[1] !== undefined) ids.push(`step${match[1]}`);
    byState[state] = [...ids];
  }
  return byState;
}

/**
 * Порядок слотов экрана из схемы «Главный принцип экрана».
 *
 * Повторяющиеся блоки остаются повторяющимися: схема рисует четыре блока
 * подряд, и сквозной тест сверяет ту же последовательность на живой странице.
 */
export function specScreenSlots(doc: string = uiSpecDoc()): string[] {
  const start = doc.indexOf("## Главный принцип экрана");
  if (start < 0) throw new Error("в docs/11-ui-page-spec.md нет раздела «Главный принцип экрана»");
  const rest = doc.slice(start);
  const next = rest.search(/\n## /);
  const body = next === -1 ? rest : rest.slice(0, next);
  const slots: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.includes("│")) continue;
    if (/Шапка/.test(line)) slots.push("head");
    else if (/Фраза-крючок|крючок/.test(line)) slots.push("hook");
    else if (/Визуальная карта/.test(line)) slots.push("map");
    else if (/Блок /.test(line)) slots.push("block");
    else if (/Активная порция/.test(line)) slots.push("portion");
    else if (/Маршрут/.test(line)) slots.push("route");
  }
  if (slots[0] !== "head" || slots.at(-1) !== "route") {
    throw new Error(`схема экрана разобралась как [${slots.join(", ")}]`);
  }
  return slots;
}

/** Сколько полос на карте всего — из той же схемы, не из кода карты. */
export function specMapBarCount(doc: string = uiSpecDoc()): number {
  const match = doc.match(/Визуальная карта,\s*(\d+)\s+полос/);
  if (match?.[1] === undefined) throw new Error("в схеме экрана нет числа полос карты");
  return Number(match[1]);
}
