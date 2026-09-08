/** E2-10: версии профиля — снимок на каждое изменение и разница с текущим. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDisagreement,
  applySlice,
  buildProfile,
  diffProfiles,
  diffSincePurchase,
  emptyHistory,
  isSameProfile,
  latestSnapshot,
  purchasedSlices,
  recordPurchase,
  recordSnapshot,
  snapshotAt,
  snapshotAtPurchase,
} from "./index.js";
import { applyNodes } from "./nodes.js";
import { demoProfile, sliceAnswers } from "./slice-fixtures.js";
import type { LadderAnswers } from "./types.js";

const step3: LadderAnswers = { L1: "B", L2: "C", L3: "A", L4: "B", L5: "D", L6: 5, L7: 2, L8: "A", L9: 5, L10: 4, L11: 4 };

const profileOf = (answers: LadderAnswers): ReturnType<typeof buildProfile> =>
  applyNodes(buildProfile(answers), answers);

test("снимок хранит копию профиля, а не ссылку на живой", () => {
  const profile = profileOf(step3);
  const history = recordSnapshot(emptyHistory(), profile, "ответы", "ступень 3");

  profile.coordinates[11]!.confidence = "low";
  profile.flags.push("подделано");

  const snapshot = latestSnapshot(history)!;
  assert.notEqual(snapshot.profile.coordinates[11]?.confidence, "low", "снимок изменился вместе с профилем");
  assert.ok(!snapshot.profile.flags.includes("подделано"));
});

test("у каждой версии есть номер и причина", () => {
  let history = emptyHistory();
  history = recordSnapshot(history, profileOf({ L1: "B", L2: "C", L3: "A" }), "ответы", "ступень 1");
  history = recordSnapshot(history, profileOf(step3), "ответы", "ступень 3");
  history = recordPurchase(history, profileOf(step3), "slice_node_finish");

  assert.deepEqual(
    history.entries.map((entry) => [entry.version, entry.reason, entry.detail]),
    [
      [1, "ответы", "ступень 1"],
      [2, "ответы", "ступень 3"],
      [3, "покупка", "slice_node_finish"],
    ],
  );
  assert.equal(snapshotAt(history, 2)?.reason, "ответы");
  assert.deepEqual(purchasedSlices(history), ["slice_node_finish"]);
});

test("профиль на момент покупки восстанавливается и отличается от текущего", () => {
  const atPurchase = demoProfile();
  const history = recordPurchase(emptyHistory(), atPurchase, "slice_node_finish");

  const current = applySlice("slice_node_finish", atPurchase, sliceAnswers("slice_node_finish"));

  const restored = snapshotAtPurchase(history, "slice_node_finish");
  assert.ok(restored, "снимок покупки обязан находиться по идентификатору среза");
  assert.deepEqual(restored.profile.coordinates[11], atPurchase.coordinates[11], "восстановлен именно тот профиль");

  const diff = diffSincePurchase(history, "slice_node_finish", current)!;
  assert.ok(!isSameProfile(diff), "после добора профиль обязан отличаться от снимка покупки");
  assert.ok(
    diff.coordinates.some((coordinate) => coordinate.coordinate === 11),
    "добор slice_node_finish уточняет координату 11 — это должно быть видно в разнице",
  );

  const eleven = diff.coordinates.find((coordinate) => coordinate.coordinate === 11)!;
  assert.equal(eleven.before?.code, atPurchase.coordinates[11]?.code);
  assert.equal(eleven.after.code, current.coordinates[11]?.code);
  assert.ok(eleven.changes.includes("значение"));
});

test("разница видит открывшиеся координаты, флаги и смену узла", () => {
  const before = profileOf({ L1: "B", L2: "C", L3: "A" });
  const after = profileOf(step3);
  const diff = diffProfiles(before, after);

  const opened = diff.coordinates.filter((coordinate) => coordinate.changes.includes("открылась"));
  assert.ok(opened.length > 0, "ответы ступеней 2 и 3 открывают новые координаты");
  assert.ok(opened.every((coordinate) => coordinate.before === null));
  assert.deepEqual(diff.node, { before: null, after: after.dominantNode });
});

test("несогласие видно в разнице как потеря уверенности и новый флаг", () => {
  const before = profileOf(step3);
  const after = applyDisagreement(before, { step: 1, kind: "это не про меня" });
  const diff = diffProfiles(before, after);

  assert.ok(!isSameProfile(diff));
  assert.ok(diff.addedFlags.includes("disagreement_step_1"));
  for (const coordinate of diff.coordinates) {
    assert.ok(
      coordinate.changes.includes("уверенность") || coordinate.changes.includes("флаги"),
      `координата ${coordinate.coordinate}: несогласие меняет только уверенность и флаги`,
    );
  }
});

test("разница с самим собой пуста", () => {
  const profile = profileOf(step3);
  assert.ok(isSameProfile(diffProfiles(profile, profile)));
  assert.equal(diffSincePurchase(emptyHistory(), "slice_node_finish", profile), null, "покупки не было — сравнивать не с чем");
});
