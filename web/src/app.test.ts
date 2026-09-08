/**
 * Живой клиент: адрес, ступень 0, порция, пауза, карта и маршрут.
 *
 * Браузера нет: дерево читается из той же функции, что монтируется в DOM.
 * Таймеры паузы — поддельное окно; сеть — поднятый тестовый сервер.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleText } from "./dom.js";
import { byClass, focusable, componentLookup, tokenPixels } from "./test-support.js";
import { declaredPx } from "./css.js";
import { BASE_VIEWPORT_HEIGHT_PX } from "../tokens/tokens.js";
import { createPageApp, type AppHost } from "./app.js";
import { filledBars } from "./page.js";
import { introTexts } from "./page-copy.js";
import { copy } from "./copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";

const { startTestServer, answersForStep } = (await import(
  pathToFileURL(join(repoRoot, "server/dist/test-support.js")).href
)) as typeof import("../../server/src/test-support.ts");

const reducedMotion = (): MotionHost => ({
  matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION_QUERY }),
  setTimeout: (handler) => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
});

const hostOf = (origin: string, pathname = "/"): AppHost & { scrolled: string[] } => {
  const location = { pathname };
  const scrolled: string[] = [];
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
    scrollRoot: {
      querySelector: (selector: string) => {
        scrolled.push(selector);
        return { scrollIntoView: () => undefined };
      },
    },
    scrolled,
  };
};

async function answerPortion(app: ReturnType<typeof createPageApp>, step: 1 | 2 | 3): Promise<void> {
  const start = app.session().page?.nextPortion?.key;
  assert.ok(start, "порции нет — отвечать нечего");
  for (const answer of answersForStep(step)) {
    await app.accept(answer);
  }
  assert.notEqual(app.session().page?.nextPortion?.key, start, "порция не ушла на сервер");
}

test("несуществующий профиль открывает понятную страницу", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const host = hostOf(server.origin, "/p/aaaaaaaaaaaaaaaaaaaaaa");
  const app = createPageApp(host);
  await app.start();
  assert.equal(app.session().screen, "missing");
  const text = visibleText(app.tree());
  assert.equal(text.includes("404"), false);
  assert.equal(text.toLowerCase().includes("profile_not_found"), false);
  assert.ok(text.includes(copy("UI_PUBLIC_MAKE_OWN")));
});

test("лестница: вход без даты, порции, карта 3→5→7, маршрут и крючок", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const host = hostOf(server.origin, "/");
  const app = createPageApp(host);
  await app.start();

  assert.equal(app.session().screen, "intro");
  const intro = visibleText(app.tree());
  assert.ok(intro.includes(introTexts.dateHint()));
  assert.ok(intro.includes("не делается ни одного вывода о характере"));

  await app.intro("Аня", null);
  const s0 = app.session().page;
  assert.ok(s0);
  assert.equal(s0.state, "s0");
  assert.equal(s0.card.theme, null);
  assert.equal(byClass(app.tree(), "head__theme").length, 0);
  assert.equal(filledBars(s0), 0);
  assert.ok(byClass(app.tree(), "route").length === 1);
  assert.equal(app.tree().attrs["data-profiled"], "false");
  assert.ok(visibleText(app.tree()).includes(s0.nextPortion?.questions[0]?.text ?? "NO"));

  const firstTree = app.tree();
  assert.equal(byClass(firstTree, "portion").length, 1);
  assert.equal(visibleText(firstTree).includes("из 12"), false);
  assert.equal(/Далее|дальше/i.test(visibleText(firstTree)), false);
  const firstQuestion = s0.nextPortion?.questions[0];
  assert.ok(firstQuestion);
  for (const other of s0.nextPortion?.questions.slice(1) ?? []) {
    assert.equal(visibleText(firstTree).includes(other.text), false, "на экране больше одного вопроса");
  }

  const keys = focusable(firstTree);
  const radios = keys.filter((node) => node.attrs["type"] === "radio");
  assert.ok(radios.length >= 2, "клавиатуре не из чего выбрать ответ");
  assert.equal(
    keys.some((node) => node.attrs["tabindex"] === "-1"),
    false,
    "фокус снят атрибутом, а не кольцом",
  );

  const first = answersForStep(1)[0];
  assert.ok(first);
  await app.accept(first);
  assert.equal(app.session().questionIndex, 1);
  app.back();
  assert.equal(app.session().questionIndex, 0);

  await answerPortion(app, 1);
  const s1 = app.session().page;
  assert.ok(s1);
  assert.equal(s1.state, "s1");
  assert.equal(filledBars(s1), 3);
  assert.ok(s1.hook);
  assert.equal(byClass(app.tree(), "hook").length, 1);
  assert.ok(host.scrolled.includes('.block[data-enter="on"]'));

  await answerPortion(app, 2);
  const s2 = app.session().page;
  assert.ok(s2);
  assert.equal(s2.state, "s2");
  assert.equal(filledBars(s2), 5);

  await answerPortion(app, 3);
  const s3 = app.session().page;
  assert.ok(s3);
  assert.equal(s3.state, "s3");
  assert.equal(filledBars(s3), 7);
  assert.equal(app.tree().attrs["data-profiled"], "true");
  assert.notEqual(s3.hook, s1.hook);
  const blocks = byClass(app.tree(), "block").map((item) => String(item.attrs["data-block"]));
  assert.deepEqual(
    blocks.filter((id) => id.startsWith("step")),
    ["step1", "step2", "step3"],
  );
  assert.ok(byClass(app.tree(), "door").some((door) => door.attrs["data-state"] === "opens_with_answers"));
  assert.ok(byClass(app.tree(), "door").some((door) => door.attrs["data-state"] === "locked_profiled"));
});

test("с датой рождения шапка показывает тему периода", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const host = hostOf(server.origin, "/");
  const app = createPageApp(host);
  await app.start();
  await app.intro("Кирилл", "1990-05-05");
  const page = app.session().page;
  assert.ok(page);
  assert.ok(page.card.theme);
  assert.equal(byClass(app.tree(), "head__theme").length, 1);
  assert.ok(visibleText(app.tree()).includes("Сейчас у тебя период"));
});

test("порция по объявленным стилям помещается в 360×640", () => {
  const lookup = componentLookup();
  const pad = tokenPixels("space-5") * 2;
  const gap = tokenPixels("space-4");
  const lead = tokenPixels("text-lg") * 1.25 * 3;
  const progress = tokenPixels("size-dot") * 1.4;
  const question = tokenPixels("text-md") * 1.4 * 3;
  const choiceGap = tokenPixels("space-3");
  const option = declaredPx(lookup, ".option", "min-height") ?? tokenPixels("size-target");
  const optionGap = tokenPixels("space-2");
  const options = 4 * option + 3 * optionGap;
  const back = tokenPixels("size-target") + gap;
  const height = pad + lead + progress + question + choiceGap + options + back + gap * 2;
  assert.ok(height <= BASE_VIEWPORT_HEIGHT_PX, `порция ${height.toFixed(0)} px выше экрана ${BASE_VIEWPORT_HEIGHT_PX}`);
});
