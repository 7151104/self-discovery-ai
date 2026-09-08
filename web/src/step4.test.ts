/**
 * Приёмка E7-08: открытый ответ, ожидание генерации, опрос статуса.
 *
 * Браузера нет: дерево — та же функция, что монтируется в DOM. Таймер опроса
 * ручной: движение страницы здесь ни при чём.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleText } from "./dom.js";
import { byClass, createManualTimer } from "./test-support.js";
import { createPageApp, type AppHost } from "./app.js";
import { copy } from "./copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";
import { LONG_WAIT_MS } from "../components/wait.js";
import { openAnswer } from "./session.js";
import { GENERATION_POLL_MS } from "./poll.js";
import type { AnswerInput, PageStateDto } from "./contract.js";

const { startTestServer, answersForStep, profileAtStep, drainServer, call, profileBody } = (await import(
  pathToFileURL(join(repoRoot, "server/dist/test-support.js")).href
)) as typeof import("../../server/dist/test-support.js");

const llm = (await import(
  pathToFileURL(join(repoRoot, "server/llm/dist/index.js")).href
)) as typeof import("../../server/llm/dist/index.js");

const { FakeProvider, DEMO_ANSWERS } = llm;

const engine = (await import(
  pathToFileURL(join(repoRoot, "engine/dist/index.js")).href
)) as typeof import("../../engine/dist/index.js");

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
      requestId: `demo-${level}`,
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

const pulse = async (app: ReturnType<typeof createPageApp>, timer: ReturnType<typeof createManualTimer>): Promise<void> => {
  timer.flush();
  await app.flushWatch();
};

test("до порога кнопка неактивна, подсказка объясняет причину, короткий ответ не уходит", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 3);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const short = "один два три четыре пять шесть";
  app.draft(short);
  const field = byClass(app.tree(), "field")[0];
  assert.ok(field);
  assert.equal(field.attrs["data-state"], "short");
  assert.equal(byClass(app.tree(), "field__submit")[0]?.attrs["disabled"], true);
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_OPEN_TOO_SHORT")));

  const question = app.session().page?.nextPortion?.questions[0];
  assert.ok(question);
  await app.accept(openAnswer(question, short));
  assert.equal(app.session().page?.state, "s3");
  assert.equal(app.session().collecting, false);
  assert.ok(app.session().page?.nextPortion);
});

test("после отправки открытого ответа видно ожидание, предложение скрыто", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 3);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const open = answersForStep(4)[0];
  assert.ok(open && open.kind === "открытый");
  await app.accept(open);

  const wait = byClass(app.tree(), "wait")[0];
  assert.ok(wait, "ожидания нет");
  assert.equal(wait.attrs["data-wait"], "step4");
  assert.ok(visibleText(app.tree()).includes(copy("UI_WAIT_STEP4")));
  assert.equal(byClass(app.tree(), "offer").length, 0);
  assert.equal(
    byClass(app.tree(), "block").some((item) => item.attrs["data-block"] === "step4"),
    false,
  );
  const pending = app.session().page?.blocks.find((item) => item.id === "step4");
  assert.equal(pending?.generation?.status, "pending");
});

test("перезагрузка во время ожидания сохраняет ожидание и не начинает заново", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  assert.equal(app.session().waitResumed, true);
  const wait = byClass(app.tree(), "wait")[0];
  assert.ok(wait);
  assert.equal(wait.attrs["data-enter"], "off");
  assert.ok(visibleText(app.tree()).includes(copy("UI_WAIT_STEP4")));
  assert.ok(visibleText(app.tree()).includes(copy("UI_WAIT_RESUMED")));
  assert.equal(app.session().page?.blocks.find((item) => item.id === "step4")?.generation?.status, "pending");
});

test("когда генерация готова, блок появляется без перезагрузки страницы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtDemoStep(server.origin, 3);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const open = demoAnswersForStep(4)[0];
  assert.ok(open);
  await app.accept(open);
  assert.ok(byClass(app.tree(), "wait").length === 1);

  await drainServer(server);
  await pulse(app, host.timer);

  assert.equal(byClass(app.tree(), "wait").length, 0);
  assert.ok(
    byClass(app.tree(), "block").some((item) => item.attrs["data-block"] === "step4"),
    "блок сюжета не появился",
  );
  const ready = app.session().page?.blocks.find((item) => item.id === "step4");
  assert.ok(ready);
  assert.notEqual(ready.generation?.status, "pending");
  assert.ok(ready.paragraphs.length > 0);
});

test("отказ генерации останавливает опрос и показывает краевое состояние", async (t) => {
  const provider = new FakeProvider({ turns: [{ kind: "постоянный отказ", code: "auth" }] });
  const server = await startTestServer({}, { provider });
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 3);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const open = answersForStep(4)[0];
  assert.ok(open);
  await app.accept(open);
  await drainServer(server);
  await pulse(app, host.timer);

  assert.equal(app.tree().attrs["data-edge"], "generation-failed");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_GENERATION_FAILED")));
  assert.equal(byClass(app.tree(), "wait").length, 0);
  assert.equal(host.timer.count(), 0, "опрос не остановился после отказа");
});

test("уход со страницы снимает опрос", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();
  assert.ok(host.timer.count() >= 1, "опрос не начался");
  app.goOwn();
  assert.equal(host.timer.count(), 0);
  assert.equal(app.session().screen, "intro");
});

test("затянувшееся ожидание говорит об этом текстом из контента", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  const started = Date.parse(page.updatedAt);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  host.now = () => started + LONG_WAIT_MS;
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();
  assert.ok(visibleText(app.tree()).includes(copy("UI_WAIT_LONG")));
  assert.equal(GENERATION_POLL_MS > 0, true);
});
