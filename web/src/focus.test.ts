/**
 * Вопрос 48: после смены вопроса фокус на первом контроле новой порции.
 *
 * Браузера нет — слой тот же, что у живого DOM: `focusRoot.querySelector().focus()`.
 * Без вызова focus тест падает.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { createPageApp, firstQuestionControlSelector, type AppHost } from "./app.js";
import { choiceAnswer } from "./session.js";
import { pageStates } from "../showcase/page-states.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";

const reducedMotion = (): MotionHost => ({
  matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION_QUERY }),
  setTimeout: (handler) => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
});

test("после ответа фокус на первом контроле нового вопроса", async (t) => {
  const page = pageStates.s0;
  const focused: string[] = [];
  const location = { pathname: `/p/${page.profileId}` };
  const host: AppHost = {
    location,
    fetch: async () =>
      new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } }),
    motion: reducedMotion(),
    focusRoot: {
      querySelector: (selector: string) => {
        if (!selector) return null;
        return {
          focus: () => {
            focused.push(selector);
          },
        };
      },
    },
  };

  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const portion = page.nextPortion;
  assert.ok(portion);
  const first = portion.questions[0];
  const second = portion.questions[1];
  assert.ok(first);
  assert.ok(second);

  assert.equal(focused.at(-1), firstQuestionControlSelector(first.kind, first.id));

  const option = first.options[0]?.key;
  assert.ok(option);
  await app.accept(choiceAnswer(first, option)!);

  assert.equal(app.session().questionIndex, 1);
  assert.equal(focused.at(-1), firstQuestionControlSelector(second.kind, second.id));

  const before = focused.length;
  app.draft("x");
  assert.equal(focused.length, before, "черновик не должен сдвигать фокус");
});

test("селектор первого контроля не меняет порядок Tab: это querySelector, не перестановка дерева", () => {
  assert.equal(firstQuestionControlSelector("выбор", "L1"), 'input[type="radio"][name="L1"]');
  assert.equal(firstQuestionControlSelector("шкала", "L6"), 'input[type="radio"][name="L6"]');
  assert.equal(firstQuestionControlSelector("открытый", "L12"), '[id="L12"]');
  assert.equal(firstQuestionControlSelector("число", "slice_work:S10"), ".portion__number-input");
  assert.equal(
    firstQuestionControlSelector("выбор", 'slice_work:S1'),
    'input[type="radio"][name="slice_work:S1"]',
  );
});
