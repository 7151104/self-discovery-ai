/**
 * Скоринг на демо-человеке из examples/demo-person-answers.md.
 * Ожидания взяты оттуда же, с поправкой на то, что лестница даёт меньше данных,
 * чем полный банк: часть координат обязана остаться на medium.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildProfile, unknownCoordinates } from "./scoring.js";
import { applyNodes } from "./nodes.js";
import type { LadderAnswers } from "./types.js";

const demo: LadderAnswers = {
  L1: "B",
  L2: "C",
  L3: "A",
  L4: "B",
  L5: "D",
  L6: 5,
  L7: 2,
  L8: "A",
  L9: 5,
  L10: 4,
  L11: 4,
  L12: "Беру на себя больше, чем могу вынести. Сначала загораюсь, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша.",
};

const profileOf = (answers: LadderAnswers) => applyNodes(buildProfile(answers), answers);

test("демо: ключевые координаты считаются как в examples/", () => {
  const profile = profileOf(demo);

  assert.equal(profile.coordinates[2]?.code, "bursts");
  assert.equal(profile.coordinates[2]?.confidence, "medium");

  assert.equal(profile.coordinates[11]?.code, "at_80");
  assert.equal(profile.coordinates[11]?.confidence, "high");

  assert.equal(profile.coordinates[9]?.code, "acceleration");
  assert.equal(profile.coordinates[8]?.code, "not_taken_seriously");
  assert.equal(profile.coordinates[7]?.code, "holds_long");
  assert.equal(profile.coordinates[3]?.code, "connections");
});

test("демо: главный узел и первое платное предложение", () => {
  const profile = profileOf(demo);
  assert.equal(profile.dominantNode, "NODE_FINISH_FEAR");
  assert.equal(profile.nextPaidOffer, "slice_node_finish");
  assert.equal(profile.nodes[0]?.priority, 2, "узел с уязвимостью должен идти вторым приоритетом");
  assert.ok(profile.nodes.length >= 4, "остальные узлы должны стать закрытыми дверями");
});

test("лестница оставляет закрытыми шесть координат плюс сюжет до синтеза", () => {
  const profile = profileOf({ ...demo, L5: "A" });
  assert.deepEqual(
    unknownCoordinates(profile).map((coordinate) => coordinate.id),
    [1, 6, 10, 12, 14, 15, 16],
  );

  const withStoryline = applyNodes(
    buildProfile(demo, { storyline: { value: "тащит один и бросает у финиша", code: "solo_then_drop", confidence: "medium" } }),
    demo,
  );
  assert.deepEqual(
    unknownCoordinates(withStoryline).map((coordinate) => coordinate.id),
    [1, 4, 6, 10, 12, 14, 16],
    "сюжет закрывается только синтезом ступени 4",
  );
});

test("поведение важнее самооценки: «довожу всё» против «не сдвинусь без срока»", () => {
  const profile = profileOf({ ...demo, L2: "E", L11: 5 });

  assert.equal(profile.coordinates[11]?.code, "completes", "значение берётся из поведенческого вопроса");
  assert.ok(profile.flags.includes("self_report_mismatch_11"));
  assert.equal(profile.coordinates[11]?.confidence, "medium");

  assert.equal(profile.dominantNode, "NODE_EXTERNAL_DEADLINE");
  assert.equal(profile.nodes[0]?.priority, 1, "расхождение самооценки и поведения показывается первым");
  assert.equal(profile.nextPaidOffer, "slice_motivation");
});

test("хочет план и сам оставляет открытым — конфликт понижает уверенность", () => {
  const profile = profileOf({ ...demo, L9: 5, L10: 5 });
  assert.equal(profile.coordinates[5]?.code, "plan_vs_open");
  assert.equal(profile.coordinates[5]?.confidence, "low");
  assert.ok(profile.flags.includes("contradiction_plan_vs_open"));
});

test("подтверждение уязвимости вторым ответом поднимает до high", () => {
  const supported = profileOf({ ...demo, L8: "A", L4: "A" });
  assert.equal(supported.coordinates[8]?.confidence, "high");

  const unsupported = profileOf({ ...demo, L8: "G" });
  assert.equal(unsupported.coordinates[8]?.confidence, "medium", "бессмысленность в лестнице подтвердить нечем");
});

test("согласие ситуационного и шкального вопроса поднимает координату 9", () => {
  const agreeing = profileOf({ ...demo, L3: "C", L4: "A" });
  assert.equal(agreeing.coordinates[9]?.confidence, "high");

  const disagreeing = profileOf({ ...demo, L3: "C", L4: "C" });
  assert.equal(disagreeing.coordinates[9]?.confidence, "medium");
});

test("неполные ответы не выдумывают координат", () => {
  const profile = profileOf({ L1: "A" });
  assert.equal(profile.coordinates[2]?.code, "even");
  assert.equal(profile.coordinates[11]?.value, null);
  assert.equal(profile.dominantNode, null);
  assert.equal(profile.nextPaidOffer, "slice_node_finish", "по умолчанию — узловой срез");
});

test("дата рождения ни на что не влияет: её нет во входе скоринга", () => {
  const withoutDate = profileOf(demo);
  const again = profileOf(demo);
  assert.deepEqual(withoutDate.coordinates, again.coordinates);
  for (const coordinate of Object.values(withoutDate.coordinates)) {
    assert.ok(
      coordinate.sources.every((source) => source.startsWith("L") || source.startsWith("подтверждение")),
      `координата ${coordinate.id} получила источник вне лестницы: ${coordinate.sources.join(", ")}`,
    );
  }
});
