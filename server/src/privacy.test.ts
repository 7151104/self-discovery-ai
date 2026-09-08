/**
 * Удаление, выгрузка и изоляция даты рождения (E9-03, E9-07).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSlicePortions,
  answersForStep,
  call,
  collectKeys,
  portionKey,
  profileAtStep,
  profileBody,
  purchaseSlice,
  startTestServer,
} from "./test-support.js";
import { listAnswers, listBlocks, listEvents, listOrders, findProfile } from "./store.js";
import { rawContent } from "./engine.js";
import type { ErrorDto, ExportDto, PageStateDto } from "./contract/index.js";

// ── Выгрузка данных (E9-03) ───────────────────────────────────────────────────

test("выгрузка отдаёт ответы, блоки и заказы в читаемом виде", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin);
  const profileId = paid.page.profileId;
  await answerSlicePortions(server.origin, profileId);
  await call(server.origin, "POST", `/api/p/${profileId}/share`);

  const dump = await call<ExportDto>(server.origin, "GET", `/api/p/${profileId}/export`);
  assert.equal(dump.status, 200);

  const body = dump.body;
  assert.equal(body.profileId, profileId);
  assert.equal(body.person.name, "Аня");
  assert.equal(body.person.birthDate, "1990-05-05");
  assert.ok(body.share?.url.includes("/s/"));

  // Ответов столько же, сколько в базе, и каждый — с формулировкой вопроса.
  assert.equal(body.answers.length, listAnswers(server.db, profileId).length);
  for (const answer of body.answers) {
    assert.ok(answer.question.length > 10, `вопрос не развёрнут: ${answer.questionId}`);
    assert.ok(answer.answer.length > 0);
  }

  // Выбранный вариант развёрнут в его текст, а не оставлен ключом «A».
  const ladder = rawContent.questions.find((question) => question.type === "выбор");
  const exported = body.answers.find((answer) => answer.questionId === ladder?.id);
  assert.equal(exported?.answer, ladder?.options[0]?.text);
  assert.equal(exported?.question, ladder?.text);

  assert.ok(body.blocks.length >= 3);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0]?.slice, paid.slice);
});

test("в выгрузке нет внутреннего профиля", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const dump = await call<ExportDto>(server.origin, "GET", `/api/p/${page.profileId}/export`);

  const keys = collectKeys(dump.body);
  for (const forbidden of ["value", "band", "confidence", "code", "flags", "coordinate", "coordinates"]) {
    assert.ok(!keys.has(forbidden), `в выгрузке поле ${forbidden}`);
  }
});

// ── Удаление данных (E9-03) ───────────────────────────────────────────────────

test("удаление профиля уносит ответы, блоки, заказы и публичную ссылку", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin);
  const profileId = paid.page.profileId;
  await answerSlicePortions(server.origin, profileId);
  const share = await call<{ share: { url: string } }>(server.origin, "POST", `/api/p/${profileId}/share`);
  const token = share.body.share.url.split("/s/")[1] ?? "";
  await call(server.origin, "POST", `/api/p/${profileId}/disagreements`, { blockId: "step3", kind: "partly" });

  assert.ok(listAnswers(server.db, profileId).length > 0);
  assert.ok(listBlocks(server.db, profileId).length > 0);
  assert.ok(listOrders(server.db, profileId).length > 0);

  const removed = await call<{ deleted: true }>(server.origin, "DELETE", `/api/p/${profileId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.deleted, true);

  assert.equal(findProfile(server.db, profileId), null);
  assert.equal(listAnswers(server.db, profileId).length, 0);
  assert.equal(listBlocks(server.db, profileId).length, 0);
  assert.equal(listOrders(server.db, profileId).length, 0);
  assert.equal(listEvents(server.db, profileId).length, 0);

  for (const table of ["profile_versions", "portion_submissions", "share_tokens", "order_events", "disagreements", "consents"]) {
    const left = server.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ${table} WHERE profile_id = ?`,
      [profileId],
    );
    assert.equal(left?.total, 0, `${table}: остались записи удалённого профиля`);
  }

  // Страница и публичная ссылка отвечают отказом, повторное удаление тоже.
  assert.equal((await call<ErrorDto>(server.origin, "GET", `/api/p/${profileId}`)).status, 404);
  assert.equal((await call<ErrorDto>(server.origin, "GET", `/api/s/${token}`)).status, 404);
  assert.equal((await call<ErrorDto>(server.origin, "DELETE", `/api/p/${profileId}`)).status, 404);
});

test("запись об удалении не называет удалённого", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 2);
  await call(server.origin, "DELETE", `/api/p/${page.profileId}`);

  const events = server.db.all<{ type: string; profile_id: string | null; payload: string }>(
    "SELECT type, profile_id, payload FROM events ORDER BY created_at",
  );
  const deletion = events.find((event) => event.type === "profile.deleted");
  assert.ok(deletion);
  assert.equal(deletion.profile_id, null);
  assert.equal(deletion.payload, "{}");

  // Прежние события профиля остались в воронке, но потеряли профиль.
  assert.ok(events.some((event) => event.type === "portion.submitted"));
  assert.ok(events.every((event) => event.profile_id !== page.profileId));
});

// ── Изоляция даты рождения (E9-07) ────────────────────────────────────────────

/**
 * Страница без того, что различается у любых двух профилей: идентификаторов,
 * времени и карточки периода. Карточка — единственное место, где дате рождения
 * позволено что-то менять, и то через сезон текущей даты, а не через саму дату.
 */
