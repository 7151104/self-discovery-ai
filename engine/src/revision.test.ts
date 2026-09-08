/** E2-09: правка ответа пересобирает бесплатные блоки и щадит купленные. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPage, emptyHistory, recordPurchase, reviseAnswers, slotOf } from "./index.js";
import type { Block, LadderAnswers, StoredBlock } from "./index.js";

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
};

const shownBlocks = (source: LadderAnswers): StoredBlock[] =>
  buildPage(person, source).view.blocks.map((block) => ({ slot: slotOf(block), block, purchased: false }));

/** Купленный блок платного среза: движок его не собирает, он приходит из базы. */
const paidBlock = (): Block => ({
  step: 4,
  heading: "Почему ты бросаешь у финиша",
  paragraphs: ["Ты доводишь дело до восьмидесяти процентов и там останавливаешься."],
  highlight: "Обрыв случается не от усталости, а перед показом.",
  source: "llm",
});

test("правка L2 меняет блок ступени 1 и помечает его обновлённым", () => {
  const shown = shownBlocks(answers);
  const revision = reviseAnswers({ input: person, before: answers, after: { ...answers, L2: "A" }, shown });

  const step1 = revision.blocks.find((block) => block.slot === "step1")!;
  assert.equal(step1.state, "обновился");
  assert.notDeepEqual(step1.block?.paragraphs, shown[0]!.block.paragraphs, "текст ступени 1 обязан пересобраться");
  assert.deepEqual(
    revision.changedAnswers.map((change) => change.question),
    ["L2"],
  );
  assert.equal(revision.changedAnswers[0]?.before, "C");
  assert.equal(revision.changedAnswers[0]?.after, "A");
});

test("блоки, которых правка не касалась, остаются без изменений", () => {
  const shown = shownBlocks(answers);
  const revision = reviseAnswers({ input: person, before: answers, after: { ...answers, L7: 4 }, shown });

  const step1 = revision.blocks.find((block) => block.slot === "step1")!;
  assert.equal(step1.state, "без изменений", "L7 в блок ступени 1 не входит");
  assert.deepEqual(step1.block, shown[0]!.block);
});

test("правка без правок: пересчёт есть, пометок нет, версия не пишется", () => {
  const shown = shownBlocks(answers);
  const revision = reviseAnswers({ input: person, before: answers, after: { ...answers }, shown });

  assert.deepEqual(revision.changedAnswers, []);
  assert.ok(revision.blocks.every((block) => block.state === "без изменений"));
  assert.equal(revision.history.entries.length, 0, "снимок без изменения ответов не нужен");
});

test("купленный блок остаётся дословно тем же и получает отметку расхождения", () => {
  const purchased = paidBlock();
  const atPurchase = buildPage(person, answers).internal.profile;
  const history = recordPurchase(emptyHistory(), atPurchase, "slice_node_finish");

  const shown: StoredBlock[] = [
    ...shownBlocks(answers),
    { slot: "slice:slice_node_finish", block: purchased, purchased: true },
  ];

  const revision = reviseAnswers({
    input: person,
    before: answers,
    after: { ...answers, L2: "A" },
    shown,
    history,
  });

  const paid = revision.blocks.find((block) => block.slot === "slice:slice_node_finish")!;
  assert.equal(paid.state, "оставлен как есть");
  assert.deepEqual(paid.block, purchased, "купленный текст не меняется ни одним символом");
  assert.equal(paid.block?.paragraphs[0], purchased.paragraphs[0]);
  assert.ok(paid.divergence, "к купленному блоку добавляется отметка расхождения");
  assert.ok(
    paid.divergence?.coordinates.some((coordinate) => coordinate.coordinate === 11),
    "правка L2 меняет координату 11 — она и есть расхождение",
  );

  const free = revision.blocks.find((block) => block.slot === "step1")!;
  assert.equal(free.state, "обновился", "бесплатный блок при этом пересобирается");
});

test("купленный блок без расхождения отметки не получает", () => {
  const purchased = paidBlock();
  const atPurchase = buildPage(person, answers).internal.profile;
  const history = recordPurchase(emptyHistory(), atPurchase, "slice_node_finish");

  const revision = reviseAnswers({
    input: person,
    before: answers,
    after: answers,
    shown: [{ slot: "slice:slice_node_finish", block: purchased, purchased: true }],
    history,
  });

  const paid = revision.blocks[0]!;
  assert.equal(paid.state, "без изменений");
  assert.equal(paid.divergence, null);
});

test("правка ответа пишет версию профиля с причиной и изменёнными вопросами", () => {
  const revision = reviseAnswers({
    input: person,
    before: answers,
    after: { ...answers, L2: "A", L6: 2 },
    shown: shownBlocks(answers),
    history: emptyHistory(),
  });

  assert.equal(revision.history.entries.length, 1);
  const snapshot = revision.history.entries[0]!;
  assert.equal(snapshot.reason, "правка ответа");
  assert.equal(snapshot.detail, "L2, L6");
  assert.equal(snapshot.profile.coordinates[11]?.code, revision.page.internal.profile.coordinates[11]?.code);
});

test("снятый ответ убирает блок, а не оставляет его врать", () => {
  const shown = shownBlocks(answers);
  const without: LadderAnswers = { ...answers };
  delete without.L3;

  const revision = reviseAnswers({ input: person, before: answers, after: without, shown });
  const step1 = revision.blocks.find((block) => block.slot === "step1")!;

  assert.equal(step1.state, "обновился");
  assert.equal(step1.block, null, "без L3 блок ступени 1 не собирается");
});

test("пересчёт отдаёт свежую страницу, а не старую", () => {
  const revision = reviseAnswers({
    input: person,
    before: answers,
    after: { ...answers, L2: "E" },
    shown: shownBlocks(answers),
  });

  assert.equal(revision.page.internal.profile.coordinates[11]?.code, "completes");
  assert.ok(revision.page.view.map.length > 0);
});
