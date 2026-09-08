/**
 * Подписи закрытых дверей (E5-05).
 *
 * Дверь на карте подписана механизмом человека, а не названием среза. Реестры
 * живут в `content/doors.md`, состав узлов — в коде (`nodes.ts`), состав срезов —
 * в `content/slices/README.md`. Тест держит их вместе: узел или срез, добавленный
 * без подписи двери, ломает сборку продукта здесь, а не в интерфейсе.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";
import { NODE_RULES, FALLBACK_NODE_ID } from "./nodes.js";

const doors = rawExtraContent.doors;

/** Прикладные срезы: их дверь подписывается механизмом в области жизни. */
const appliedSlices = rawContent.slices
  .filter((slice) => slice.file && slice.questionCount === "20")
  .map((slice) => slice.id);

const SECOND_PERSON = /(?:^|[^а-яёa-z])(ты|теб[еяю]|тобой|тво[йяеиё])(?:[^а-яёa-z]|$)/i;

test("у каждого узла есть подпись двери", () => {
  for (const rule of NODE_RULES) {
    const label = doors.nodes[rule.id];
    assert.ok(label, `${rule.id}: нет подписи двери в content/doors.md`);
    assert.ok((label?.length ?? 0) > 15, `${rule.id}: подпись двери слишком короткая`);
  }
  assert.equal(
    Object.keys(doors.nodes).length,
    NODE_RULES.length,
    "в content/doors.md подписаны узлы, которых нет в движке",
  );
  assert.ok(
    !(FALLBACK_NODE_ID in doors.nodes),
    `${FALLBACK_NODE_ID} узлом не считается: двери под профиль у него быть не может`,
  );
});

test("у каждого среза есть подпись двери", () => {
  for (const slice of rawContent.slices) {
    const label = doors.slices[slice.id];
    assert.ok(label, `${slice.id}: нет общей подписи двери в content/doors.md`);
    assert.ok((label?.length ?? 0) > 15, `${slice.id}: подпись двери слишком короткая`);
  }
  const known = new Set(rawContent.slices.map((slice) => slice.id));
  for (const id of Object.keys(doors.slices)) {
    assert.ok(known.has(id), `${id}: подписана дверь среза, которого нет в content/slices/README.md`);
  }
});

test("подпись двери не повторяет название среза", () => {
  // Смысл задачи: дверь называет механизм человека, а не товар.
  for (const slice of rawContent.slices) {
    assert.notEqual(
      doors.slices[slice.id],
      slice.title,
      `${slice.id}: подпись двери совпала с названием среза`,
    );
  }
});

test("у каждого узла подписана каждая прикладная дверь", () => {
  assert.ok(appliedSlices.length >= 2, "прикладных срезов меньше двух — таблица срезов сломалась");
  for (const rule of NODE_RULES) {
    const row = doors.applied[rule.id];
    assert.ok(row, `${rule.id}: нет строки в таблице прикладных дверей`);
    for (const sliceId of appliedSlices) {
      assert.ok(row && sliceId in row, `${rule.id}: не подписана прикладная дверь ${sliceId}`);
    }
  }
  for (const [nodeId, row] of Object.entries(doors.applied)) {
    for (const sliceId of Object.keys(row)) {
      assert.ok(
        appliedSlices.includes(sliceId),
        `${nodeId}: подписана прикладная дверь ${sliceId}, но такого прикладного среза нет`,
      );
    }
  }
});

test("прочерк в прикладной двери стоит только у собственного среза узла", () => {
  for (const [nodeId, row] of Object.entries(doors.applied)) {
    for (const [sliceId, label] of Object.entries(row)) {
      if (label === null) {
        assert.equal(
          rawContent.step3.offers[nodeId],
          sliceId,
          `${nodeId} × ${sliceId}: прочерк допустим только там, где это собственный срез узла`,
        );
        continue;
      }
      assert.ok(label.length > 15, `${nodeId} × ${sliceId}: подпись двери слишком короткая`);
    }
  }
});

test("подписи дверей не повторяются между собой", () => {
  const applied = Object.values(doors.applied).flatMap((row) =>
    Object.values(row).filter((label): label is string => label !== null),
  );
  const all = [...Object.values(doors.nodes), ...Object.values(doors.slices), ...applied];
  assert.equal(new Set(all).size, all.length, "одна и та же подпись стоит у разных дверей");
});

test("подписи дверей написаны на «ты», без методик, цен и обещаний", () => {
  const forbidden =
    /(MBTI|эннеаграмм|Human Design|астролог|нумеролог|Big Five|соционик|предназначен|вибраци|карм[аеуы]|миссия|потенциал|₽|тест|гарантир|наконец)/i;
  const applied = Object.entries(doors.applied).flatMap(([nodeId, row]) =>
    Object.entries(row)
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([sliceId, label]) => [`${nodeId} × ${sliceId}`, label] as const),
  );
  const labels = [
    ...Object.entries(doors.nodes),
    ...Object.entries(doors.slices),
    ...applied,
  ] as (readonly [string, string])[];

  for (const [key, label] of labels) {
    assert.ok(!forbidden.test(label), `${key}: запрещённая формулировка в подписи двери — ${label}`);
    assert.ok(!/\bвы\b|ваш/i.test(label), `${key}: обращение не на «ты» — ${label}`);
    assert.ok(!/[.!?]$/.test(label), `${key}: подпись двери — не предложение с точкой`);
    assert.equal(label, label.trim(), `${key}: подпись не обрезана по краям`);
  }

  // Подпись под профиль говорит человеку про него, а не про тему вообще.
  for (const [nodeId, label] of Object.entries(doors.nodes)) {
    assert.ok(SECOND_PERSON.test(label), `${nodeId}: подпись под профиль не обращается к человеку`);
  }
});

test("подпись двери не пересказывает текст узла", () => {
  for (const node of rawContent.step3.nodes) {
    const label = doors.nodes[node.id];
    if (!label) continue;
    const firstSentence = node.text.split(/(?<=[.!?])\s/)[0] ?? "";
    assert.ok(
      !firstSentence.toLowerCase().includes(label.toLowerCase()),
      `${node.id}: подпись двери дословно повторяет начало текста узла`,
    );
  }
});
