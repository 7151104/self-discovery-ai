/**
 * Публичный режим страницы (E3-08) и приватность по умолчанию с токеном
 * шеринга (E3-09).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { call, collectKeys, FORBIDDEN_FIELDS, profileAtStep, startTestServer } from "./test-support.js";
import { assemblePublic } from "./page.js";
import { assertNoPrivateBlocks, ResponseLeak } from "./http/guard.js";
import { newProfileId } from "./ids.js";
import type { PageStateDto, PublicPageDto, ShareDto } from "./contract/index.js";

interface ShareBody {
  share: ShareDto | null;
  page: PageStateDto;
}

const tokenOf = (url: string): string => url.slice(url.lastIndexOf("/") + 1);

test("до нажатия «Поделиться» публичная ссылка отвечает отказом", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 3);
  assert.equal(created.share, null);

  // Ни идентификатор профиля, ни выдуманный токен публичного вида не открывают.
  for (const token of [created.profileId, newProfileId()]) {
    const reply = await call(server.origin, "GET", `/api/s/${token}`);
    assert.equal(reply.status, 404);
  }
});

test("публичный вид отдаёт карту, фразу и первые два блока", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 4);
  const shared = await call<ShareBody>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  assert.equal(shared.status, 200);

  const url = shared.body.share?.url ?? "";
  assert.ok(url.includes("/s/"));
  assert.ok(!url.includes(created.profileId), "публичная ссылка не должна содержать идентификатор профиля");

  const view = await call<PublicPageDto>(server.origin, "GET", `/api/s/${tokenOf(url)}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.name, created.card.name);
  assert.ok(view.body.hook);
  assert.equal(view.body.map.length, created.map.length);
  assert.deepEqual(
    view.body.blocks.map((block) => block.id),
    ["step1", "step2"],
  );
});

test("в публичном ответе нет текстов блоков 3 и 4 ни в одном поле", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 4);
  const shared = await call<ShareBody>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  const token = tokenOf(shared.body.share?.url ?? "");

  const view = await call<PublicPageDto>(server.origin, "GET", `/api/s/${token}`);
  const text = JSON.stringify(view.body);

  const hidden = created.blocks.filter((block) => block.id === "step3" || block.id === "step4");
  assert.ok(hidden.length >= 1);
  for (const block of hidden) {
    for (const paragraph of [block.heading, ...block.paragraphs, block.highlight ?? ""]) {
      if (!paragraph) continue;
      assert.ok(!text.includes(paragraph), `в публичный вид попал текст блока ${block.id}`);
    }
    assert.ok(!text.includes(`"${block.id}"`), `в публичный вид попало место блока ${block.id}`);
  }

  // Граница проходит не по словам, а по блокам. Фраза-крючок публична по
  // замыслу (`docs/11-ui-page-spec.md`, «Виральность»: скриншотятся крючок и
  // карта), и она же открывает блок 3. Разбор за ней не уходит: проверяем
  // остаток абзаца после крючка.
  const hook = created.hook ?? "";
  assert.ok(hook.length > 0);
  for (const block of hidden) {
    for (const paragraph of block.paragraphs) {
      const rest = paragraph.startsWith(hook) ? paragraph.slice(hook.length).trim() : paragraph;
      if (rest.length < 30) continue;
      assert.ok(!text.includes(rest), `за крючком в публичный вид ушёл разбор блока ${block.id}`);
    }
  }

  // Заодно: ни координат, ни адреса личной страницы, ни идентификатора профиля.
  const keys = collectKeys(view.body);
  for (const field of FORBIDDEN_FIELDS) assert.ok(!keys.has(field), `публичный вид отдал ${field}`);
  for (const field of ["profileId", "url", "doors", "offer", "nextPortion", "share"]) {
    assert.ok(!keys.has(field), `публичный вид отдал ${field}`);
  }

  // То же в HTML публичного вида: он собирается из того же типа.
  const html = await fetch(`${server.origin}/s/${token}`);
  const markup = await html.text();
  assert.equal(html.status, 200);
  for (const block of hidden) {
    for (const paragraph of block.paragraphs) assert.ok(!markup.includes(paragraph));
  }
});

test("повторное «Поделиться» отдаёт ту же ссылку, отзыв её выключает", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 3);
  const first = await call<ShareBody>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  const again = await call<ShareBody>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  assert.equal(first.body.share?.url, again.body.share?.url);

  const token = tokenOf(first.body.share?.url ?? "");
  assert.equal((await call(server.origin, "GET", `/api/s/${token}`)).status, 200);

  // Владелец видит в своём состоянии, что страница открыта.
  const owner = await call<PageStateDto>(server.origin, "GET", `/api/p/${created.profileId}`);
  assert.equal(owner.body.share?.url, first.body.share?.url);

  const revoked = await call<ShareBody>(server.origin, "DELETE", `/api/p/${created.profileId}/share`, null);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.share, null);
  assert.equal(revoked.body.page.share, null);

  assert.equal((await call(server.origin, "GET", `/api/s/${token}`)).status, 404);
  assert.equal((await fetch(`${server.origin}/s/${token}`)).status, 404);

  // Новая ссылка выдаётся другая, старая остаётся мёртвой.
  const reopened = await call<ShareBody>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  const fresh = tokenOf(reopened.body.share?.url ?? "");
  assert.notEqual(fresh, token);
  assert.equal((await call(server.origin, "GET", `/api/s/${fresh}`)).status, 200);
  assert.equal((await call(server.origin, "GET", `/api/s/${token}`)).status, 404);
});

test("публичный вид не собрать из блоков 3 и 4: их не пропускает сборка", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 4);
  const view = assemblePublic(created);
  assert.deepEqual(
    view.blocks.map((block) => block.id),
    ["step1", "step2"],
  );

  // @ts-expect-error место блока 3 не входит в тип публичного блока
  view.blocks.push({ id: "step3", heading: "узел", paragraphs: [], highlight: null });

  // @ts-expect-error и купленный срез тоже
  view.blocks.push({ id: "slice:slice_node_finish", heading: "срез", paragraphs: [], highlight: null });

  // Проверка на выходе ловит то, что обошло типы приведением.
  assert.throws(() => assertNoPrivateBlocks(view), ResponseLeak);
});

test("публичный вид у профиля на нулевой ступени пуст, но не ломается", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 0);
  const shared = await call<ShareBody>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  const view = await call<PublicPageDto>(server.origin, "GET", `/api/s/${tokenOf(shared.body.share?.url ?? "")}`);

  assert.equal(view.status, 200);
  assert.equal(view.body.state, "s0");
  assert.deepEqual(view.body.blocks, []);
  assert.equal(view.body.hook, null);
  // Полосы карты есть, но пустые: заполнять их нечем.
  assert.ok(view.body.map.every((bar) => bar.position === null));
});
