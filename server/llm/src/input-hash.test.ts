/**
 * E4-11: ключ кэша не зависит от одноразовой границы и меняется с контентом.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ANSWERS, demoTask } from "./fixtures.js";
import { contentVersion, hashGenerationInput, stableGenerationInput } from "./input-hash.js";
import { buildStep4Prompt } from "./prompt.js";

test("один и тот же вход даёт один хеш, одноразовая граница на него не влияет", () => {
  const task = demoTask();
  const first = hashGenerationInput(task);
  const second = hashGenerationInput(task);

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);

  const one = buildStep4Prompt(task);
  const two = buildStep4Prompt(task);
  assert.notEqual(one.nonce, two.nonce, "граница обязана быть новой на каждый промпт");
  assert.notEqual(one.data, two.data);
  assert.equal(hashGenerationInput(task), first, "хеш не содержит одноразовую границу");
});

test("правка открытого ответа или версии контента меняет хеш", () => {
  const original = hashGenerationInput(demoTask());
  const changed = hashGenerationInput(
    demoTask({
      ...DEMO_ANSWERS,
      L12: `${DEMO_ANSWERS.L12} И ещё одно предложение про круг.`,
    }),
  );

  assert.notEqual(changed, original);

  const version = contentVersion();
  assert.match(version, /^[a-f0-9]{64}$/);
  assert.notEqual(hashGenerationInput(demoTask(), `${version}x`), original);
  assert.ok(stableGenerationInput(demoTask()).includes(version));
});
