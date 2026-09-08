/**
 * E4-08: генерация платных срезов.
 *
 * По каждому срезу два исхода: порог не взят — провайдера нет, уточняющие
 * из файла среза; порог взят — текст проходит валидатор выхода.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULTS } from "./config.js";
import { assemblerPrompt, reportTypeOfSlice, sliceOverlay, volumeOf } from "./content.js";
import { applySlice, rawContent, SCORED_SLICES, scanText, type Profile, type SliceAnswers } from "./engine.js";
import { answering } from "./fake-provider.js";
import { sliceEnvelope, textOfVolume } from "./fixtures.js";
import { buildSlicePrompt, instructionOf } from "./prompt.js";
import { generatePaidSlice, sliceTaskOf } from "./slice.js";
import { validateText } from "./validator.js";
import { demoProfile, sliceAnswers } from "../../../engine/dist/slice-fixtures.js";

const base = {
  retry: { ...DEFAULTS.retry, timeoutMs: 50 },
  cost: DEFAULTS.cost,
  spentKopecks: 0,
  sleep: async (): Promise<void> => undefined,
};

const content = (slice: string) => {
  const found = rawContent.slices.find((item) => item.id === slice);
  assert.ok(found, `нет среза ${slice}`);
  return found;
};

const profileBefore = (slice: string): Profile =>
  slice === "slice_decision_moment"
    ? applySlice("slice_decisions", demoProfile(), sliceAnswers("slice_decisions"))
    : demoProfile();

const taskOf = (slice: string, answers: SliceAnswers = sliceAnswers(slice)) =>
  sliceTaskOf(slice, profileBefore(slice), answers, { before: profileBefore(slice) });

test("ассемблер и надстройка входят в промпт дословно из файлов", () => {
  for (const slice of SCORED_SLICES) {
    const prompt = buildSlicePrompt(taskOf(slice));
    assert.ok(
      instructionOf(prompt).includes(assemblerPrompt()),
      `${slice}: ассемблер не вошёл в инструкцию`,
    );
    assert.ok(
      instructionOf(prompt).includes(sliceOverlay(slice)),
      `${slice}: надстройка не вошла в инструкцию`,
    );
    const type = reportTypeOfSlice(slice);
    assert.ok(instructionOf(prompt).includes(type), `${slice}: машинный тип отчёта не попал в задание`);
  }
});

test("инструкция среза не зависит от открытых ответов", () => {
  const slice = "slice_node_finish";
  const nonce = "0123456789abcdef";
  const benign = buildSlicePrompt(taskOf(slice), nonce);
  const other = buildSlicePrompt(
    taskOf(slice, { ...sliceAnswers(slice), S8: "Совсем другой открытый текст про первую остановку в школе." }),
    nonce,
  );
  assert.equal(instructionOf(benign), instructionOf(other));
});

test("машинный тип каждого среза есть в таблице объёма", () => {
  for (const slice of SCORED_SLICES) {
    const type = reportTypeOfSlice(slice);
    const range = volumeOf(type);
    assert.ok(range.min >= 800, `${slice}: объём среза меньше узлового`);
    assert.ok(range.max > range.min);
  }
});

for (const slice of SCORED_SLICES) {
  test(`${slice}: непройденный порог не вызывает провайдера и возвращает уточняющие`, async () => {
    const provider = answering(sliceEnvelope(textOfVolume(800, 1200)));
    const outcome = await generatePaidSlice({ ...base, task: taskOf(slice, {}), provider });

    assert.equal(outcome.ok, false, `${slice}: пустые ответы не должны собрать отчёт`);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "порог");
      assert.deepEqual(outcome.followUps, content(slice).threshold?.followUps);
      assert.ok(outcome.followUps.length > 0, `${slice}: уточняющих нет`);
    }
    assert.equal(provider.callCount, 0, `${slice}: порог не взят, а провайдера вызвали`);
  });

  test(`${slice}: пройденный порог даёт отчёт, который проходит валидатор`, async () => {
    const type = reportTypeOfSlice(slice);
    const volume = volumeOf(type);
    const text = textOfVolume(volume.min, volume.max);
    const provider = answering(sliceEnvelope(text));
    const outcome = await generatePaidSlice({ ...base, task: taskOf(slice), provider });

    assert.ok(outcome.ok, outcome.ok ? "" : `${slice}: ${outcome.details.join("; ")}`);
    if (!outcome.ok) return;

    assert.equal(provider.callCount, 1);
    assert.equal(outcome.heading, content(slice).title);
    assert.ok(outcome.paragraphs.length > 0);
    const verdict = validateText(outcome.paragraphs.join("\n\n"), { type });
    assert.ok(verdict.ok, `${slice}: валидатор отклонил — ${verdict.violations.map((item) => item.detail).join("; ")}`);
  });
}

test("структурный кризис среза не вызывает провайдера и не даёт уточняющих", async () => {
  const answers = { ...sliceAnswers("slice_stress"), S1: "F" };
  const provider = answering(sliceEnvelope(textOfVolume(800, 1200)));
  const outcome = await generatePaidSlice({ ...base, task: taskOf("slice_stress", answers), provider });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "кризис");
    assert.deepEqual(outcome.followUps, []);
  }
  assert.equal(provider.callCount, 0);
});

test("кризисный открытый ответ среза не доходит до провайдера", async () => {
  const answers = {
    ...sliceAnswers("slice_node_finish"),
    S8: "Хочу умереть и не вижу смысла жить дальше после этой остановки.",
  };
  const provider = answering(sliceEnvelope(textOfVolume(800, 1200)));
  const outcome = await generatePaidSlice({ ...base, task: taskOf("slice_node_finish", answers), provider });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "кризис");
  assert.equal(provider.callCount, 0);
});

test("в надстройке среза нет названий методик сверх реестра промптов", () => {
  for (const slice of SCORED_SLICES) {
    const overlay = sliceOverlay(slice);
    const methods = scanText(overlay, "промпты", { group: "FORBIDDEN_METHODS" });
    assert.deepEqual(
      methods.map((hit) => hit.match),
      [],
      `${slice}: в надстройке название методики`,
    );
  }
});
