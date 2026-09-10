/** Выбор предложения и двери: одно предложение, цена только у него. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDisagreement,
  applyNodes,
  buildDoors,
  buildProfile,
  fullMap,
  selectOffer,
  selectOfferAfterSlice,
} from "./index.js";
import type { LadderAnswers } from "./types.js";

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

const profileOf = () => applyNodes(buildProfile(answers), answers);

test("после полной карты следующее предложение берётся из её таблицы дверей, не из nextSliceAfter", () => {
  const last = fullMap().nextDoors.at(-1);
  assert.equal(last?.slice, null);
  const offer = selectOfferAfterSlice("slice_full_map", profileOf(), {}, ["slice_full_map"]);
  assert.equal(offer, null);
});

test("несогласие со ступенью 3 не ставит цену на дверь отвергнутого узла", () => {
  const profile = applyDisagreement(profileOf(), { step: 3, kind: "частично" });
  const offer = selectOffer(profile);
  assert.ok(offer);
  assert.notEqual(offer.slice, "slice_node_finish");
  const doors = buildDoors(profile, [], offer, 4);
  for (const door of doors) {
    if (door.slice === "slice_node_finish") assert.equal(door.price, null);
  }
  assert.equal(doors.filter((door) => door.price !== null).length, 1);
});
