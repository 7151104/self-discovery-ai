/**
 * E4-12: рабочая заглушка собирает валидный выход из задания.
 *
 * Фикстура `envelope()` на чужом открытом ответе честно падает — это и был
 * дефект локального контура. Заглушка обязана проходить тот же прогон.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULTS } from "./config.js";
import { volumeOf } from "./content.js";
import { answering } from "./fake-provider.js";
import { DEMO_ANSWERS, demoTask, envelope } from "./fixtures.js";
import { buildSlicePrompt, buildStep4Prompt } from "./prompt.js";
import { createGenerationProvider, knownLlmProviders, UnknownLlmProvider } from "./registry.js";
import { sliceAnswers, demoProfile } from "../../../engine/dist/slice-fixtures.js";
import { generateLadderFinal } from "./step4.js";
import { generatePaidSlice, sliceTaskOf } from "./slice.js";
import { StubProvider, stubEnvelope } from "./stub-provider.js";
import { LADDER_FINAL, validateText } from "./validator.js";
import { parseModelOutput } from "./output.js";
import { checkRegisters } from "./registers.js";

const base = {
  retry: { ...DEFAULTS.retry, timeoutMs: 50 },
  cost: DEFAULTS.cost,
  spentKopecks: 0,
  sleep: async (): Promise<void> => undefined,
};

const OTHER_OPEN =
  "Обычно я берусь за дело быстро и с интересом, довожу почти до конца, а потом нахожу " +
  "причину отложить и возвращаюсь к нему через несколько недель уже без всякого желания";

test("реестр поднимает заглушку и отказывается от неизвестного имени", () => {
  assert.deepEqual(knownLlmProviders(), ["stub"]);
  const provider = createGenerationProvider({
    provider: "stub",
    pricing: { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 },
    model: "",
  });
  assert.equal(provider.id, "stub");
  assert.throws(
    () =>
      createGenerationProvider({
        provider: "нет-такого",
        pricing: { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 },
        model: "",
      }),
    UnknownLlmProvider,
  );
});

test("заглушка собирает финал лестницы на демо-задании", async () => {
  const outcome = await generateLadderFinal({ ...base, task: demoTask(), provider: new StubProvider() });
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.details.join("; "));
  if (!outcome.ok) return;
  assert.equal(outcome.block.paragraphs.length, 3);
  assert.ok(outcome.storyline.code);
  assert.notEqual(outcome.storyline.confidence, "high");
});

test("заглушка собирает финал на чужом открытом ответе, где статичная фикстура падает", async () => {
  const task = demoTask({ ...DEMO_ANSWERS, L12: OTHER_OPEN });
  const fixture = await generateLadderFinal({ ...base, task, provider: answering(envelope()) });
  assert.equal(fixture.ok, false, "фикстура не должна проходить на чужом ответе");
  if (!fixture.ok) assert.equal(fixture.reason, "регистры");

  const stub = await generateLadderFinal({ ...base, task, provider: new StubProvider() });
  assert.ok(stub.ok, stub.ok ? "" : stub.details.join("; "));
});

test("заглушка детерминирована на одном задании", async () => {
  const prompt = buildStep4Prompt(demoTask(), "0123456789abcdef");
  const request = {
    instruction: prompt.instruction,
    data: prompt.data,
    expects: "json" as const,
    maxOutputTokens: 1000,
    temperature: 0,
  };
  const first = stubEnvelope(request);
  const second = stubEnvelope(request);
  assert.equal(first, second);
});

test("заглушка собирает платный срез, который проходит валидатор", async () => {
  const slice = "slice_node_finish";
  const before = demoProfile();
  const answers = sliceAnswers(slice);
  const task = sliceTaskOf(slice, before, answers, { before });
  const outcome = await generatePaidSlice({ ...base, task, provider: new StubProvider() });
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.details.join("; "));
  if (!outcome.ok) return;
  const type = "срез_узел";
  const volume = volumeOf(type);
  const count = outcome.paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  assert.ok(count >= volume.min, `слов ${count}, минимум ${volume.min}`);
});

test("выход заглушки разбирается, проходит валидатор и регистры", async () => {
  const task = demoTask({ ...DEMO_ANSWERS, L12: OTHER_OPEN });
  const prompt = buildStep4Prompt(task, "fedcba9876543210");
  const raw = stubEnvelope({
    instruction: prompt.instruction,
    data: prompt.data,
    expects: "json",
    maxOutputTokens: 1000,
    temperature: 0,
  });
  const parsed = parseModelOutput(raw, { knownCoordinates: prompt.knownCoordinates });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.problems.map((item) => item.detail).join("; "));
  if (!parsed.ok) return;
  const verdict = validateText(parsed.output.text, { type: LADDER_FINAL });
  assert.ok(verdict.ok, verdict.violations.map((item) => item.detail).join("; "));
  const registers = checkRegisters(parsed.output, { profile: task.input.profile, openAnswer: task.input.openAnswer });
  assert.equal(registers.length, 0, registers.map((item) => `${item.kind}: ${item.phrase}`).join("; "));
});

test("промпт среза с заглушкой даёт текст без сюжета", async () => {
  const slice = "slice_node_finish";
  const before = demoProfile();
  const task = sliceTaskOf(slice, before, sliceAnswers(slice), { before });
  const prompt = buildSlicePrompt(task, "aabbccddeeff0011");
  const raw = stubEnvelope({
    instruction: prompt.instruction,
    data: prompt.data,
    expects: "json",
    maxOutputTokens: 2000,
    temperature: 0,
  });
  const parsed = parseModelOutput(raw, { knownCoordinates: prompt.knownCoordinates, storyline: "optional" });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.problems.map((item) => `${item.kind}: ${item.detail}`).join("; "));
  if (!parsed.ok) return;
  assert.equal(parsed.output.storyline, null);
});
