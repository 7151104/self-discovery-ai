/**
 * E2-05: порог генерации и уточняющие вопросы. E2-11: следующая дверь.
 *
 * По каждому срезу два исхода: порог взят и порог не взят. Во втором случае
 * наружу уходят те уточняющие вопросы, что записаны в файле среза, и ни одного
 * своего. Дверь после среза — одна и всегда из таблицы этого среза.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { applySlice, checkThreshold, nextSliceAfter, SCORED_SLICES } from "./slices.js";
import { selectOfferAfterSlice } from "./offers.js";
import { demoProfile, sliceAnswers, textLonger } from "./slice-fixtures.js";
import type { Profile, SliceAnswers, SliceTextFindings } from "./types.js";

const content = (slice: string) => {
  const found = rawContent.slices.find((candidate) => candidate.id === slice);
  assert.ok(found, `нет среза ${slice}`);
  return found;
};

/** Разбор развилки для `slice_decision_moment` приходит от LLM отдельным входом. */
const findingsFor = (slice: string): SliceTextFindings =>
  slice === "slice_decision_moment" ? { safeTopic: true } : {};

/**
 * Профиль, с которым срез покупают. `slice_decision_moment` продаётся после
 * `slice_decisions` — иначе координаты 14 в профиле ещё нет.
 */
const profileBefore = (slice: string): Profile =>
  slice === "slice_decision_moment"
    ? applySlice("slice_decisions", demoProfile(), sliceAnswers("slice_decisions"))
    : demoProfile();

const run = (slice: string, answers: SliceAnswers = sliceAnswers(slice)) => {
  const before = profileBefore(slice);
  const findings = findingsFor(slice);
  const after = applySlice(slice, before, answers, findings);
  return { before, after, result: checkThreshold(slice, after, answers, findings, before) };
};

test("порог взят: на подготовленном наборе доборов отчёт собирается по каждому срезу", () => {
  for (const slice of SCORED_SLICES) {
    const { result } = run(slice);
    assert.equal(result.passed, true, `${slice}: порог не взят, не хватает: ${result.missing.join(" | ")}`);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.followUps, [], `${slice}: при взятом пороге уточняющих быть не должно`);
    assert.equal(result.blocked, null);
  }
});

test("порог не взят: возвращаются именно те уточняющие, что записаны в контенте", () => {
  for (const slice of SCORED_SLICES) {
    const { result } = run(slice, {});
    assert.equal(result.passed, false, `${slice}: пустые ответы не должны брать порог`);
    assert.ok(result.missing.length > 0, `${slice}: не назван ни один невыполненный пункт`);
    assert.deepEqual(
      result.followUps,
      content(slice).threshold?.followUps,
      `${slice}: уточняющие разошлись с файлом среза`,
    );
    for (const followUp of result.followUps) {
      assert.ok(followUp.length > 20, `${slice}: уточняющий вопрос подозрительно короткий`);
    }
  }
});

test("число условий порога в коде совпадает с числом пунктов чек-листа в контенте", () => {
  for (const slice of SCORED_SLICES) {
    const checks = content(slice).threshold?.checks ?? [];
    const { result } = run(slice, {});
    // Все пункты, кроме уже выполненных профилем, обязаны быть перечислимы.
    assert.ok(result.missing.every((item) => checks.includes(item)), `${slice}: пункт порога придуман кодом`);
  }
});

test("slice_node_finish: без открытых ответов порог падает на четвёртом пункте", () => {
  const answers = { ...sliceAnswers("slice_node_finish"), S8: "", S9: "D" };
  const { result } = run("slice_node_finish", answers);

  assert.equal(result.passed, false);
  assert.deepEqual(result.missing, [
    "S8 отвечен текстом длиннее 15 слов **или** S9 ≠ D",
  ]);
  assert.equal(result.followUps.length, 3);
});

test("slice_stress: структурный кризисный признак останавливает отчёт без уточняющих", () => {
  const answers = { ...sliceAnswers("slice_stress"), S1: "F" };
  const { result } = run("slice_stress", answers);

  assert.equal(result.passed, false);
  assert.deepEqual(result.followUps, [], "при кризисном признаке уточняющие не задаются");
  assert.match(result.blocked ?? "", /S1=F/);
});

