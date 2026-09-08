/**
 * Приёмка E7-09: точка оплаты после ступени 4.
 *
 * Состав и отказ приходят полями предложения из файла среза, не из реестра.
 * Компонент один — тот же, что у витрины. Здесь живой сервер и сессия вкладки.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findAll, renderToString, visibleText } from "./dom.js";
import { byClass, componentCss, createManualTimer } from "./test-support.js";
import { createPageApp, type AppHost } from "./app.js";
import { copy } from "./copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";
import { offerTexts } from "./page-copy.js";
import type { AnswerInput, PageStateDto } from "./contract.js";
import * as mock from "../showcase/mocks.js";

const { startTestServer, drainServer, call, profileBody } = (await import(
  pathToFileURL(join(repoRoot, "server/dist/test-support.js")).href
)) as typeof import("../../server/dist/test-support.js");

const llm = (await import(
  pathToFileURL(join(repoRoot, "server/llm/dist/index.js")).href
)) as typeof import("../../server/llm/dist/index.js");

const engine = (await import(
  pathToFileURL(join(repoRoot, "engine/dist/index.js")).href
)) as typeof import("../../engine/dist/index.js");

const { DEMO_ANSWERS } = llm;

test("мок первого предложения берёт состав и отказ из файла среза", () => {
  const screen = engine.payScreen("slice_node_finish");
  assert.deepEqual(mock.offer.contents, screen.contents);
  assert.equal(mock.offer.decline, screen.decline);
});

function demoAnswersForStep(step: 1 | 2 | 3 | 4): AnswerInput[] {
  return engine.rawContent.questions
    .filter((question) => question.step === step)
    .map((question): AnswerInput => {
      const value = DEMO_ANSWERS[question.id as keyof typeof DEMO_ANSWERS];
      if (question.type === "выбор") return { questionId: question.id, kind: "выбор", option: String(value) };
      if (question.type === "шкала") {
        return { questionId: question.id, kind: "шкала", scale: Number(value) as 1 | 2 | 3 | 4 | 5 };
      }
      return { questionId: question.id, kind: "открытый", text: String(value) };
    });
}

async function profileAtDemoStep(origin: string, step: 3 | 4): Promise<PageStateDto> {
  const created = await call<PageStateDto>(origin, "POST", "/api/profiles", profileBody("Артём", "1994-03-12"));
  let page = created.body;
  for (let current = 1; current <= step; current += 1) {
    const level = current as 1 | 2 | 3 | 4;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${level}`,
      answers: demoAnswersForStep(level),
      requestId: `pay-demo-${level}`,
    });
    page = reply.body;
  }
  return page;
}

const reducedMotion = (): MotionHost => ({
  matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION_QUERY }),
  setTimeout: (handler) => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
});

const hostOf = (origin: string, pathname: string) => {
  const location = { pathname };
  const timer = createManualTimer();
  const host: AppHost & { timer: ReturnType<typeof createManualTimer> } = {
    location,
    origin,
    fetch,
    history: {
      pushState: (_data, _title, url) => {
        location.pathname = new URL(String(url), origin).pathname;
      },
    },
    motion: reducedMotion(),
    timer,
  };
  return host;
};

async function openReadyPay(origin: string, profileId: string) {
  const host = hostOf(origin, `/p/${profileId}`);
  const app = createPageApp(host);
  await app.start();
  return { app, host };
}

test("после готового сюжета на экране одно предложение: обещание, состав, одна цена, отказ", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const started = await profileAtDemoStep(server.origin, 4);
  await drainServer(server);
  const { app } = await openReadyPay(server.origin, started.profileId);
  t.after(() => app.stop());

  const page = app.session().page;
  assert.ok(page?.offer, "предложения нет");
  assert.equal(page.state, "s4");
  assert.ok(
    byClass(app.tree(), "block").some((item) => item.attrs["data-block"] === "step4"),
    "блока сюжета нет — точка оплаты раньше времени",
  );

  const offers = byClass(app.tree(), "offer");
  assert.equal(offers.length, 1);
  assert.equal(byClass(app.tree(), "offer__buy").length, 1);
  assert.equal(byClass(app.tree(), "offer__decline").length, 1);

  const screen = engine.payScreen(page.offer.slice);
  const text = visibleText(app.tree());
  assert.ok(text.includes(page.offer.promise), "обещание переписано, а не взято из оффера");
  assert.ok(text.includes(offerTexts.contents(screen.contents)));
  for (const part of screen.contents) assert.ok(text.includes(part), `нет части состава: ${part}`);
  assert.ok(text.includes(screen.decline));
  assert.ok(text.includes(copy("UI_PAY_BUTTON", { цена: page.offer.price })));
  assert.ok(text.includes(copy("UI_PAY_CONTENTS_LABEL")));

  const priced = page.doors.filter((door) => door.price !== null);
  assert.equal(priced.length, 1, "на экране больше одной платной двери с ценой");
  assert.equal(priced[0]?.slice, page.offer.slice);
  assert.equal(priced[0]?.price, page.offer.price);
  assert.equal(byClass(app.tree(), "door__price").length, 1);

  const html = renderToString(app.tree());
  assert.equal(/<del\b|<s\b/i.test(html), false, "зачёркнутая цена");
  assert.equal(/★|⭐/u.test(html), false, "звёзды отзыва");
  assert.equal(byClass(app.tree(), "wait").length, 0);
  assert.equal(
    findAll(app.tree(), "button").filter((item) => String(item.attrs["class"] ?? "").includes("offer__buy")).length,
    1,
    "вторая кнопка продукта",
  );
});

test("в стилях предложения нет зачёркивания, таймера и счётчика мест", () => {
  const css = componentCss("offer.css");
  assert.equal(/line-through/i.test(css), false);
  assert.equal(/countdown|timer|осталось/i.test(css), false);
});

test("отказ оставляет страницу полной и не показывает предложение в этот визит", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const started = await profileAtDemoStep(server.origin, 4);
  await drainServer(server);
  const { app } = await openReadyPay(server.origin, started.profileId);
  t.after(() => app.stop());

  assert.equal(byClass(app.tree(), "offer").length, 1);
  const blocksBefore = byClass(app.tree(), "block").length;
  assert.ok(blocksBefore >= 4);

  app.decline();

  assert.equal(app.session().offerDeclined, true);
  assert.equal(byClass(app.tree(), "offer").length, 0);
  assert.equal(byClass(app.tree(), "block").length, blocksBefore);
  assert.equal(byClass(app.tree(), "map").length, 1);
  assert.equal(byClass(app.tree(), "route").length, 1);
  assert.equal(app.tree().attrs["data-edge"], "pay-declined");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_PAY_DECLINED")));
  assert.equal(byClass(app.tree(), "door__price").length, 0, "после отказа цена осталась на двери");
});
