/**
 * E4-12: в журнал отказа не попадает фраза человека.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { failureNotesForLog, stripQuotedFailureDetail } from "./failure-notes.js";
import { describeRegisterProblem } from "./registers.js";
import { describeViolation } from "./validator.js";

const PERSON_PHRASE = "Крендельковый пирог я тащу сам и никого не подключаю к кругу";

test("хвост с фразой человека отрезается от описания регистра", () => {
  const raw = describeRegisterProblem({
    kind: "цитата не из ответа",
    phrase: PERSON_PHRASE,
    detail: "в открытом ответе такой последовательности слов нет",
  });
  assert.ok(raw.includes(PERSON_PHRASE), "описатель больше не кладёт фразу в хвост");
  const stripped = stripQuotedFailureDetail(raw);
  assert.equal(stripped.includes(PERSON_PHRASE), false, `фраза осталась после очистки: ${stripped}`);
  assert.ok(stripped.startsWith("цитата не из ответа"));
  assert.ok(stripped.includes("последовательности слов нет"));
});

test("машинный код журнала не содержит фразы ни из регистра, ни из валидатора", () => {
  const register = describeRegisterProblem({
    kind: "регистр сильнее confidence",
    phrase: PERSON_PHRASE,
    detail: "вид «вероятность» при confidence low координаты 7",
  });
  const violation = describeViolation({
    rule: "реестр",
    group: "FORBIDDEN_LABEL",
    detail: `«${PERSON_PHRASE.slice(0, 20)}» (лень): оценка вместо описания`,
  });
  const notes = failureNotesForLog([register, violation]);
  assert.equal(notes.includes(PERSON_PHRASE), false, notes);
  assert.equal(notes.includes("Крендельковый"), false, notes);
  assert.match(notes, /quote_not_from_answer|register_gt_confidence/);
  assert.match(notes, /FORBIDDEN_LABEL/);
  assert.match(notes, /^[A-Za-z0-9_.,]+$/);
});
