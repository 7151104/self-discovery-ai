/**
 * E2-06: порции доборов и промежуточный блок.
 *
 * Правило 6 из `content/slices/README.md`: добор за 590 ₽ выдаётся одной порцией,
 * за 1290 ₽ — двумя по десять, между ними промежуточный блок на странице.
 * Проверяется и обратная сторона правила: до конца последней порции отчёта по
 * срезу не существует — за него уже заплачено, а ответы ещё не отданы.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";
import { buildSliceInterludeBlock } from "./blocks.js";
import { applySlice, nextSlicePortion, sliceDelivered, slicePortions, sliceReport, SCORED_SLICES } from "./slices.js";
import { demoProfile, sliceAnswers } from "./slice-fixtures.js";
import type { SliceAnswers } from "./types.js";

/** Ответы только тех вопросов, что стоят в названных порциях. */
const upToPortion = (slice: string, last: number): SliceAnswers => {
  const all = sliceAnswers(slice);
  const allowed = new Set(
    slicePortions(slice)
      .filter((portion) => portion.number <= last)
      .flatMap((portion) => portion.questions.map((question) => question.id)),
  );
  return Object.fromEntries(Object.entries(all).filter(([id]) => allowed.has(id)));
};

test("порций у добора столько, сколько велит цена среза", () => {
  for (const slice of SCORED_SLICES) {
    const content = rawContent.slices.find((candidate) => candidate.id === slice)!;
    const portions = slicePortions(slice);

    if (content.price >= 1290 && content.questions.length === 20) {
      assert.equal(portions.length, 2, `${slice}: прикладной срез выдаётся двумя порциями`);
      assert.deepEqual(
        portions.map((portion) => portion.questions.length),
        [10, 10],
        `${slice}: порции не по десять вопросов`,
      );
      assert.deepEqual(
        portions.map((portion) => portion.interlude),
        [true, false],
        `${slice}: промежуточный блок стоит между порциями, а не после последней`,
      );
      continue;
    }

    assert.equal(portions.length, 1, `${slice}: узловой срез выдаётся одной порцией`);
    assert.equal(portions[0]!.interlude, false, `${slice}: одной порции промежуточный блок не нужен`);
  }
});

test("порция не меняется до конца: возврат открывает ту же, а не новый набор", () => {
  const slice = "slice_work";
  const first = slicePortions(slice)[0]!;

  assert.equal(nextSlicePortion(slice, {})?.number, 1);
  assert.equal(nextSlicePortion(slice, { S1: "C" })?.number, 1, "часть первой порции — всё ещё первая порция");
  assert.equal(nextSlicePortion(slice, upToPortion(slice, 1))?.number, 2);
  assert.equal(nextSlicePortion(slice, sliceAnswers(slice)), null, "добор выдан до конца");

  assert.deepEqual(
    nextSlicePortion(slice, { S1: "C" })!.questions.map((question) => question.id),
    first.questions.map((question) => question.id),
    "состав первой порции пересчитан заново",
  );
});

test("после первой порции прикладного среза появляется промежуточный блок и вторая порция", () => {
  for (const slice of ["slice_work", "slice_relationships"]) {
    const answers = upToPortion(slice, 1);

    const block = buildSliceInterludeBlock(slice, answers);
    assert.ok(block, `${slice}: после первой порции нет промежуточного блока`);
    assert.equal(block!.slice, slice);
    assert.equal(block!.afterPortion, 1);
    assert.equal(block!.source, "lookup", "блок между порциями собирается без LLM");
    assert.equal(block!.paragraphs.length, 1);
    assert.ok(block!.paragraphs[0]!.length > 150, `${slice}: текст блока подозрительно короткий`);
    assert.ok(block!.heading.length > 10, `${slice}: у блока нет заголовка`);

    assert.equal(nextSlicePortion(slice, answers)?.number, 2, `${slice}: вторая порция не выдаётся`);
    assert.equal(sliceDelivered(slice, answers), false);
  }
});

test("текст промежуточного блока приходит из файла среза, а не из кода", () => {
  for (const interlude of rawExtraContent.interludes) {
    const answers = upToPortion(interlude.slice, 1);
    const block = buildSliceInterludeBlock(interlude.slice, answers)!;

    const [first, second] = interlude.axes.map((axis) => answers[axis.id]);
    const pair = interlude.pairs.find((candidate) => candidate.first === first && candidate.second === second)!;
    assert.equal(block.paragraphs[0], pair.text);
    assert.equal(block.heading, interlude.heading);
  }
});

test("блок не выдаётся, пока на вопрос оси нет ответа: догадок в нём нет", () => {
  const interlude = rawExtraContent.interludes.find((candidate) => candidate.slice === "slice_work")!;
  const [firstAxis, secondAxis] = interlude.axes;

  const partial = upToPortion("slice_work", 1);
  delete partial[secondAxis!.id];
  assert.equal(buildSliceInterludeBlock("slice_work", partial), null);

  const empty: SliceAnswers = {};
  assert.equal(buildSliceInterludeBlock("slice_work", empty), null);

  // Узловой срез промежуточного блока не имеет вовсе: порция у него одна.
  assert.equal(buildSliceInterludeBlock("slice_node_finish", sliceAnswers("slice_node_finish")), null);
  assert.ok(firstAxis && secondAxis, "оси блока разобраны");
});

test("отчёт по прикладному срезу не собирается до конца второй порции", () => {
  for (const slice of ["slice_work", "slice_relationships"]) {
    const first = upToPortion(slice, 1);
    const profile = demoProfile();

    const afterFirst = sliceReport(slice, applySlice(slice, profile, first), first, {}, profile);
    assert.equal(afterFirst.ready, false, `${slice}: отчёт собрался после первой порции`);
    assert.equal(afterFirst.portion?.number, 2, `${slice}: человек должен получить вторую порцию`);
    assert.equal(afterFirst.threshold.passed, false, `${slice}: порог взят на половине ответов`);
    assert.ok(afterFirst.threshold.followUps.length > 0, `${slice}: уточняющих не выдали`);

    const all = sliceAnswers(slice);
    const afterSecond = sliceReport(slice, applySlice(slice, profile, all), all, {}, profile);
    assert.equal(afterSecond.portion, null, `${slice}: порции остались после полного добора`);
    assert.equal(afterSecond.ready, afterSecond.threshold.passed, `${slice}: готовность отчёта решает порог`);
  }
});

test("у узлового среза отчёт возможен сразу после единственной порции", () => {
  const slice = "slice_node_finish";
  const answers = sliceAnswers(slice);
  const profile = demoProfile();
  const report = sliceReport(slice, applySlice(slice, profile, answers), answers, {}, profile);

  assert.equal(report.portion, null);
  assert.equal(report.ready, true, "порог узлового среза на подготовленных ответах берётся");
});
