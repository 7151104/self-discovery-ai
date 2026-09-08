/**
 * Нагрузочная проверка очереди генерации (E11-07).
 *
 * Десятикратный всплеск на поддельном провайдере: задания не теряются,
 * вызовы идут по одному в порядке очереди, при исчерпании лимита стоимости
 * человек видит отказ, а не ошибку сервера, перезапуск доигрывает хвост.
 *
 * Времени нет: паузы подменены, такты считает обёртка провайдера.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostOf as baseHost } from "../host.js";
import { loadKit } from "../kit.js";
import type { Child } from "../visual/capture.js";
import { profileAtDemoLadder, type LadderPage } from "../ladder.js";
import { load, server, web } from "../load.js";
import { tracingProvider, type GenerationProvider } from "./trace.js";

const BURST = 10;

const LLM_FAST = {
  SDAI_LLM_ATTEMPTS: "1",
  SDAI_LLM_TIMEOUT_MS: "80",
  SDAI_LLM_BACKOFF_MS: "0",
  SDAI_LLM_PROFILE_COST_LIMIT_KOPECKS: "1000000",
  SDAI_RATE_CREATE_PROFILE: "100",
  SDAI_RATE_PORTION: "1000",
  SDAI_RATE_STATE: "1000",
};

const PRICE = { inputKopecksPerMillion: 10_000, outputKopecksPerMillion: 10_000 };

type PageStateDto = {
  profileId: string;
  state: string;
  blocks: { id: string; generation: { id: string; status: string } | null }[];
};

type JobRow = {
  generation_id: string;
  profile_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  failure_code: string | null;
};

type TestServer = {
  origin: string;
  db: unknown;
  close: () => Promise<void>;
};

type Support = {
  startTestServer: (
    env?: NodeJS.ProcessEnv,
    options?: {
      autostart?: boolean;
      provider?: unknown;
      databasePath?: string;
    },
  ) => Promise<TestServer>;
  drainServer: (server: TestServer) => Promise<void>;
  call: <T>(origin: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
};

type Store = {
  countJobs: (db: unknown, profileId?: string) => number;
  findLatestJob: (db: unknown, profileId: string, slot: string) => { generationId: string; status: string; failureCode: string | null } | null;
  insertCall: (
    db: unknown,
    input: {
      generationId: string | null;
      profileId: string;
      provider: string;
      model: string;
      attempt: number;
      inputTokens: number;
      outputTokens: number;
      costKopecks: number;
      durationMs: number;
      outcome: "ok";
    },
  ) => unknown;
};

type Llm = {
  answering: (text: string, options?: { pricing?: { inputKopecksPerMillion: number; outputKopecksPerMillion: number } }) => unknown;
  envelope: () => string;
};

type PageApp = {
  tree: () => Child;
  session: () => { page: PageStateDto | null };
  start: () => Promise<void>;
  stop: () => void;
  flushWatch: () => Promise<void>;
};

type ManualTimer = {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  flush: () => void;
};

const jobsOf = (db: unknown): JobRow[] =>
  (db as { all: <T>(sql: string, params?: unknown[]) => T[] }).all<JobRow>(
    `SELECT generation_id, profile_id, status, created_at, started_at, failure_code
       FROM generation_jobs
      ORDER BY created_at, generation_id`,
  );

const accounted = (rows: JobRow[]): { processed: number; queued: number; lost: number } => {
  let processed = 0;
  let queued = 0;
  for (const row of rows) {
    if (row.status === "ready" || row.status === "failed") processed += 1;
    else if (row.status === "pending") queued += 1;
  }
  return { processed, queued, lost: 0 };
};

async function burst(origin: string, count: number): Promise<LadderPage[]> {
  const pages: LadderPage[] = [];
  for (let index = 0; index < count; index += 1) {
    pages.push(await profileAtDemoLadder(origin));
  }
  return pages;
}

test("десятикратный всплеск: ни одно задание не потеряно, ожидание линейно, один вызов за раз", async (t) => {
  const support = await server<Support>("test-support.js");
  const store = await server<Store>("store.js");
  const llm = await load<Llm>("server/llm/dist/index.js");

  const inner = llm.answering(llm.envelope(), { pricing: PRICE }) as GenerationProvider;
  const provider = tracingProvider(inner);
  const testServer = await support.startTestServer(LLM_FAST, { provider, autostart: false });
  t.after(() => testServer.close());

  const pages = await burst(testServer.origin, BURST);
  assert.equal(pages.length, BURST);
  assert.equal(store.countJobs(testServer.db), BURST, "после всплеска в очереди не столько заданий, сколько поставили");

  const before = jobsOf(testServer.db);
  assert.equal(before.length, BURST);
  assert.ok(
    before.every((row) => row.status === "pending"),
    "к моменту слива часть заданий уже не в очереди",
  );

  await support.drainServer(testServer);

  const after = jobsOf(testServer.db);
  const tally = accounted(after);
  assert.equal(after.length, BURST, "после слива число строк в очереди изменилось — задание исчезло или появилось лишнее");
  assert.equal(tally.processed + tally.queued, BURST, "сумма обработанных и оставшихся в очереди не равна постановке");
  assert.equal(tally.queued, 0, "после слива в очереди остались живые задания");
  assert.ok(
    after.every((row) => row.status === "ready"),
    `не все задания готовы: ${after.map((row) => row.status).join(", ")}`,
  );

  assert.equal(provider.stats.maxInflight, 1, "одновременных вызовов провайдера больше одного — ожидание больше не линейно");
  assert.equal(provider.stats.startedAtTick.length, BURST);
  for (let index = 0; index < BURST; index += 1) {
    assert.equal(
      provider.stats.startedAtTick[index],
      index,
      `вызов ${index} стартовал на такте ${provider.stats.startedAtTick[index]}, а не на ${index}: ожидание выросло не как позиция в очереди`,
    );
  }

  const started = after.map((row) => row.started_at);
  for (let index = 1; index < started.length; index += 1) {
    const prev = started[index - 1];
    const next = started[index];
    assert.ok(prev && next, "у задания нет started_at — его не брали в работу");
    assert.ok(prev <= next, "очередь обработала более новое задание раньше старого — голодание");
  }

  for (const page of pages) {
    const state = await support.call<PageStateDto>(testServer.origin, "GET", `/api/p/${page.profileId}`);
    assert.equal(state.status, 200);
    assert.equal(state.body.state, "s4");
    const story = state.body.blocks.find((block) => block.id === "step4");
    assert.equal(story?.generation?.status, "ready");
  }
});

test("перезапуск: задания, стоявшие в очереди, не теряются и доигрываются", async (t) => {
  const support = await server<Support>("test-support.js");
  const store = await server<Store>("store.js");
  const llm = await load<Llm>("server/llm/dist/index.js");

  const dir = mkdtempSync(join(tmpdir(), "sdai-load-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "app.db");

  const first = await support.startTestServer(LLM_FAST, {
    autostart: false,
    provider: llm.answering(llm.envelope()),
    databasePath,
  });
  const pages = await burst(first.origin, BURST);
  assert.equal(store.countJobs(first.db), BURST);
  assert.ok(jobsOf(first.db).every((row) => row.status === "pending"));
  const ids = jobsOf(first.db).map((row) => row.generation_id).sort();
  await first.close();

  const second = await support.startTestServer(LLM_FAST, {
    autostart: false,
    provider: llm.answering(llm.envelope()),
    databasePath,
  });
  t.after(() => second.close());

  const restored = jobsOf(second.db);
  assert.equal(restored.length, BURST, "после перезапуска число заданий изменилось");
  assert.deepEqual(
    restored.map((row) => row.generation_id).sort(),
    ids,
    "идентификаторы заданий после перезапуска не те же",
  );
  assert.ok(
    restored.every((row) => row.status === "pending"),
    "после остановки живые задания сменили статус",
  );

  await support.drainServer(second);
  const done = jobsOf(second.db);
  assert.equal(done.length, BURST);
  assert.ok(done.every((row) => row.status === "ready"));
  for (const page of pages) {
    const state = await support.call<PageStateDto>(second.origin, "GET", `/api/p/${page.profileId}`);
    assert.equal(state.status, 200);
    assert.equal(state.body.blocks.find((block) => block.id === "step4")?.generation?.status, "ready");
  }
});

test("исчерпание лимита стоимости: страница читаема, человек видит отказ, а не ошибку сервера", async (t) => {
  const kit = await loadKit();
  const support = await server<Support>("test-support.js");
  const store = await server<Store>("store.js");
  const llm = await load<Llm>("server/llm/dist/index.js");
  const { createPageApp } = await web<{
    createPageApp: (host: ReturnType<typeof baseHost> & { timer: ManualTimer }) => PageApp;
  }>("src/app.js");
  const { createManualTimer } = await web<{ createManualTimer: () => ManualTimer }>("src/test-support.js");
  const { copy } = await web<{ copy: (id: string) => string }>("src/copy.js");

  const provider = llm.answering(llm.envelope(), { pricing: PRICE });
  const testServer = await support.startTestServer(
    { ...LLM_FAST, SDAI_LLM_PROFILE_COST_LIMIT_KOPECKS: "50" },
    { provider, autostart: false },
  );
  t.after(() => testServer.close());

  const page = await profileAtDemoLadder(testServer.origin);
  const job = store.findLatestJob(testServer.db, page.profileId, "step4");
  assert.ok(job);
  store.insertCall(testServer.db, {
    generationId: job.generationId,
    profileId: page.profileId,
    provider: "fake",
    model: "ledger",
    attempt: 0,
    inputTokens: 0,
    outputTokens: 0,
    costKopecks: 50,
    durationMs: 0,
    outcome: "ok",
  });

  const pending = await support.call<PageStateDto>(testServer.origin, "GET", `/api/p/${page.profileId}`);
  assert.equal(pending.status, 200, "пока задание живое, состояние страницы не должно быть ошибкой сервера");
  assert.equal(pending.body.blocks.find((block) => block.id === "step4")?.generation?.status, "pending");

  await support.drainServer(testServer);
  const failed = store.findLatestJob(testServer.db, page.profileId, "step4");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.failureCode, "cost_limit");

  const after = await support.call<PageStateDto>(testServer.origin, "GET", `/api/p/${page.profileId}`);
  assert.equal(after.status, 200, "после отказа по лимиту сервер ответил ошибкой, а не состоянием страницы");
  assert.equal(after.body.state, "s4");
  assert.equal(after.body.blocks.find((block) => block.id === "step4")?.generation?.status, "failed");

  const timer = createManualTimer();
  const host = { ...baseHost(testServer.origin, `/p/${page.profileId}`), timer };
  const app = createPageApp(host);
  t.after(() => app.stop());
  await app.start();
  timer.flush();
  await app.flushWatch();

  const tree = app.tree();
  assert.equal(
    typeof tree === "object" && tree !== null && "attrs" in tree ? tree.attrs["data-edge"] : null,
    "generation-failed",
  );
  assert.ok(kit.byClass(tree, "wait").length === 0, "после отказа всё ещё рисуется ожидание");
  const { visibleText } = await web<{ visibleText: (node: unknown) => string }>("src/dom.js");
  assert.ok(visibleText(tree).includes(copy("UI_EDGE_GENERATION_FAILED")));
  assert.equal(app.session().page?.state, "s4");
});
