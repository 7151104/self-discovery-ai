/**
 * Загрузка состояния с живого сервера: ссылка открывает страницу,
 * несуществующий профиль — понятную страницу без технических подробностей.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProfile, disagree, enableShare, loadGeneration, loadPage, loadPublic, revokeShare } from "./api.js";
import { visibleText } from "./dom.js";
import { filledBars } from "./page.js";
import { missingTexts } from "./page-copy.js";
import { repoRoot } from "./paths.js";
import { renderMissing } from "../components/missing.js";

const { startTestServer, profileAtStep } = (await import(
  pathToFileURL(join(repoRoot, "server/dist/test-support.js")).href
)) as typeof import("../../server/dist/test-support.js");

const MISSING_ID = "aaaaaaaaaaaaaaaaaaaaaa";
const TECHNICAL = ["404", "profile_not_found", "internal_error", "stack", "TypeError"];

test("создание профиля и загрузка по /api/p/{id} отдают состояние страницы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const transport = { fetch, origin: server.origin };

  const created = await createProfile({ name: "Аня", birthDate: null }, transport);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.page.state, "s0");
  assert.equal(created.page.card.name, "Аня");
  assert.equal(created.page.card.theme, null);

  const loaded = await loadPage(created.page.profileId, transport);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.page.profileId, created.page.profileId);
  assert.match(created.page.url, /^\/p\//);
});

test("несуществующий профиль даёт missing без технических подробностей", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const result = await loadPage(MISSING_ID, { fetch, origin: server.origin });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.missing, true);

  const node = renderMissing({
    title: missingTexts.title(),
    text: missingTexts.text(),
    action: missingTexts.action(),
  });
  const text = visibleText(node);
  for (const leak of TECHNICAL) {
    assert.equal(text.toLowerCase().includes(leak.toLowerCase()), false, `в тексте «${leak}»`);
  }
});

test("карта на реальных данных растёт 3 → 5 → 7", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const s0 = await profileAtStep(server.origin, 0);
  const s1 = await profileAtStep(server.origin, 1);
  const s2 = await profileAtStep(server.origin, 2);
  const s3 = await profileAtStep(server.origin, 3);
  assert.equal(filledBars(s0), 0);
  assert.equal(filledBars(s1), 3);
  assert.equal(filledBars(s2), 5);
  assert.equal(filledBars(s3), 7);
});

test("клиент отправляет несогласие и получает страницу с тем же текстом блока", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const transport = { fetch, origin: server.origin };
  const page = await profileAtStep(server.origin, 3);
  const before = page.blocks.find((item) => item.id === "step1");
  assert.ok(before);
  const result = await disagree(page.profileId, "step1", "not_about_me", transport);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const after = result.page.blocks.find((item) => item.id === "step1");
  assert.ok(after?.disagreed);
  assert.deepEqual(after.paragraphs, before.paragraphs);
});

test("клиент включает и отзывает публичную ссылку", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const transport = { fetch, origin: server.origin };
  const page = await profileAtStep(server.origin, 3);
  const enabled = await enableShare(page.profileId, transport);
  assert.equal(enabled.ok, true);
  if (!enabled.ok) return;
  assert.ok(enabled.share?.url.startsWith("/s/"));
  const token = enabled.share?.url.split("/s/")[1] ?? "";
  const view = await loadPublic(token, transport);
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.deepEqual(
    view.page.blocks.map((item) => item.id),
    ["step1", "step2"],
  );
  assert.equal("profileId" in view.page, false);

  const revoked = await revokeShare(page.profileId, transport);
  assert.equal(revoked.ok, true);
  const missing = await loadPublic(token, transport);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.missing, true);
});

test("клиент читает статус генерации по идентификатору из блока", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  const pending = page.blocks.find((item) => item.id === "step4")?.generation;
  assert.ok(pending?.id);
  const status = await loadGeneration(page.profileId, pending.id, { fetch, origin: server.origin });
  assert.equal(status.ok, true);
  if (!status.ok) return;
  assert.equal(status.generation.status, "pending");
  assert.equal(status.generation.id, pending.id);
});

