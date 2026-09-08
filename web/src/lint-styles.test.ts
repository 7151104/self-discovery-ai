/**
 * Линтер стилей: чист ли проект и падает ли линтер там, где должен.
 *
 * Второе важнее первого. Линтер, который ничего не ловит, выглядит так же,
 * как линтер, у которого всё хорошо, поэтому фикстура с нарушениями
 * обязана давать каждое правило.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintCss, lintProject, RULES, styleFiles } from "./lint-styles.js";
import { webRoot } from "./paths.js";

const fixture = (): string => readFileSync(join(webRoot, "src", "fixtures", "violations.css"), "utf8");

test("стили проекта проходят линтер", () => {
  const violations = lintProject();
  const report = violations.map((item) => `${item.file}:${item.line} [${item.rule}] ${item.message}`).join("\n");
  assert.equal(violations.length, 0, `\n${report}`);
});

test("линтер видит все файлы стилей клиента", () => {
  const files = styleFiles();
  assert.ok(files.length >= 8, `файлов ${files.length}`);
  assert.ok(files.some((path) => path.endsWith("map.css")));
  assert.ok(files.some((path) => path.endsWith("showcase.css")));
});

test("на фикстуре срабатывает каждое правило", () => {
  const violations = lintCss("fixtures/violations.css", fixture());
  const fired = new Set(violations.map((item) => item.rule));
  for (const rule of RULES) assert.ok(fired.has(rule), `правило ${rule} не сработало`);
});

test("литеральный цвет роняет линтер", () => {
  const violations = lintCss("t.css", ".a { color: #123456; }");
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "literal-color");
});

test("размер шрифта вне шкалы роняет линтер", () => {
  const violations = lintCss("t.css", ".a { font-size: 1.1rem; }");
  assert.equal(violations[0]?.rule, "font-size-scale");
});

test("размер шрифта из шкалы линтер пропускает", () => {
  assert.deepEqual(lintCss("t.css", ".a { font-size: var(--text-md); }"), []);
});

test("отступ вне шкалы роняет линтер", () => {
  const violations = lintCss("t.css", ".a { padding: 0.75rem; }");
  assert.equal(violations.some((item) => item.rule === "spacing-scale"), true);
});

test("длительность вне шкалы роняет линтер", () => {
  const violations = lintCss("t.css", ".a { transition: opacity 300ms ease; }");
  assert.equal(violations.some((item) => item.rule === "duration-scale"), true);
});

test("ссылка на несуществующий токен роняет линтер", () => {
  const violations = lintCss("t.css", ".a { color: var(--color-invented); }");
  assert.equal(violations[0]?.rule, "unknown-token");
});

test("локальная переменная файла токеном считается", () => {
  assert.deepEqual(lintCss("t.css", ".a { --local: 50%; left: var(--local); }"), []);
});
