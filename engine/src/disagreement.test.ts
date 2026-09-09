/** E2-08: несогласие с блоком как данные, а не как правка текста. */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDisagreement,
  applyDisagreements,
  blockCoordinates,
  buildDoors,
  buildPage,
  buildProfile,
  BAR_DEFINITIONS,
  DISAGREEMENT_RULES,
  rejectedNodeSlice,
  rawContent,
  selectOffer,
} from "./index.js";
import { applyNodes } from "./nodes.js";
import type { Disagreement, DisagreementKind, LadderAnswers } from "./types.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const person = { name: "Артём", birthDate: "1994-03-12" };

const answers: LadderAnswers = {
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
  L12: "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша, потом злюсь на себя.",
};

const profileOf = (): ReturnType<typeof buildProfile> => applyNodes(buildProfile(answers), answers);

test("варианты несогласия и их потолки совпадают с таблицей в content/scoring-rules.md", () => {
  const rules = repoFile("content/scoring-rules.md");
  const section = rules.slice(rules.indexOf("## Несогласие с блоком"));
  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("---"))
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells[0] !== "Вариант несогласия");

  assert.ok(section.includes("| Вариант несогласия |"), "у таблицы вариантов пропала шапка");
  assert.equal(rows.length, Object.keys(DISAGREEMENT_RULES).length, "вариантов в коде и в контенте разное число");
  for (const cells of rows) {
    const kind = cells[0] as DisagreementKind;
    const rule = DISAGREEMENT_RULES[kind];
    assert.ok(rule, `вариант «${kind}» описан в контенте, но не реализован`);
    assert.equal(`\`${rule.cap}\``, cells[1], `${kind}: потолок в коде и в контенте разошёлся`);
    assert.equal(cells[2], `\`${rule.flag(11).replace("11", "{номер координаты}")}\``, `${kind}: флаг разошёлся`);
  }
});

test("координаты блока берутся из вопросов его ступени, а у ступени 3 — из узла", () => {
  const profile = profileOf();

  assert.deepEqual(blockCoordinates(profile, 1), [2, 9, 11], "ступень 1: L1, L2, L3");
  assert.deepEqual(blockCoordinates(profile, 2), [3, 4, 7, 8, 9], "ступень 2: L4, L5, L6, L7");
  assert.deepEqual(blockCoordinates(profile, 3), [...(profile.nodes[0]?.coordinates ?? [])].sort((a, b) => a - b));
  assert.deepEqual(blockCoordinates(profile, 4), [15], "ступень 4: открытый ответ даёт сюжет");
});

test("несогласие с блоком снимает high и делает полосу предположительной", () => {
  const before = buildPage(person, answers);
  const precise = before.view.map.filter((bar) => bar.state === "precise");
  assert.ok(precise.length > 0, "на демо-ответах хотя бы одна полоса должна быть точной");

  const disagreement: Disagreement = { step: 1, kind: "это не про меня" };
  const after = buildPage(person, answers, { disagreements: [disagreement] });

  for (const coordinate of blockCoordinates(before.internal.profile, 1)) {
    const state = after.internal.profile.coordinates[coordinate]!;
    assert.notEqual(state.confidence, "high", `координата ${coordinate} обязана потерять high`);
    assert.ok(state.flags.includes(`disagreed_${coordinate}`), `координата ${coordinate}: нет флага несогласия`);
  }

  const touched = new Set(blockCoordinates(before.internal.profile, 1));
  const coordinateOf = (key: string): number =>
    BAR_DEFINITIONS.find((definition) => definition.key === key)!.coordinate;

  for (const bar of after.view.map) {
    const same = before.view.map.find((candidate) => candidate.key === bar.key)!;
    if (touched.has(coordinateOf(bar.key))) {
      assert.notEqual(bar.state, "precise", `полоса ${bar.key} обязана стать предположительной`);
      continue;
    }
    assert.equal(bar.state, same.state, `полоса ${bar.key} изменилась, хотя блок её не касался`);
  }

  assert.ok(after.internal.profile.flags.includes("disagreement_step_1"));
});

test("несогласие не переписывает текст блока ни одним символом", () => {
  const before = buildPage(person, answers);

  for (const kind of Object.keys(DISAGREEMENT_RULES) as DisagreementKind[]) {
    for (const step of [1, 2, 3, 4] as const) {
      const after = buildPage(person, answers, { disagreements: [{ step, kind }] });
      assert.deepEqual(after.view.blocks, before.view.blocks, `${kind} на ступени ${step} переписал блоки`);
      assert.equal(after.view.hook, before.view.hook, "крючок собран из того же узла");
      assert.equal(
        after.internal.profile.dominantNode,
        before.internal.profile.dominantNode,
        "несогласие не меняет сработавший узел",
      );
    }
  }
});

