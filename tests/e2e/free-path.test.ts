/**
 * Сквозной тест бесплатного пути (E11-01).
 *
 * Прогон от ступени 0 до блока сюжета: настоящий сервер, настоящий клиент
 * (`createPageApp` / `renderPersonalPage`). Числа заполненных полос и порядок
 * блоков сверяются с таблицей `docs/11-ui-page-spec.md`, а не с копией в тесте.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { hostOf as baseHost } from "../host.js";
import { loadKit } from "../kit.js";
import { demoAnswerFor, demoPerson } from "../ladder.js";
import { server, web } from "../load.js";
import type { Child } from "../visual/capture.js";
import {
  specFilledBars,
  specLadderBlocks,
  specMapBarCount,
  specPageStates,
  specScreenSlots,
  uiSpecDoc,
  PAGE_STATES,
} from "../states.js";
import { blockOrder, expectedSlots, filledBarCount, mapBarCount, screenSlots } from "./inspect.js";

type PageStateDto = {
  profileId: string;
  state: string;
  hook: string | null;
  map: { fill: string }[];
  blocks: { id: string; heading: string; paragraphs: string[]; generation: { status: string } | null }[];
  doors: { state: string }[];
  offer: { slice: string; price: number } | null;
  nextPortion: { key: string; questions: { id: string; kind: string }[] } | null;
};

type Session = {
  screen: string;
  page: PageStateDto | null;
  questionIndex: number;
};

type PageApp = {
  tree: () => Child;
  session: () => Session;
  start: () => Promise<void>;
  accept: (input: unknown) => Promise<void>;
  intro: (name: string, birthDate: string | null) => Promise<void>;
  consent: (checked: boolean) => void;
  stop: () => void;
  flushWatch: () => Promise<void>;
};

type ManualTimer = {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  flush: () => void;
};

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

type Support = {
  startTestServer: (env?: NodeJS.ProcessEnv) => Promise<TestServer>;
  drainServer: (server: TestServer) => Promise<void>;
};

const FREE_STATES = ["s0", "s1", "s2", "s3", "s4"] as const;

test("таблица состояний совпадает с PAGE_STATES и называет рост полос", () => {
  const doc = uiSpecDoc();
  assert.deepEqual(specPageStates(doc), [...PAGE_STATES]);

  const bars = specFilledBars(doc);
  assert.equal(bars.s0, 0, "s0: пустая карта должна читаться как 0");
  assert.ok((bars.s1 ?? 0) > (bars.s0 ?? 0), "s1 должна заполнять полосы");
  assert.ok((bars.s2 ?? 0) > (bars.s1 ?? 0), "s2 должна заполнять больше полос, чем s1");
  assert.ok((bars.s3 ?? 0) > (bars.s2 ?? 0), "s3 должна заполнять больше полос, чем s2");
  assert.equal(bars.s4, bars.s3, "сюжет не добавляет полосу карты");

  const blocks = specLadderBlocks(doc);
  assert.deepEqual(blocks.s0, []);
  assert.deepEqual(blocks.s1, ["step1"]);
  assert.deepEqual(blocks.s2, ["step1", "step2"]);
  assert.deepEqual(blocks.s3, ["step1", "step2", "step3"]);
  assert.deepEqual(blocks.s4, ["step1", "step2", "step3", "step4"]);

  const slots = specScreenSlots(doc);
  assert.deepEqual(
    slots,
    ["head", "hook", "map", "block", "block", "block", "block", "portion", "route"],
    slots.join(", "),
  );
  assert.equal(specMapBarCount(doc), 7);
});

test("бесплатный путь: ступени 0–4, полосы, блоки, двери, предложение", async (t) => {
  const kit = await loadKit();
  const support = await server<Support>("test-support.js");
  const { createPageApp } = await web<{
    createPageApp: (host: ReturnType<typeof baseHost> & { timer: ManualTimer }) => PageApp;
  }>("src/app.js");
  const { filledBars } = await web<{ filledBars: (page: PageStateDto) => number }>("src/page.js");
  const { createManualTimer } = await web<{ createManualTimer: () => ManualTimer }>("src/test-support.js");

  const testServer = await support.startTestServer();
  t.after(() => testServer.close());

  const timer = createManualTimer();
  const host = { ...baseHost(testServer.origin, "/"), timer };
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const person = await demoPerson();
  app.consent(true);
  await app.intro(person.name, person.birthDate);

  const specBars = specFilledBars();
  const specBlocks = specLadderBlocks();
  const mapBars = specMapBarCount();

  const pulse = async () => {
    timer.flush();
    await app.flushWatch();
  };

  const current = (): PageStateDto => {
    const page = app.session().page;
    assert.ok(page, "страницы нет");
    return page;
  };

  const checkState = (state: (typeof FREE_STATES)[number], options: { waiting?: boolean } = {}) => {
    const page = current();
    const tree = app.tree();
    assert.equal(page.state, state, `ожидали состояние ${state}`);
    assert.equal(mapBarCount(tree, kit), mapBars, `${state}: на карте не ${mapBars} полос`);
    assert.equal(filledBarCount(tree, kit), specBars[state], `${state}: заполненных полос на дереве`);
    assert.equal(filledBars(page), specBars[state], `${state}: заполненных полос в DTO`);

    const waiting = options.waiting === true;
    const visibleBlocks = waiting ? (specBlocks[state] ?? []).filter((id) => id !== "step4") : (specBlocks[state] ?? []);
    assert.deepEqual(blockOrder(tree, kit), visibleBlocks, `${state}: порядок блоков`);

    const portion = page.nextPortion !== null && page.nextPortion.questions.length > 0;
    const offer = page.offer !== null && !waiting;
    const slots = screenSlots(tree, kit);
    assert.deepEqual(
      slots,
      expectedSlots({
        blocks: specBlocks[state] ?? [],
        waiting,
        offer,
        portion: portion && !waiting && page.offer === null,
      }),
      `${state}: порядок слотов [${slots.join(", ")}]`,
    );

    if (state !== "s4") {
      assert.ok(
        kit.byClass(tree, "door").some((door) => door.attrs["data-state"] === "opens_with_answers"),
        `${state}: нет двери, открывающейся ответами`,
      );
    }
    if (state === "s3" || state === "s4") {
      assert.equal(kit.byClass(tree, "page")[0]?.attrs["data-profiled"], "true", `${state}: двери не подписаны под профиль`);
    }
  };

  assert.equal(app.session().screen, "page");
  checkState("s0");
  assert.equal(current().hook, null);
  assert.equal(current().offer, null);

  for (const step of [1, 2, 3] as const) {
    const startKey = current().nextPortion?.key;
    assert.ok(startKey, `на s${step - 1} нет порции`);
    const questions = current().nextPortion?.questions ?? [];
    for (const question of questions) {
      await app.accept(await demoAnswerFor(question));
    }
    assert.notEqual(current().nextPortion?.key, startKey, `ступень ${step} не ушла`);
    checkState(`s${step}` as "s1" | "s2" | "s3");
  }

  assert.ok(current().nextPortion?.key === "step:4", "после ступени 3 нет открытого вопроса");
  const open = current().nextPortion?.questions[0];
  assert.ok(open && open.kind === "открытый");
  await app.accept(await demoAnswerFor(open));

  assert.equal(current().state, "s4");
  assert.ok(kit.byClass(app.tree(), "wait").length === 1, "ожидания сюжета нет");
  assert.equal(kit.byClass(app.tree(), "offer").length, 0);
  checkState("s4", { waiting: true });

  await support.drainServer(testServer);
  await pulse();

  checkState("s4");
  const ready = current();
  assert.ok(blockOrder(app.tree(), kit).includes("step4"), "блок сюжета не появился");
  const story = ready.blocks.find((block) => block.id === "step4");
  assert.ok(story);
  // Не «не pending», а именно готов и с текстом: пустой блок на странице
  // выглядит как пройденный путь, хотя человеку ничего не выдали.
  assert.equal(story.generation?.status, "ready", story.generation?.status ?? "блока генерации нет");
  assert.ok(story.paragraphs.length >= 3, `в сюжете абзацев ${story.paragraphs.length}`);
  assert.ok(story.heading.length > 0, "у сюжета нет заголовка");
  assert.ok(
    kit.visibleText(app.tree()).includes(story.paragraphs[0]!.slice(0, 40)),
    "текст сюжета не дошёл до страницы",
  );
  assert.ok(ready.offer, "предложения после сюжета нет");
  assert.ok(ready.offer.price > 0, "на экране нет цены");
  assert.equal(kit.byClass(app.tree(), "offer").length, 1);
  assert.equal(kit.byClass(app.tree(), "wait").length, 0);
});
