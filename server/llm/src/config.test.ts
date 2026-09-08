/**
 * Полнота списка переменных окружения слоя.
 *
 * Тест временный и живёт здесь по конкретной причине: `server/src/secrets.test.ts`
 * сверяет `.env.example` только с `server/src/config.ts`, а настройки слоя лежат в
 * своём модуле. Пока список переменных слоя описан в `server/llm/README.md`,
 * полноту описания держит этот тест. Когда владелец сервера объединит два модуля
 * настроек в том тесте, список уезжает в `.env.example`, а этот файл уходит.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readRepoFile } from "./content.js";
import { DEFAULTS, loadLlmConfig } from "./config.js";

const variablesOf = (source: string): Set<string> => new Set(source.match(/SDAI_LLM_[A-Z_]+/g) ?? []);

test("каждая переменная слоя описана, лишних в описании нет", () => {
  const used = variablesOf(readRepoFile("server/llm/src/config.ts"));
  const documented = variablesOf(readRepoFile("server/llm/README.md"));

  assert.ok(used.size >= 10, `слой читает только ${used.size} переменных, ожидалось больше`);
  for (const variable of used) assert.ok(documented.has(variable), `${variable} не описан в server/llm/README.md`);
  for (const variable of documented) assert.ok(used.has(variable), `${variable} в описании лишний`);
});

test("значения по умолчанию в описании совпадают с кодом", () => {
  const readme = readRepoFile("server/llm/README.md");
  const bare = loadLlmConfig({});

  assert.ok(readme.includes(`\`${DEFAULTS.retry.timeoutMs}\``));
  assert.ok(readme.includes(`\`${DEFAULTS.retry.attempts}\``));
  assert.ok(readme.includes(`\`${DEFAULTS.cost.profileLimitKopecks}\``));
  assert.equal(bare.cost.profileLimitKopecks, DEFAULTS.cost.profileLimitKopecks);
  assert.equal(bare.provider, DEFAULTS.provider);
});

test("в описании слоя нет ни одного значения ключа", () => {
  const readme = readRepoFile("server/llm/README.md");
  assert.ok(!/SDAI_LLM_API_KEY\s*=\s*\S/.test(readme), "в описании появилось значение ключа");
});
