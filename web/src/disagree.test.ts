/**
 * Приёмка E7-07: механика «не согласен с этим».
 *
 * Выбор из трёх вариантов, POST на сервер, текст блока тот же, полоса
 * затронутой координаты становится предположительной, купленный срез на месте.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findAll, visibleText } from "./dom.js";
import { byClass } from "./test-support.js";
import { createPageApp, type AppHost } from "./app.js";
import { copy } from "./copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";

const { startTestServer, answersForStep, profileAtStep, profileAtPaidState } = (await import(
  pathToFileURL(join(repoRoot, "server/dist/test-support.js")).href
)) as typeof import("../../server/dist/test-support.js");

const reducedMotion = (): MotionHost => ({
  matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION_QUERY }),
  setTimeout: (handler) => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
});

const hostOf = (origin: string, pathname: string): AppHost => {
  const location = { pathname };
  return {
    location,
    origin,
    fetch,
    history: {
      pushState: (_data, _title, url) => {
        location.pathname = new URL(String(url), origin).pathname;
      },
    },
    motion: reducedMotion(),
  };
};

async function openPage(origin: string, profileId: string) {
  const host = hostOf(origin, `/p/${profileId}`);
  const app = createPageApp(host);
  await app.start();
  return app;
}

test("после несогласия полоса становится предположительной, текст блока тот же", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);
  const app = await openPage(server.origin, page.profileId);
  const before = app.session().page;
  assert.ok(before);
  const block = before.blocks.find((item) => item.id === "step1");
  assert.ok(block);
  const preciseBefore = new Set(before.map.filter((bar) => bar.fill === "precise").map((bar) => bar.id));

  app.openDisagree("step1");
  const kinds = findAll(app.tree(), "button").filter((item) => item.attrs["data-action"] === "disagree-kind");
  assert.deepEqual(
    kinds.map((item) => item.attrs["data-kind"]),
    ["not_about_me", "partly", "too_general"],
  );
  assert.ok(visibleText(app.tree()).includes(copy("UI_DISAGREE_TITLE")));

  await app.pickDisagree("step1", "not_about_me");
  const after = app.session().page;
  assert.ok(after);
  const updated = after.blocks.find((item) => item.id === "step1");
  assert.ok(updated);
  assert.equal(updated.disagreed, true);
  assert.deepEqual(updated.paragraphs, block.paragraphs);
  assert.equal(updated.highlight, block.highlight);
  assert.ok(
    after.map.some((bar) => bar.fill === "approximate" && preciseBefore.has(bar.id)),
    "ни одна точная полоса не стала предположительной",
  );
  assert.ok(visibleText(app.tree()).includes(copy("UI_DISAGREE_DONE")));
  assert.ok(visibleText(app.tree()).includes(copy("UI_BLOCK_DISAGREE_DONE")));
  assert.equal(app.session().disagreeing, null);
});

test("несогласие сохранено на сервере: повторная загрузка видит его", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);
  const app = await openPage(server.origin, page.profileId);
  await app.pickDisagree("step2", "partly");
  assert.equal(app.session().page?.blocks.find((item) => item.id === "step2")?.disagreed, true);

  const again = await openPage(server.origin, page.profileId);
  assert.equal(again.session().page?.blocks.find((item) => item.id === "step2")?.disagreed, true);
});

test("купленный срез после несогласия с бесплатным блоком остаётся на месте", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtPaidState(server.origin, server.db, { delivered: true });
  const slice = page.blocks.find((item) => item.id.startsWith("slice:"));
  assert.ok(slice, "купленного среза нет — нечем проверять, что он остался");
  const paragraphs = [...slice.paragraphs];

  const app = await openPage(server.origin, page.profileId);
  await app.pickDisagree("step1", "too_general");
  const after = app.session().page;
  assert.ok(after);
  const kept = after.blocks.find((item) => item.id === slice.id);
  assert.ok(kept);
  assert.deepEqual(kept.paragraphs, paragraphs);
  assert.equal(kept.purchased, true);
});

test("лестница до ступени 3 открывает выбор несогласия в живом блоке", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const host = hostOf(server.origin, "/");
  const app = createPageApp(host);
  await app.start();
  await app.intro("Аня", "1990-05-05");
  for (const step of [1, 2, 3] as const) {
    const start = app.session().page?.nextPortion?.key;
    for (const answer of answersForStep(step)) await app.accept(answer);
    assert.notEqual(app.session().page?.nextPortion?.key, start);
  }
  assert.ok(byClass(app.tree(), "block").some((item) => item.attrs["data-block"] === "step1"));
  assert.ok(visibleText(app.tree()).includes(copy("UI_BLOCK_DISAGREE")));
});
