/**
 * Вес первой загрузки (E6-01).
 *
 * Критерий выбора стека, записанный в маршруте: бюджет из
 * `docs/12-target-state.md`, раздел 5.9 — не больше 150 КБ скриптов и 30 КБ
 * стилей после сжатия. Здесь он перестаёт быть намерением: тест считает
 * настоящий граф модулей от точки входа и настоящую таблицу стилей.
 *
 * Заодно проверяется, что рантайм-зависимостей нет вовсе: голый импорт
 * (`import … from "какой-нибудь-пакет"`) ломает тест.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { webRoot } from "./paths.js";

/** Бюджет из docs/12-target-state.md, раздел «Производительность». */
export const SCRIPT_BUDGET_KB = 150;
export const STYLE_BUDGET_KB = 30;

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

const showcaseEntry = () => join(webRoot, "dist", "showcase", "showcase.js");
const pageEntry = () => join(webRoot, "dist", "src", "app.js");

test("точки входа собраны: без них бюджет не проверить", () => {
  assert.ok(existsSync(showcaseEntry()), "нет web/dist/showcase/showcase.js — сначала npm run build:web");
  assert.ok(existsSync(pageEntry()), "нет web/dist/src/app.js — сначала npm run build:web");
});

test("вес скриптов первой загрузки укладывается в бюджет 150 КБ", () => {
  for (const entry of [pageEntry(), showcaseEntry()]) {
    const graph = moduleGraph(entry);
    const sources = graph.files.map((file) => readFileSync(file, "utf8")).join("\n");
    const weight = gzipKb(sources);
    assert.ok(weight <= SCRIPT_BUDGET_KB, `${entry}: скрипты ${weight.toFixed(1)} КБ при бюджете ${SCRIPT_BUDGET_KB} КБ`);
  }
});

test("вес стилей первой загрузки укладывается в бюджет 30 КБ", () => {
  const css = readFileSync(join(webRoot, "dist", "app.css"), "utf8");
  const weight = gzipKb(css);
  assert.ok(weight <= STYLE_BUDGET_KB, `стили ${weight.toFixed(1)} КБ при бюджете ${STYLE_BUDGET_KB} КБ`);
});

test("рантайм-зависимостей нет: ни одного голого импорта в графе клиента", () => {
  for (const entry of [pageEntry(), showcaseEntry()]) {
    const graph = moduleGraph(entry);
    assert.deepEqual(graph.bare, [], `${entry}: клиент тянет чужой рантайм: ${graph.bare.join(", ")}`);
  }
});

test("в граф клиента не попадает ни сервер, ни движок", () => {
  for (const entry of [pageEntry(), showcaseEntry()]) {
    const graph = moduleGraph(entry);
    const outsiders = graph.files.filter((file) => file.includes(`${"server"}/dist`) || file.includes(`${"engine"}/dist`));
    assert.deepEqual(outsiders, [], `${entry}: серверный код уехал бы в браузер`);
  }
});

test("живая страница не тащит витрину", () => {
  const graph = moduleGraph(pageEntry());
  const showcase = graph.files.filter((file) => file.includes(`${"showcase"}/`));
  assert.deepEqual(showcase, [], "витрина уехала бы в первую загрузку страницы");
});

test("страница витрины подключает ровно одну таблицу стилей продукта", () => {
  const page = readFileSync(join(webRoot, "showcase", "index.html"), "utf8");
  const links = [...page.matchAll(/<link[^>]*href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.includes("../dist/app.css"), "витрина обязана грузить собранные стили продукта");
  assert.equal(links.filter((href) => href?.endsWith("app.css")).length, 1);
});

test("живая страница подключает собранные стили и свой модуль", () => {
  const page = readFileSync(join(webRoot, "page", "index.html"), "utf8");
  assert.ok(page.includes("../dist/app.css"), "страница обязана грузить собранные стили продукта");
  assert.ok(page.includes("../dist/src/app.js"), "страница обязана грузить живой клиент");
});
