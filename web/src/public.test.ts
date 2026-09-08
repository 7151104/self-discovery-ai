/**
 * Приёмка E7-12: публичный вид и шеринг картинкой.
 *
 * Публичный вид скрывает блоки 3 и 4, маршрут и действия. Кнопка отдаёт SVG.
 * Отозванная ссылка — та же понятная страница, что и несуществующая.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findAll, visibleText } from "./dom.js";
import { byClass } from "./test-support.js";
import { createPageApp, type AppHost } from "./app.js";
import { copy } from "./copy.js";
import { publicTexts } from "./page-copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";

const { startTestServer, profileAtStep } = (await import(
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

const tokenOf = (url: string): string => url.split("/s/")[1]?.replace(/\/$/, "") ?? "";

test("кнопка «Поделиться» отдаёт SVG крючка и карты", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  await app.start();
  assert.ok(app.session().page?.hook);

  app.share();
  assert.equal(app.session().shareOpen, true);
  assert.ok(app.session().shareSvg?.includes("<svg"));
  assert.ok(app.session().page?.hook && app.session().shareSvg?.includes("text"));

  const save = findAll(app.tree(), "a").find((item) => item.attrs["download"] === "share.svg");
  assert.ok(save, "нет ссылки скачивания картинки");
  assert.equal(String(save.attrs["href"] ?? "").startsWith("data:image/svg+xml"), true);
  assert.ok(visibleText(app.tree()).includes(copy("UI_SHARE_SAVE")));
  assert.ok(visibleText(app.tree()).includes(copy("UI_SHARE_IMAGE_ONLY")));
});

test("публичный вид скрывает блоки 3 и 4, несогласие и маршрут", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);
  const owner = createPageApp(hostOf(server.origin, `/p/${page.profileId}`));
  await owner.start();
  owner.share();
  await owner.openPublicLink();
  const share = owner.session().page?.share;
  assert.ok(share);
  assert.match(share.url, /^\/s\/[A-Za-z0-9_-]+$/);
  assert.ok(visibleText(owner.tree()).includes(copy("UI_SHARE_PUBLIC_ON")));

  const token = tokenOf(share.url);
  const guest = createPageApp(hostOf(server.origin, `/s/${token}`));
  await guest.start();
  assert.equal(guest.session().screen, "public");
  assert.equal(guest.tree().attrs["data-view"], "public");
  const blocks = byClass(guest.tree(), "block").map((item) => String(item.attrs["data-block"]));
  assert.deepEqual(blocks, ["step1", "step2"]);
  assert.equal(byClass(guest.tree(), "offer").length, 0);
  assert.equal(byClass(guest.tree(), "route").length, 0);
  const text = visibleText(guest.tree());
  assert.equal(text.includes(copy("UI_BLOCK_DISAGREE")), false);
  assert.ok(text.includes(copy("UI_PUBLIC_MAKE_OWN")));
  assert.ok(text.includes(copy("UI_PUBLIC_TITLE", { имя: "Аня" })));
  assert.ok(text.includes(copy("UI_PUBLIC_HIDDEN")));
  assert.equal(guest.session().page?.card.name, "Аня");
  assert.equal(guest.session().page?.profileId, "");
});

test("отозванная ссылка открывает понятную страницу без кодов отказа", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 2);
  const owner = createPageApp(hostOf(server.origin, `/p/${page.profileId}`));
  await owner.start();
  owner.share();
  await owner.openPublicLink();
  const token = tokenOf(owner.session().page?.share?.url ?? "");
  await owner.closePublicLink();
  assert.equal(owner.session().page?.share, null);
  assert.ok(visibleText(owner.tree()).includes(copy("UI_SHARE_CLOSED")));

  const guest = createPageApp(hostOf(server.origin, `/s/${token}`));
  await guest.start();
  assert.equal(guest.session().screen, "missing");
  assert.equal(guest.session().missingKind, "revoked");
  const text = visibleText(guest.tree());
  assert.ok(text.includes(publicTexts.revoked()));
  assert.equal(text.includes("404"), false);
  assert.equal(text.toLowerCase().includes("not_found"), false);

  guest.goOwn();
  assert.equal(guest.session().screen, "intro");
});
