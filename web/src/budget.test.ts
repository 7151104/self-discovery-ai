/**
 * Вес первой загрузки и бюджеты производительности (E6-01, E10-09).
 *
 * Критерий из `docs/12-target-state.md`, раздел 5.9. Превышение ломает сборку:
 * `assertBudget` бросает, `npm run lint:budget` роняет конвейер.
 *
 * Заодно проверяется, что рантайм-зависимостей нет вовсе: голый импорт
 * (`import … from "какой-нибудь-пакет"`) ломает тест.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  MODULE_COUNT_BUDGET,
  SCRIPT_BUDGET_KB,
  STYLE_BUDGET_KB,
  STYLESHEET_BUDGET,
  assertBudget,
} from "./budgets.js";
import { webRoot } from "./paths.js";

export { SCRIPT_BUDGET_KB, STYLE_BUDGET_KB };

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

interface Graph {
  files: string[];
  bytes: number;
  bare: string[];
}

/** Граф модулей, которые браузер действительно скачает, начиная с точки входа. */
function moduleGraph(entry: string): Graph {
  const seen = new Set<string>();
  const bare: string[] = [];
  const queue = [entry];
  let bytes = 0;

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    bytes += Buffer.byteLength(source, "utf8");

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;
      if (!specifier.startsWith(".")) {
        bare.push(specifier);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      if (existsSync(target)) queue.push(target);
    }
  }

  return { files: [...seen], bytes, bare };
}

const gzipKb = (source: string | Buffer): number => gzipSync(source).length / 1024;

const entry = () => join(webRoot, "dist", "showcase", "showcase.js");

test("точка входа собрана: без неё бюджет не проверить", () => {
  assert.ok(existsSync(entry()), "нет web/dist/showcase/showcase.js — сначала npm run build:web");
});

test("превышение бюджета бросает, а не пишет предупреждение", () => {
  assert.throws(() => assertBudget("скрипты", 151, 150), /скрипты: 151 при бюджете 150/);
  assert.doesNotThrow(() => assertBudget("скрипты", 150, 150));
});

test("вес скриптов первой загрузки укладывается в бюджет 150 КБ", () => {
  const graph = moduleGraph(entry());
  const sources = graph.files.map((file) => readFileSync(file, "utf8")).join("\n");
  const weight = gzipKb(sources);
  assertBudget(`скрипты ${weight.toFixed(1)} КБ`, weight, SCRIPT_BUDGET_KB);
});

test("вес стилей первой загрузки укладывается в бюджет 30 КБ", () => {
  const css = readFileSync(join(webRoot, "dist", "app.css"), "utf8");
  const weight = gzipKb(css);
  assertBudget(`стили ${weight.toFixed(1)} КБ`, weight, STYLE_BUDGET_KB);
});

test("число модулей первой загрузки укладывается в бюджет", () => {
  const graph = moduleGraph(entry());
  assertBudget(`модулей ${graph.files.length}`, graph.files.length, MODULE_COUNT_BUDGET);
});

test("в стилях продукта нет @font-face: системный шрифт не даёт перескока", () => {
  const css = readFileSync(join(webRoot, "dist", "app.css"), "utf8");
  assert.equal(/@font-face/i.test(css), false, "веб-шрифт в app.css дал бы FOIT/FOUT");
});

test("рантайм-зависимостей нет: ни одного голого импорта в графе клиента", () => {
  const graph = moduleGraph(entry());
  assert.deepEqual(graph.bare, [], `клиент тянет чужой рантайм: ${graph.bare.join(", ")}`);
});

test("в граф клиента не попадает ни сервер, ни движок", () => {
  const graph = moduleGraph(entry());
  const outsiders = graph.files.filter((file) => file.includes(`${"server"}/dist`) || file.includes(`${"engine"}/dist`));
  assert.deepEqual(outsiders, [], "серверный код уехал бы в браузер");
});

test("страница витрины подключает ровно одну таблицу стилей продукта", () => {
  const page = readFileSync(join(webRoot, "showcase", "index.html"), "utf8");
  const links = [...page.matchAll(/<link[^>]*href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.includes("../dist/app.css"), "витрина обязана грузить собранные стили продукта");
  assert.equal(links.filter((href) => href?.endsWith("app.css")).length, STYLESHEET_BUDGET);
});
