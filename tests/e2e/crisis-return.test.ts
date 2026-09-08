/**
 * Сквозные тесты кризиса и возврата (E11-03).
 *
 * Кризисный путь: разбор не выдан, предложения нет ни на экране, ни в API.
 * Возврат: уход на середине, повторное открытие ссылки — та же порция.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { hostOf as baseHost } from "../host.js";
import { loadKit } from "../kit.js";
import { demoAnswerFor, demoPerson } from "../ladder.js";
import { server, web, load } from "../load.js";
import { pageNode } from "./inspect.js";
import type { Child } from "../visual/capture.js";

type CrisisDto = {
  place: "ladder" | "paid_slice";
  publishable: boolean;
  texts: { id: string; text: string }[];
  contacts: { title: string; line: string }[];
};

type PageStateDto = {
  profileId: string;
  state: string;
  url: string;
  offer: { slice: string; price: number } | null;
  nextPortion: { key: string; questions: { id: string; kind: string }[]; answered: string[] } | null;
  blocks: { id: string; generation: { status: string } | null }[];
  crisis?: CrisisDto | null;
};

type Session = {
  screen: string;
  page: PageStateDto | null;
  returned?: boolean;
};

type PageApp = {
  tree: () => Child;
  session: () => Session;
  start: () => Promise<void>;
  accept: (input: unknown) => Promise<void>;
  intro: (name: string, birthDate: string | null) => Promise<void>;
  consent: (checked: boolean) => void;
  stop: () => void;
};

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

type Support = {
  startTestServer: (env?: NodeJS.ProcessEnv) => Promise<TestServer>;
  call: <T>(origin: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
};

/** Формулировка из `web/src/edges-live.test.ts` — блокирует разбор. */
const CRISIS_L12 =
  "Обычно я берусь за дело быстро и с интересом, довожу почти до конца, а потом хочу умереть и не хочу жить дальше уже несколько недель подряд";

test("кризисный путь: нет разбора, предложения и писем, заметка crisis на экране", async (t) => {
  const kit = await loadKit();
  const support = await server<Support>("test-support.js");
  const { createPageApp } = await web<{ createPageApp: (host: ReturnType<typeof baseHost>) => PageApp }>("src/app.js");
  const { emailsAfterEvent } = await load<{ emailsAfterEvent: (event: string, page: PageStateDto) => string[] }>(
    "engine/dist/emails.js",
  );

  const testServer = await support.startTestServer();
  t.after(() => testServer.close());

  const host = baseHost(testServer.origin, "/");
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();

  const person = await demoPerson();
  app.consent(true);
  await app.intro(person.name, person.birthDate);

  for (const step of [1, 2, 3] as const) {
    const questions = app.session().page?.nextPortion?.questions ?? [];
    for (const question of questions) {
      await app.accept(await demoAnswerFor(question));
    }
    assert.equal(app.session().page?.state, `s${step}`);
  }

  const open = app.session().page?.nextPortion?.questions[0];
  assert.ok(open && open.kind === "открытый");
  await app.accept({ questionId: open.id, kind: "открытый", text: CRISIS_L12 });

  const page = app.session().page;
  assert.ok(page);
  assert.equal(page.state, "s4");
  assert.ok(page.crisis, "кризис не попал в API");
  assert.equal(page.crisis?.place, "ladder");
  assert.equal(page.offer, null, "предложения нет в API");
  assert.equal(
    page.blocks.some((block) => block.id === "step4"),
    false,
    "блок сюжета не должен появиться",
  );

  assert.deepEqual(emailsAfterEvent("slice_ready", page), []);
  assert.deepEqual(emailsAfterEvent("receipt", page), []);

  const tree = app.tree();
  const pageEl = pageNode(tree, kit);
  assert.equal(pageEl.attrs["data-edge"], "crisis");
  assert.equal(kit.byClass(tree, "offer").length, 0);
  assert.ok(kit.visibleText(tree).length > 20, "экран пустой");
});

test("возврат по ссылке: та же порция, заметка return, ответы на месте", async (t) => {
  const kit = await loadKit();
  const support = await server<Support>("test-support.js");
  const { createPageApp } = await web<{ createPageApp: (host: ReturnType<typeof baseHost>) => PageApp }>("src/app.js");
  const { answersForStep, profileBody } = await load<{
    answersForStep: (step: 1 | 2 | 3 | 4) => unknown[];
    profileBody: (name?: string, birthDate?: string | null) => unknown;
  }>("server/dist/test-support.js");

  const testServer = await support.startTestServer();
  t.after(() => testServer.close());

  const created = await support.call<PageStateDto>(
    testServer.origin,
    "POST",
    "/api/profiles",
    profileBody("Аня", "1990-05-05"),
  );
  assert.equal(created.status, 201);
  const profileId = created.body.profileId;

  const step1 = answersForStep(1);
  assert.ok(step1.length > 1, "нужна порция из нескольких вопросов");
  const partial = await support.call<PageStateDto>(testServer.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: "step:1",
    answers: [step1[0]],
    requestId: "half-portion",
  });
  assert.equal(partial.status, 200);
  const portionKey = partial.body.nextPortion?.key;
  const answered = [...(partial.body.nextPortion?.answered ?? [])];
  assert.ok(portionKey && answered.length > 0);

  const returnHost = baseHost(testServer.origin, `/p/${profileId}`);
  const again = createPageApp(returnHost);
  t.after(() => again.stop());
  await again.start();

  const page = again.session().page;
  assert.ok(page);
  assert.equal(page.nextPortion?.key, portionKey);
  assert.deepEqual(page.nextPortion?.answered, answered);
  assert.equal(again.session().returned, true);
  assert.equal(pageNode(again.tree(), kit).attrs["data-edge"], "return");
  assert.ok(kit.visibleText(again.tree()).includes("вернулся"), "нет текста возврата");
  assert.equal(/не завершил/i.test(kit.visibleText(again.tree())), false);
});
