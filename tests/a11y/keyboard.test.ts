/**
 * Лестница проходится с клавиатуры (E11-05).
 *
 * Вход на ступень 0 — согласие и имя, как в остальных клиентских тестах:
 * поля формы читают живой DOM, которого в автотесте нет. Дальше двенадцать
 * вопросов отвечаются Tab, стрелкой по шкале и пробелом. `app.accept` из
 * теста не вызывается.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { loadKit } from "../kit.js";
import { server, web } from "../load.js";
import { hostOf } from "../host.js";
import { tabStops } from "./audit.js";
import { walkLadder, waitUntil, type PageApp } from "./keyboard.js";

test("лестница проходится с клавиатуры: Tab, стрелка на шкале, двенадцать вопросов", async (t) => {
  const support = await server<{
    startTestServer: () => Promise<{ origin: string; close: () => Promise<void> }>;
    answersForStep: (step: 1 | 2 | 3 | 4) => { questionId: string; kind: string; text?: string }[];
  }>("test-support.js");
  const { createPageApp } = await web<{
    createPageApp: (host: ReturnType<typeof hostOf>) => PageApp;
  }>("src/app.js");
  const kit = await loadKit();
  const testServer = await support.startTestServer();
  t.after(() => testServer.close());

  const app = createPageApp(hostOf(testServer.origin, "/"));
  await app.start();
  app.consent(true);
  await app.intro("Аня", null);
  assert.equal(app.session().page?.state, "s0");

  const firstStops = tabStops(app.tree(), kit);
  assert.ok(firstStops.length > 0, "на s0 некуда поставить фокус");
  const firstRadios = kit.focusable(app.tree()).filter((node) => node.attrs["type"] === "radio");
  assert.ok(firstRadios.length >= 2);

  const open = support.answersForStep(4).find((item) => item.kind === "открытый")?.text;
  assert.ok(open, "нет эталонного открытого ответа");

  const walked = await walkLadder(app, kit, open);
  assert.equal(walked.questions, 12, `отвечено ${walked.questions}, ждали 12`);
  assert.ok(walked.keys.includes("Tab"), "лестница пройдена без Tab");
  assert.ok(walked.keys.includes("ArrowRight"), "шкала не отвечена стрелкой");
  assert.ok(walked.keys.includes(" "), "выбор не отвечен пробелом");
  await waitUntil(() => app.session().page?.state === "s4", "лестница не дошла до s4");
  assert.equal(app.session().page?.nextPortion, null);
});