const withoutIdentity = (page: PageStateDto): unknown => ({
  ...page,
  profileId: "",
  url: "",
  updatedAt: "",
  card: { ...page.card, season: "", theme: "", metaphor: "" },
  blocks: page.blocks.map((block) => ({
    ...block,
    generation: block.generation ? { id: "", status: block.generation.status } : null,
  })),
});

test("дата рождения не влияет ни на один вывод серверного пути", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const birthDates = ["1990-05-05", "1961-12-31", "2004-02-29", null];
  const pages: PageStateDto[] = [];

  for (const birthDate of birthDates) {
    const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", {
      ...profileBody("Аня", birthDate),
    });
    let page = created.body;
    for (const step of [1, 2, 3, 4] as const) {
      const reply = await call<PageStateDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
        portion: portionKey(step),
        answers: answersForStep(step),
        requestId: `step-${step}`,
      });
      page = reply.body;
    }
    pages.push(page);
  }

  const [reference, ...rest] = pages;
  assert.ok(reference);
  for (const page of rest) {
    assert.deepEqual(withoutIdentity(page), withoutIdentity(reference), "дата рождения изменила вывод");
  }

  // Тексты блоков, фраза и карта совпадают дословно.
  for (const page of rest) {
    assert.deepEqual(
      page.blocks.map((block) => [block.heading, block.highlight, ...block.paragraphs]),
      reference.blocks.map((block) => [block.heading, block.highlight, ...block.paragraphs]),
    );
    assert.equal(page.hook, reference.hook);
    assert.deepEqual(page.map, reference.map);
    assert.deepEqual(page.doors, reference.doors);
    assert.deepEqual(page.offer, reference.offer);
  }
});

test("тема периода не попадает ни в один текст разбора", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const theme = page.card.theme;
  const metaphor = page.card.metaphor;
  assert.ok(theme, "у карточки нет темы периода — проверять нечего");

  // Тема и метафора живут только в карточке входа.
  const texts = [
    ...page.blocks.flatMap((block) => [block.heading, block.highlight ?? "", ...block.paragraphs]),
    page.hook ?? "",
    ...page.map.map((bar) => `${bar.label} ${bar.hint}`),
    ...page.doors.map((door) => door.title),
    page.offer?.promise ?? "",
  ].join(" ");

  assert.ok(!texts.includes(theme), "тема периода попала в текст разбора");
  if (metaphor) assert.ok(!texts.includes(metaphor), "метафора периода попала в текст разбора");
});