test("slice_decision_moment: без проверки темы порог не берётся", () => {
  const answers = sliceAnswers("slice_decision_moment");
  const before = profileBefore("slice_decision_moment");
  const after = applySlice("slice_decision_moment", before, answers, {});
  const result = checkThreshold("slice_decision_moment", after, answers, {}, before);

  assert.equal(result.passed, false);
  assert.ok(
    result.missing.some((item) => item.includes("медицин")),
    "жёсткий пункт про медицину, юридику и безопасность обязан остаться невыполненным",
  );
});

test("slice_decision_moment: короткое описание развилки порог не берёт", () => {
  const answers = { ...sliceAnswers("slice_decision_moment"), entry: textLonger(40) };
  const { result } = run("slice_decision_moment", answers);

  assert.equal(result.passed, false);
  assert.ok(result.missing.some((item) => item.includes("80 слов")));
});

test("следующая дверь после среза одна и берётся из таблицы этого среза", () => {
  for (const slice of SCORED_SLICES) {
    const { after } = run(slice);
    const next = nextSliceAfter(slice, after, sliceAnswers(slice));
    const rows = content(slice).nextDoors.map((door) => door.slice);

    assert.ok(rows.includes(next), `${slice}: дверь ${next} не записана в таблице среза`);
    assert.notEqual(next, slice, `${slice}: дверь ведёт в тот же срез`);
    assert.equal(typeof next, "string");
  }
});

test("двери демо-человека по каждому срезу", () => {
  const doorOf = (slice: string, answers: SliceAnswers = sliceAnswers(slice)): string => {
    const { after } = run(slice, answers);
    return nextSliceAfter(slice, after, answers);
  };

  // S10=C: стоит только своё — первая строка таблицы slice_node_finish.
  assert.equal(doorOf("slice_node_finish"), "slice_work");
  // Начинал четыре раза, доведено одно — отдельный случай не срабатывает.
  assert.equal(doorOf("slice_motivation"), "slice_work");
  assert.equal(
    doorOf("slice_motivation", { ...sliceAnswers("slice_motivation"), S5: [5, 0], S8: textLonger(20) }),
    "slice_node_finish",
  );
  // S9 отвечен: канал наружу есть.
  assert.equal(doorOf("slice_stress"), "slice_work");
  assert.equal(doorOf("slice_reactivity"), "slice_full_map");
  assert.equal(doorOf("slice_reactivity", { ...sliceAnswers("slice_reactivity"), S7: "A" }), "slice_relationships");
  // S10 содержателен: развилка на столе.
  assert.equal(doorOf("slice_decisions"), "slice_decision_moment");
  assert.equal(doorOf("slice_work"), "slice_full_map");
  assert.equal(
    doorOf("slice_work", { ...sliceAnswers("slice_work"), S10: [55, 5], S18: "B" }),
    "slice_node_finish",
  );
  assert.equal(doorOf("slice_relationships"), "slice_full_map");
  assert.equal(doorOf("slice_decision_moment"), "slice_full_map");
});

test("уже купленный срез второй дверью не предлагается", () => {
  const { after } = run("slice_node_finish");
  const answers = sliceAnswers("slice_node_finish");

  assert.equal(nextSliceAfter("slice_node_finish", after, answers), "slice_work");
  assert.equal(nextSliceAfter("slice_node_finish", after, answers, ["slice_work"]), "slice_reactivity");
});

test("предложение после среза берёт цену и обещание из content/slices", () => {
  const { after } = run("slice_node_finish");
  const offer = selectOfferAfterSlice("slice_node_finish", after, sliceAnswers("slice_node_finish"));

  assert.ok(offer, "предложение после среза обязано быть");
  assert.equal(offer?.slice, "slice_work");
  assert.equal(offer?.price, 1290);
  assert.ok((offer?.promise.length ?? 0) > 80, "обещание берётся из файла среза");
});
