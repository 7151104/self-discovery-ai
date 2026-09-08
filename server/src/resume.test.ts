/**
 * Возврат на середине (E3-07).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { answersForStep, call, portionKey, profileAtStep, startTestServer } from "./test-support.js";
import type { PageStateDto, PageStateName } from "./contract/index.js";

const STATES: PageStateName[] = ["s0", "s1", "s2", "s3", "s4", "paid_pending", "paid_done"];

test("профиль с двумя закрытыми ступенями открывается на третьей порции", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 2);

  // Возврат: отдельный запрос без единого следа прошлой сессии.
  const back = await call<PageStateDto>(server.origin, "GET", `/api/p/${created.profileId}`);
  const page = back.body;

  assert.equal(page.state, "s2");
  assert.equal(page.nextPortion?.key, "step:3");
  assert.deepEqual(page.nextPortion?.answered, []);

  // Ответы первых двух ступеней на месте: блоки собраны и не пусты.
  assert.deepEqual(
    page.blocks.map((block) => block.id),
    ["step1", "step2"],
  );
  for (const block of page.blocks) {
    assert.ok(block.paragraphs.length > 0, `блок ${block.id} пуст`);
    assert.equal(block.stale, false);
  }

  // Карта заполнена ответами первых двух ступеней, а не пуста.
  assert.ok(page.map.some((bar) => bar.position !== null));
});

test("обрыв посреди порции: та же порция, отвеченные вопросы помечены", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 2);
  const portion = answersForStep(3);
  const half = portion.slice(0, 2);

  const partial = await call<PageStateDto>(server.origin, "POST", `/api/p/${created.profileId}/portions`, {
    portion: portionKey(3),
    answers: half,
    requestId: "half",
  });

  assert.equal(partial.status, 200);
  assert.equal(partial.body.state, "s2");
  assert.equal(partial.body.nextPortion?.key, "step:3");
  assert.deepEqual(
    partial.body.nextPortion?.answered,
    half.map((answer) => answer.questionId),
  );

  // Возврат по ссылке показывает ровно то же: продолжать с третьего вопроса.
  const back = await call<PageStateDto>(server.origin, "GET", `/api/p/${created.profileId}`);
  assert.deepEqual(
    back.body.nextPortion?.answered,
    half.map((answer) => answer.questionId),
  );

  const rest = await call<PageStateDto>(server.origin, "POST", `/api/p/${created.profileId}/portions`, {
    portion: portionKey(3),
    answers: portion.slice(2),
    requestId: "rest",
  });
  assert.equal(rest.body.state, "s3");
  assert.equal(rest.body.nextPortion?.key, "step:4");
});

test("состояние всегда одно из семи: экрана «вы не завершили» не существует", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 0);
  const seen: PageStateName[] = [created.state];

  for (const step of [1, 2, 3, 4] as const) {
    const full = answersForStep(step);
    const partial = await call<PageStateDto>(server.origin, "POST", `/api/p/${created.profileId}/portions`, {
      portion: portionKey(step),
      answers: full.slice(0, 1),
      requestId: `partial-${step}`,
    });
    seen.push(partial.body.state);

    const done = await call<PageStateDto>(server.origin, "POST", `/api/p/${created.profileId}/portions`, {
      portion: portionKey(step),
      answers: full,
      requestId: `full-${step}`,
    });
    seen.push(done.body.state);
  }

  for (const state of seen) assert.ok(STATES.includes(state), `неизвестное состояние ${state}`);
  assert.equal(seen[seen.length - 1], "s4");
});

test("возврат не теряет несогласие и не пересобирает блок заново", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 3);
  await call(server.origin, "POST", `/api/p/${created.profileId}/disagreements`, {
    blockId: "step3",
    kind: "too_general",
  });

  const back = await call<PageStateDto>(server.origin, "GET", `/api/p/${created.profileId}`);
  const block = back.body.blocks.find((candidate) => candidate.id === "step3");
  assert.ok(block?.disagreed);
  assert.deepEqual(block.paragraphs, created.blocks.find((candidate) => candidate.id === "step3")?.paragraphs);
});
