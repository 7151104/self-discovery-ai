/**
 * Таблицы `docs/11-ui-page-spec.md` как данные.
 *
 * Витрина сверяется с документом, а не с копией списка в коде: забытое
 * состояние роняет тест. Тот же приём, что у полос карты и подтипов срезов.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/paths.js";

export const uiSpec = (): string => readFileSync(join(repoRoot, "docs", "11-ui-page-spec.md"), "utf8");

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
export const specPageStates = (doc: string): string[] =>
  specTable(doc, "## Состояния страницы").map((row) => (row[0] ?? "").replace(/`/g, ""));

/** Первая колонка таблицы краевых состояний — формулировка ситуации. */
export const specEdgeSituations = (doc: string): string[] =>
  specTable(doc, "## Краевые состояния").map((row) => row[0] ?? "");
