/**
 * E12-01: форма наблюдений покрывает памятку и не спрашивает «понравилось?».
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const form = readFileSync(join(repoRoot, "research/observation.md"), "utf8");
const guide = readFileSync(join(repoRoot, "research/README.md"), "utf8");

test("форма фиксирует все семь пунктов памятки", () => {
  for (const item of [
    "Первая реакция",
    "Удивление",
    "не согласился",
    "Переслал",
    "разбор для другого",
    "Уточняющий вопрос",
    "Вернулся через несколько дней",
  ]) {
    assert.ok(form.includes(item), `в форме нет пункта «${item}»`);
  }
});

test("вопроса «понравилось?» в форме и в памятке прогона нет", () => {
  assert.equal(/понравилось\s*\?/i.test(form), false);
  assert.equal(/понравилось\s*\?/i.test(guide), false);
  assert.match(guide, /не спрашивать «понравилось\?»/i);
});

test("сопровождение без подсказок названо явно", () => {
  assert.match(guide, /без подсказок/i);
  assert.match(guide, /основатель/i);
});
