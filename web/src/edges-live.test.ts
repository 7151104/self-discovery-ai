/**
 * Приёмка E7-12: девять краевых состояний в живом клиенте.
 *
 * Сборка та же, что у витрины. Здесь — сервер и сессия вкладки, а не моки.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleText } from "./dom.js";
import { byClass } from "./test-support.js";
import { createPageApp, type AppHost } from "./app.js";
import type { AnswerInput, PageStateDto } from "./contract.js";
import { copy } from "./copy.js";
import { repoRoot } from "./paths.js";
import { REDUCED_MOTION_QUERY, type MotionHost } from "./motion.js";

const { startTestServer, answersForStep, profileAtStep, profileAtPaidState, profileBody, call } = (await import(
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

async function openPage(t: { after: (fn: () => void) => void }, origin: string, profileId: string) {
  const app = createPageApp(hostOf(origin, `/p/${profileId}`));
  t.after(() => app.stop());
  await app.start();
  return app;
}

const quietAnswers = (step: 1 | 2 | 3): AnswerInput[] =>
  answersForStep(step).map((answer) => (answer.kind === "шкала" ? { ...answer, scale: 2 as const } : answer));

const CRISIS_L12 =
  "Обычно я берусь за дело быстро и с интересом, довожу почти до конца, а потом хочу умереть и не хочу жить дальше уже несколько недель подряд";

test("дата не введена: шапка без темы, заметка no-date", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const host = hostOf(server.origin, "/");
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();
  app.consent(true);
  await app.intro("Аня", null);
  assert.equal(app.session().page?.card.theme, null);
  assert.equal(app.tree().attrs["data-edge"], "no-date");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_NO_DATE")));
  assert.equal(byClass(app.tree(), "head__theme").length, 0);
});

test("ответ L12 короче 15 слов: кнопка неактивна, подсказка поля, не заметка страницы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 3);
  const app = await openPage(t, server.origin, page.profileId);
  app.draft("один два три четыре пять шесть");
  const field = byClass(app.tree(), "field")[0];
  assert.ok(field);
  assert.equal(field.attrs["data-state"], "short");
  assert.equal(app.tree().attrs["data-edge"] ?? null, null);
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_OPEN_TOO_SHORT")));
  const submit = byClass(app.tree(), "field__submit")[0];
  assert.equal(submit?.attrs["disabled"], true);
});

test("кризисные признаки в L12: нет блока 4 и предложения, заметка crisis", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 3);
  await call(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
    portion: "step:4",
    answers: [{ questionId: "L12", kind: "открытый", text: CRISIS_L12 }],
    requestId: "crisis-l12",
  });
  const app = await openPage(t, server.origin, page.profileId);
  const state = app.session().page;
  assert.ok(state);
  assert.ok(state.crisis, "поле crisis не пришло с сервера");
  assert.equal(state.crisis?.place, "ladder");
  assert.equal(state.state, "s4");
  assert.equal(
    state.blocks.some((item) => item.id === "step4"),
    false,
  );
  assert.equal(state.offer, null);
  assert.equal(app.tree().attrs["data-edge"], "crisis");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_CRISIS")));
  assert.equal(byClass(app.tree(), "offer").length, 0);
});

test("ни один узел не сработал: крючка нет, заметка no-node", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Аня", "1990-05-05"));
  let page = created.body;
  for (const step of [1, 2, 3] as const) {
    const reply = await call<PageStateDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: quietAnswers(step),
      requestId: `quiet-${step}`,
    });
    page = reply.body;
  }
  assert.equal(page.hook, null);
  assert.ok(page.blocks.some((item) => item.id === "step3"));

  const app = await openPage(t, server.origin, page.profileId);
  assert.equal(app.session().page?.hook, null);
  assert.equal(app.tree().attrs["data-edge"], "no-node");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_NO_NODE")));
});

test("возврат на середине: та же порция, заметка return, без «не завершили»", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Аня", "1990-05-05"));
  const first = answersForStep(1)[0];
  assert.ok(first);
  await call(server.origin, "POST", `/api/p/${created.body.profileId}/portions`, {
    portion: "step:1",
    answers: [first],
    requestId: "half-portion",
  });
  const app = await openPage(t, server.origin, created.body.profileId);
  assert.equal(app.session().returned, true);
  assert.ok((app.session().page?.nextPortion?.answered.length ?? 0) > 0);
  assert.equal(app.tree().attrs["data-edge"], "return");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_RETURN")));
  assert.equal(/не завершил/i.test(visibleText(app.tree())), false);
});

test("отказ от оплаты: страница полная, предложения в этот визит нет", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  const app = await openPage(t, server.origin, page.profileId);
  assert.ok(app.session().page?.offer);
  app.decline();
  assert.equal(app.session().offerDeclined, true);
  assert.equal(byClass(app.tree(), "offer").length, 0);
  assert.ok(byClass(app.tree(), "route").length === 1);
  assert.equal(app.tree().attrs["data-edge"], "pay-declined");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_PAY_DECLINED")));
});

test("оплата не прошла: страница не меняется, деньги не списаны", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  const host = hostOf(server.origin, `/p/${page.profileId}`);
  const inner = host.fetch.bind(host);
  host.fetch = (async (input, init) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST" && url.includes("/orders")) {
      return new Response(JSON.stringify({ error: { code: "internal_error" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return inner(input, init);
  }) as typeof fetch;
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();
  const before = app.session().page;
  assert.ok(before?.offer);
  await app.buy();
  assert.equal(app.session().paymentFailed, true);
  assert.equal(app.session().page?.offer?.slice, before?.offer?.slice);
  assert.equal(app.tree().attrs["data-edge"], "payment-failed");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_PAYMENT_FAILED")));
});

test("изменение ответа: lookup без stale, хранимый блок помечен, заметка answer-changed", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtPaidState(server.origin, server.db, { delivered: true });
  await call(server.origin, "PATCH", `/api/p/${page.profileId}/answers/L1`, {
    answer: { questionId: "L1", kind: "выбор", option: "B" },
  });
  const app = await openPage(t, server.origin, page.profileId);
  const after = app.session().page;
  assert.ok(after);
  for (const block of after.blocks.filter((item) => item.id === "step1" || item.id === "step2" || item.id === "step3")) {
    assert.equal(block.stale, false, `${block.id}: lookup не должен получать stale`);
  }
  assert.ok(
    after.blocks.some((item) => item.stale && (item.purchased || item.id === "step4")),
    "хранимый блок не получил отметку расхождения",
  );
  assert.equal(app.tree().attrs["data-edge"], "answer-changed");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_ANSWER_CHANGED")));
});

test("текст не собрался: блок скрыт, ответы на месте, заметка generation-failed", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 4);
  server.db.run("UPDATE generation_jobs SET status = 'failed', active_slot = NULL WHERE profile_id = ?", [
    page.profileId,
  ]);
  server.db.run("UPDATE blocks SET status = 'failed' WHERE profile_id = ? AND slot = 'step4'", [page.profileId]);
  const app = await openPage(t, server.origin, page.profileId);
  const after = app.session().page;
  assert.ok(after);
  assert.ok(after.blocks.some((item) => item.generation?.status === "failed"));
  assert.equal(
    byClass(app.tree(), "block").some((item) => item.attrs["data-block"] === "step4"),
    false,
  );
  assert.ok(after.nextPortion === null);
  assert.equal(app.tree().attrs["data-edge"], "generation-failed");
  assert.ok(visibleText(app.tree()).includes(copy("UI_EDGE_GENERATION_FAILED")));
});
