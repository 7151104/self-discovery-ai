/**
 * Деревья живого клиента на всех семи состояниях.
 *
 * Сборка та же, что у витрины. Здесь — сервер и сессия вкладки. Дата рождения
 * не передаётся: тема периода берётся по текущей дате, и снимок иначе ехал бы
 * вместе с сезоном. Заметка «даты нет» на живых эталонах — следствие, не дефект.
 *
 * `s4` после лестницы в тестовом сервере — ожидание генерации: очередь по
 * умолчанию не крутится, чтобы остальные тесты видели `pending`. Это честный
 * живой `s4` тестового контура, не мок витрины с уже готовым сюжетом.
 *
 * Платные состояния не берутся из `purchaseSlice` / `profileAtPaidState`:
 * те помощники создают профиль с датой по умолчанию, и на эталоне появилась
 * бы тема сезона. Оплата и добор повторяют тот же маршрут API, но с
 * `profileBody("Аня", null)`.
 */

import { server, web } from "../load.js";
import { hostOf } from "../host.js";
import { PAGE_STATES, type PageStateId } from "../states.js";
import type { Child } from "./capture.js";

type PageStateDto = {
  profileId: string;
  state: string;
  offer: { slice: string } | null;
  nextPortion: { key: string; questions: unknown[] } | null;
};

type OrderDto = { orderId: string; price: number; payment?: { url: string } | null };

type Reply<T> = { status: number; body: T };

type PageApp = {
  tree: () => Child;
  start: () => Promise<void>;
};

type TestSupport = {
  startTestServer: () => Promise<{ origin: string; db: unknown; close: () => Promise<void> }>;
  answersForStep: (step: 1 | 2 | 3 | 4) => unknown[];
  answersForPortion: (portion: { key: string; questions: unknown[] }) => unknown[];
  answerSlicePortions: (origin: string, profileId: string) => Promise<PageStateDto>;
  deliverWebhook: (
    origin: string,
    input: { kind: "payment.succeeded"; orderId: string; reference: string; amount: number },
  ) => Promise<unknown>;
  profileBody: (name?: string, birthDate?: string | null) => unknown;
  call: <T>(origin: string, method: string, path: string, body?: unknown) => Promise<Reply<T>>;
};

type Store = {
  saveBlockContent: (
    db: unknown,
    profileId: string,
    input: {
      slot: string;
      profileVersion: number;
      purchased: boolean;
      heading: string;
      paragraphs: string[];
      highlight: string | null;
    },
  ) => unknown;
  findActiveJob: (db: unknown, profileId: string, slot: string) => unknown | null;
  saveJobResult: (
    db: unknown,
    job: unknown,
    result: { heading: string; paragraphs: string[]; highlight: string },
  ) => unknown;
};

const referenceOf = (order: OrderDto): string =>
  order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "";

async function ladderProfile(support: TestSupport, origin: string): Promise<PageStateDto> {
  const created = await support.call<PageStateDto>(origin, "POST", "/api/profiles", support.profileBody("Аня", null));
  let page = created.body;
  for (const step of [1, 2, 3, 4] as const) {
    const reply = await support.call<PageStateDto>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: support.answersForStep(step),
      requestId: `visual-${step}`,
    });
    page = reply.body;
  }
  return page;
}

async function pay(support: TestSupport, origin: string, page: PageStateDto): Promise<PageStateDto> {
  const slice = page.offer?.slice ?? "slice_node_finish";
  const order = await support.call<{ order: OrderDto }>(origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: `visual-buy-${slice}`,
  });
  await support.deliverWebhook(origin, {
    kind: "payment.succeeded",
    orderId: order.body.order.orderId,
    reference: referenceOf(order.body.order),
    amount: order.body.order.price,
  });
  return (await support.call<PageStateDto>(origin, "GET", `/api/p/${page.profileId}`)).body;
}

async function deliverSlice(
  support: TestSupport,
  store: Store,
  origin: string,
  db: unknown,
  page: PageStateDto,
): Promise<PageStateDto> {
  const paid = await pay(support, origin, page);
  const slice = paid.offer?.slice ?? page.offer?.slice ?? "slice_node_finish";
  await support.answerSlicePortions(origin, paid.profileId);
  const heading = "Почему ты останавливаешься у финиша";
  const paragraphs = ["Механизм включается на восьмидесяти процентах пути.", "Дальше идёт цена этого механизма."];
  const highlight = "Обрыв у финиша — не лень, а способ не проверять результат.";
  const slot = `slice:${slice}`;
  store.saveBlockContent(db, paid.profileId, {
    slot,
    profileVersion: 1,
    purchased: true,
    heading,
    paragraphs,
    highlight,
  });
  const job = store.findActiveJob(db, paid.profileId, slot);
  if (job) store.saveJobResult(db, job, { heading, paragraphs, highlight });
  return (await support.call<PageStateDto>(origin, "GET", `/api/p/${paid.profileId}`)).body;
}

export async function liveTrees(): Promise<{ trees: Record<PageStateId, Child>; close: () => Promise<void> }> {
  const support = await server<TestSupport>("test-support.js");
  const store = await server<Store>("store.js");
  const { createPageApp } = await web<{
    createPageApp: (host: ReturnType<typeof hostOf>) => PageApp;
  }>("src/app.js");

  const testServer = await support.startTestServer();

  const open = async (profileId: string): Promise<PageApp> => {
    const app = createPageApp(hostOf(testServer.origin, `/p/${profileId}`));
    await app.start();
    return app;
  };

  const created = await support.call<PageStateDto>(
    testServer.origin,
    "POST",
    "/api/profiles",
    support.profileBody("Аня", null),
  );
  let page = created.body;
  const trees = {} as Record<PageStateId, Child>;

  const take = async (state: PageStateId, profileId: string) => {
    const app = await open(profileId);
    trees[state] = app.tree();
  };

  await take("s0", page.profileId);

  for (const step of [1, 2, 3] as const) {
    const reply = await support.call<PageStateDto>(testServer.origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: support.answersForStep(step),
      requestId: `visual-${step}`,
    });
    page = reply.body;
    await take(`s${step}` as PageStateId, page.profileId);
  }

  const s4 = await support.call<PageStateDto>(testServer.origin, "POST", `/api/p/${page.profileId}/portions`, {
    portion: "step:4",
    answers: support.answersForStep(4),
    requestId: "visual-4",
  });
  page = s4.body;
  await take("s4", page.profileId);

  const pendingPage = await pay(support, testServer.origin, await ladderProfile(support, testServer.origin));
  await take("paid_pending", pendingPage.profileId);

  const done = await deliverSlice(
    support,
    store,
    testServer.origin,
    testServer.db,
    await ladderProfile(support, testServer.origin),
  );
  await take("paid_done", done.profileId);

  for (const state of PAGE_STATES) {
    if (trees[state] === undefined) throw new Error(`живой клиент: нет дерева ${state}`);
  }

  return { trees, close: () => testServer.close() };
}
