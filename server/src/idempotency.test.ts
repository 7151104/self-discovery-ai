/**
 * Сохранение порции и идемпотентность (E3-05).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { answersForStep, call, portionKey, profileBody, startTestServer } from "./test-support.js";
import { countProfileVersions, countSubmissions, listAnswers } from "./store.js";
import type { PageStateDto } from "./contract/index.js";

async function newProfile(origin: string): Promise<string> {
  const created = await call<PageStateDto>(origin, "POST", "/api/profiles", profileBody("Аня", null));
  return created.body.profileId;
}

test("одна и та же порция, отправленная трижды, даёт один набор ответов и один пересчёт", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const profileId = await newProfile(server.origin);
  const payload = { portion: portionKey(1), answers: answersForStep(1), requestId: "one" };

  const replies = [
    await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, payload),
    await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, payload),
    await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, payload),
  ];

  for (const reply of replies) assert.equal(reply.status, 200);

  const answers = listAnswers(server.db, profileId);
  assert.equal(answers.length, answersForStep(1).length);
  assert.deepEqual(
    answers.map((answer) => answer.revision),
    answers.map(() => 1),
  );

  assert.equal(countProfileVersions(server.db, profileId), 1);
  assert.equal(countSubmissions(server.db, profileId), 1);

  // Повтор отвечает тем же состоянием, а не отказом «уже отправлено».
  assert.equal(replies[0]?.body.state, "s1");
  assert.deepEqual(replies[2]?.body.blocks, replies[0]?.body.blocks);
});

test("повтор не плодит и событий: воронка не считает одну порцию за три", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const profileId = await newProfile(server.origin);
  const payload = { portion: portionKey(1), answers: answersForStep(1), requestId: "one" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await call(server.origin, "POST", `/api/p/${profileId}/portions`, payload);
  }

  const { listEvents } = await import("./store.js");
  const submitted = listEvents(server.db, profileId).filter((event) => event.type === "portion.submitted");
  assert.equal(submitted.length, 1);
});

test("другой ключ отправки — это новая отправка, а не повтор", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const profileId = await newProfile(server.origin);
  const answers = answersForStep(1);

  await call(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(1),
    answers,
    requestId: "first",
  });
  await call(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(1),
    answers,
    requestId: "second",
  });

  assert.equal(countSubmissions(server.db, profileId), 2);
  assert.equal(countProfileVersions(server.db, profileId), 2);
  // Ответы те же самые, просто переписанные: набор не удваивается.
  assert.equal(listAnswers(server.db, profileId).length, answers.length);
});

test("ключи отправки не общие между профилями", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const first = await newProfile(server.origin);
  const second = await newProfile(server.origin);
  const payload = { portion: portionKey(1), answers: answersForStep(1), requestId: "same-key" };

  await call(server.origin, "POST", `/api/p/${first}/portions`, payload);
  const reply = await call<PageStateDto>(server.origin, "POST", `/api/p/${second}/portions`, payload);

  assert.equal(reply.body.state, "s1");
  assert.equal(countSubmissions(server.db, second), 1);
  assert.equal(listAnswers(server.db, second).length, answersForStep(1).length);
});

test("отправка без ключа отклоняется: без него защиты от дублей нет", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const profileId = await newProfile(server.origin);
  const reply = await call(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
  });

  assert.equal(reply.status, 400);
  assert.equal(listAnswers(server.db, profileId).length, 0);
});
