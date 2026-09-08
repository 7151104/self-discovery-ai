/**
 * Постоянная ссылка на страницу (E3-04).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ID_LENGTH, isValidId, newProfileId } from "./ids.js";
import { call, profileAtStep, startTestServer } from "./test-support.js";
import type { ErrorDto, PageStateDto } from "./contract/index.js";

test("идентификатор неперебираем: 128 бит случайности и никаких повторов", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 5000; index += 1) {
    const id = newProfileId();
    assert.equal(id.length, ID_LENGTH);
    assert.ok(isValidId(id));
    assert.ok(!seen.has(id), "повтор идентификатора");
    seen.add(id);
  }
});

test("профиль создаётся на ступени 0 и сразу имеет постоянный адрес", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", {
    name: "Аня",
    birthDate: null,
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.state, "s0");
  assert.ok(isValidId(created.body.profileId));
  assert.equal(created.body.url, `/p/${created.body.profileId}`);
  assert.equal(created.body.card.name, "Аня");
  // Без даты рождения карточки периода нет, всё остальное работает.
  assert.equal(created.body.card.theme, null);
});

test("ссылка открывается в другом браузере: ни входа, ни куки, то же состояние", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);

  // Второй «браузер»: чистый запрос без единого заголовка сессии.
  const first = await fetch(`${server.origin}/api/p/${page.profileId}`);
  const second = await fetch(`${server.origin}/api/p/${page.profileId}`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get("set-cookie"), null);

  const left = (await first.json()) as PageStateDto;
  const right = (await second.json()) as PageStateDto;
  assert.deepEqual(left, right);
  assert.equal(left.state, "s3");
  assert.equal(left.blocks.length, page.blocks.length);
  assert.deepEqual(
    left.blocks.map((block) => block.id),
    page.blocks.map((block) => block.id),
  );
});

test("адрес /p/{profile_id} отдаёт документ клиента, не временную оболочку", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 1);
  const response = await fetch(`${server.origin}/p/${page.profileId}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /type="module"/);
  assert.match(html, /\/web\/src\/app\.js/);
  assert.ok(!html.includes('data-role="state"'), "вернулась временная оболочка E3-04");
  assert.ok(!html.includes(page.card.name), "имя не должно быть в HTML до запуска клиента");
});

test("перебор соседних идентификаторов ничего не находит", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 1);
  const id = page.profileId;

  const neighbours = [
    `${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`,
    `A${id.slice(1)}`,
    id.slice(0, -1),
    `${id}A`,
    id.toUpperCase() === id ? id.toLowerCase() : id.toUpperCase(),
    "0".repeat(22),
    "../../etc/passwd",
  ];

  for (const candidate of neighbours) {
    if (candidate === id) continue;
    const reply = await call<ErrorDto>(server.origin, "GET", `/api/p/${encodeURIComponent(candidate)}`);
    assert.equal(reply.status, 404, `найден профиль по ${candidate}`);
    assert.ok(reply.body.error.code === "profile_not_found" || reply.body.error.code === "not_found");
  }

  const html = await fetch(`${server.origin}/p/${"0".repeat(22)}`);
  assert.equal(html.status, 404);
});

test("возврат по ссылке открывает ту же незакрытую порцию", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 2);
  const again = await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`);

  assert.equal(again.body.state, "s2");
  assert.equal(again.body.nextPortion?.key, "step:3");
  assert.deepEqual(again.body.nextPortion?.questions.map((question) => question.id), [
    "L8",
    "L9",
    "L10",
    "L11",
  ]);
});