test("«частично» и «слишком общо» опускают до medium, «это не про меня» — до low", () => {
  const profile = profileOf();
  const coordinate = blockCoordinates(profile, 1).find((id) => profile.coordinates[id]?.confidence === "high");
  assert.ok(coordinate, "для проверки потолков нужна координата с high");

  const partial = applyDisagreement(profile, { step: 1, kind: "частично" });
  assert.equal(partial.coordinates[coordinate]?.confidence, "medium");

  const general = applyDisagreement(profile, { step: 1, kind: "слишком общо" });
  assert.equal(general.coordinates[coordinate]?.confidence, "medium");
  assert.ok(general.coordinates[coordinate]?.flags.includes(`too_general_${coordinate}`), "жалоба на текст — свой флаг");
  assert.ok(!general.coordinates[coordinate]?.flags.includes(`disagreed_${coordinate}`), "две жалобы не смешиваются");

  const wrong = applyDisagreement(profile, { step: 1, kind: "это не про меня" });
  assert.equal(wrong.coordinates[coordinate]?.confidence, "low");
});

test("потолок несогласия опускает уверенность и никогда не поднимает", () => {
  const profile = applyDisagreement(profileOf(), { step: 1, kind: "это не про меня" });
  const after = applyDisagreement(profile, { step: 1, kind: "частично" });

  for (const coordinate of blockCoordinates(profile, 1)) {
    assert.equal(
      after.coordinates[coordinate]?.confidence,
      profile.coordinates[coordinate]?.confidence,
      `координата ${coordinate}: второе несогласие подняло уверенность`,
    );
  }
});

test("несогласие с чужой ступенью соседние координаты не трогает", () => {
  const profile = profileOf();
  const after = applyDisagreement(profile, { step: 1, kind: "это не про меня" });
  const touched = new Set(blockCoordinates(profile, 1));

  for (const [id, state] of Object.entries(after.coordinates)) {
    if (touched.has(Number(id))) continue;
    assert.deepEqual(state, profile.coordinates[Number(id)], `координата ${id} изменилась без причины`);
  }
});

test("несогласия копятся: два блока подряд дают два флага ступеней", () => {
  const profile = applyDisagreements(profileOf(), [
    { step: 1, kind: "частично" },
    { step: 2, kind: "слишком общо" },
  ]);

  assert.ok(profile.flags.includes("disagreement_step_1"));
  assert.ok(profile.flags.includes("disagreement_step_2"));
});

test("несогласие со ступенью 3 не продаёт срез отвергнутого узла", () => {
  const before = profileOf();
  assert.equal(before.dominantNode, "NODE_FINISH_FEAR");
  assert.equal(before.nextPaidOffer, "slice_node_finish");
  assert.ok(before.nodes.length > 1, "для проверки нужна вторая сработавшая дверь");

  const after = applyDisagreement(before, { step: 3, kind: "это не про меня" });
  assert.equal(after.dominantNode, before.dominantNode, "несогласие не меняет сработавший узел");
  const nextNode = before.nodes.find((node) => node.id !== before.dominantNode);
  assert.ok(nextNode, "должен остаться другой сработавший узел");
  const nextSlice = rawContent.step3.offers[nextNode.id];
  assert.ok(nextSlice);
  assert.notEqual(after.nextPaidOffer, "slice_node_finish");
  assert.equal(after.nextPaidOffer, nextSlice);
  assert.equal(rejectedNodeSlice(after), "slice_node_finish");

  const offer = selectOffer(after);
  assert.ok(offer);
  assert.equal(offer.slice, nextSlice);
  assert.notEqual(offer.slice, "slice_node_finish");

  const doors = buildDoors(after, [], offer, 4);
  const finish = doors.find((door) => door.slice === "slice_node_finish");
  assert.ok(finish, "дверь отвергнутого узла остаётся на карте");
  assert.equal(finish.price, null, "отвергнутый узел не получает цену");
  const priced = doors.filter((door) => door.price !== null);
  assert.equal(priced.length, 1);
  assert.equal(priced[0]?.slice, nextSlice);
});

test("закрытая координата от несогласия ничего не теряет", () => {
  const partial = applyNodes(buildProfile({ L1: "B", L2: "C", L3: "A" }), { L1: "B", L2: "C", L3: "A" });
  const after = applyDisagreement(partial, { step: 4, kind: "это не про меня" });

  assert.equal(after.coordinates[15]?.sources.length, 0, "координата 15 без синтеза остаётся пустой");
  assert.deepEqual(after.coordinates[15]?.flags, [], "пустая полоса флага несогласия не получает");
  assert.ok(after.flags.includes("disagreement_step_4"), "сам факт несогласия записан всё равно");
});
