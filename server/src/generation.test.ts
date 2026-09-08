/**
 * Очередь генерации (E4-03), журнал стоимости (E4-10), кэш и деградация (E4-11).
 *
 * Сети нет: провайдер поддельный. Ходы — ответ, временный отказ, зависание.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { answering, DEMO_ANSWERS, envelope, FakeProvider } from "../llm/dist/index.js";
import type { AnswerInput, GenerationResponse, PageStateDto } from "./contract/index.js";
import { rawContent } from "./engine.js";
import { buildKeyring } from "./db/crypto.js";
import { up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import { crisisGate, enqueueStep4 } from "./generation.js";
import {
  countJobs,
  findActiveJob,
  findLatestJob,
  insertCall,
  insertJob,
  insertProfile,
  listAnswers,
  listCalls,
  profileCostKopecks,
  saveCache,
  saveJobResult,
} from "./store.js";
import { call, drainServer, profileBody, startTestServer, TEST_KEY } from "./test-support.js";

const LLM_FAST = {
  SDAI_LLM_ATTEMPTS: "1",
  SDAI_LLM_TIMEOUT_MS: "80",
  SDAI_LLM_BACKOFF_MS: "0",
  SDAI_LLM_PROFILE_COST_LIMIT_KOPECKS: "1000000",
};

/** Цена такая, чтобы в журнале была ненулевая сумма и потолок её не резал. */
const PRICE = { inputKopecksPerMillion: 10_000, outputKopecksPerMillion: 10_000 };

function demoAnswersForStep(step: 1 | 2 | 3 | 4): AnswerInput[] {
  return rawContent.questions
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

/** Профиль демо-человека: эталонный конверт `envelope()` проходит валидатор. */
async function profileAtDemoLadder(origin: string): Promise<PageStateDto> {
  const created = await call<PageStateDto>(origin, "POST", "/api/profiles", profileBody("Артём", "1994-03-12"));
  let page = created.body;
  for (const step of [1, 2, 3, 4] as const) {
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: demoAnswersForStep(step),
      requestId: `demo-${step}`,
    });
    page = reply.body;
  }
  return page;
}

test("уникальный индекс не даёт двум живым заданиям занять один слот", () => {
  const db = openDatabase({ path: ":memory:" });
  try {
    up(db);
    insertProfile(db, { profileId: "p1", name: "Аня", birthDate: null });
    const timestamp = new Date().toISOString();
    const insert = (id: string): void => {
      db.run(
        `INSERT INTO generation_jobs
           (generation_id, profile_id, slot, status, active_slot, input_hash, content_version,
            regenerated, request_id, result_payload, result_enc, failure_code, attempt_count,
            next_attempt_at, created_at, updated_at, started_at, finished_at)
         VALUES (?, 'p1', 'step4', 'pending', 'step4', 'h', 'v',
                 0, NULL, NULL, 'none', NULL, 0, NULL, ?, ?, NULL, NULL)`,
        [id, timestamp, timestamp],
      );
    };
    insert("aaaaaaaaaaaaaaaaaaaaaa");
    assert.throws(() => insert("bbbbbbbbbbbbbbbbbbbbbb"), /UNIQUE constraint failed/);

    db.run(
      "UPDATE generation_jobs SET active_slot = NULL, status = 'ready' WHERE generation_id = 'aaaaaaaaaaaaaaaaaaaaaa'",
    );
    insert("cccccccccccccccccccccc");
    assert.equal(countJobs(db, "p1"), 2);
  } finally {
    db.close();
  }
});

test("два одновременных запроса дают одну генерацию", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  assert.equal(countJobs(server.db, page.profileId), 1);

  const [first, second] = await Promise.all([
    call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`),
    call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(countJobs(server.db, page.profileId), 1);

  const hash = findLatestJob(server.db, page.profileId, "step4")!.inputHash;
  const once = insertJob(server.db, page.profileId, {
    slot: "step4",
    inputHash: hash,
    contentVersion: "x",
    regenerated: false,
    requestId: null,
  });
  const twice = insertJob(server.db, page.profileId, {
    slot: "step4",
    inputHash: "other",
    contentVersion: "x",
    regenerated: false,
    requestId: null,
  });
  assert.equal(once.created, false);
  assert.equal(twice.created, false);
  assert.equal(once.job.generationId, twice.job.generationId);

  const profile = {
    profileId: page.profileId,
    name: "Артём",
    birthDate: "1990-05-05",
    version: 1,
    createdAt: "",
    updatedAt: "",
  };
  assert.equal(enqueueStep4({ db: server.db, llm: server.llm }, profile)?.generationId, once.job.generationId);

  await drainServer(server);
  assert.equal(provider.callCount, 1, "провайдера вызвали один раз");
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.status, "ready");
});

test("после перезапуска сервера незавершённое задание доигрывается", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sdai-gen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "app.db");

  const hanging = new FakeProvider({ turns: [{ kind: "зависание" }] });
  const first = await startTestServer({}, { autostart: true, provider: hanging, databasePath });
  const page = await profileAtDemoLadder(first.origin);
  const profileId = page.profileId;
  assert.equal(findLatestJob(first.db, profileId, "step4")?.status, "pending");
  await first.close();

  const provider = answering(envelope());
  const second = await startTestServer({}, { autostart: false, provider, databasePath });
  t.after(() => second.close());
  assert.equal(findLatestJob(second.db, profileId, "step4")?.status, "pending");
  await drainServer(second);

  const done = findLatestJob(second.db, profileId, "step4");
  assert.equal(done?.status, "ready");
  assert.ok((done?.result?.paragraphs.length ?? 0) > 0);
  assert.equal(provider.callCount, 1);
});

test("повторный запрос при неизменном входе не вызывает провайдера", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  await drainServer(server);
  assert.equal(provider.callCount, 1);
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.status, "ready");

  await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`);
  await drainServer(server);
  assert.equal(provider.callCount, 1, "готовое задание с тем же хешем не зовёт модель");

  const latest = findLatestJob(server.db, page.profileId, "step4");
  assert.ok(latest);
  const extra = insertJob(server.db, page.profileId, {
    slot: "step4",
    inputHash: latest.inputHash,
    contentVersion: latest.contentVersion,
    regenerated: false,
    requestId: "cache-retry",
  });
  assert.equal(extra.created, true);
  await drainServer(server);
  assert.equal(provider.callCount, 1, "кэш по хешу входа закрыл второй прогон");
  assert.ok(listCalls(server.db, page.profileId).some((entry) => entry.outcome === "cached"));
});

test("при временном отказе провайдера ответы сохранены, страница читаема, задание доигрывается", async (t) => {
  const provider = new FakeProvider({ turns: [{ kind: "временный отказ", code: "503" }], pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  const open = listAnswers(server.db, page.profileId).find((row) => row.kind === "открытый");
  assert.ok(open && String(open.value).length > 20);

  await drainServer(server);
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.status, "pending");
  assert.ok(findActiveJob(server.db, page.profileId, "step4"));

  const readable = await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`);
  assert.equal(readable.status, 200);
  assert.equal(readable.body.card.name, "Артём");
  assert.equal(readable.body.state, "s4");
  const after = listAnswers(server.db, page.profileId).find((row) => row.kind === "открытый");
  assert.equal(after?.value, open.value);

  provider.setTurns([{ kind: "ответ", text: envelope() }]);
  await drainServer(server);
  const done = findLatestJob(server.db, page.profileId, "step4");
  assert.equal(done?.status, "ready");
  assert.ok((done?.result?.paragraphs.length ?? 0) > 0);
});

test("журнал вызовов хранит токены, стоимость, время и модель; себестоимость — сумма", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE, model: "fake-cost" });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  await drainServer(server);

  const calls = listCalls(server.db, page.profileId);
  const ok = calls.find((entry) => entry.outcome === "ok");
  assert.ok(ok, "успешный вызов не записан");
  assert.ok(ok.inputTokens > 0);
  assert.ok(ok.outputTokens > 0);
  assert.ok(ok.costKopecks > 0);
  assert.ok(ok.durationMs >= 0);
  assert.equal(ok.model, "fake-cost");
  assert.equal(ok.provider, "fake");
  assert.equal(
    profileCostKopecks(server.db, page.profileId),
    calls.reduce((sum, entry) => sum + entry.costKopecks, 0),
  );
});

test("потолок себестоимости считается по сумме журнала, а не только по оценке", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(
    { ...LLM_FAST, SDAI_LLM_PROFILE_COST_LIMIT_KOPECKS: "50" },
    { provider },
  );
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  const job = findLatestJob(server.db, page.profileId, "step4");
  assert.ok(job);
  insertCall(server.db, {
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
  assert.equal(profileCostKopecks(server.db, page.profileId), 50);

  await drainServer(server);
  assert.equal(provider.callCount, 0, "журнал уже исчерпал потолок — провайдера не зовут");
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.status, "failed");
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.failureCode, "cost_limit");
});

test("ручная регенерация помечает прогон и обходит кэш", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  await drainServer(server);
  const afterFirst = provider.callCount;
  assert.ok(afterFirst >= 1);

  const regen = await call<GenerationResponse>(server.origin, "POST", `/api/p/${page.profileId}/generations`, {
    requestId: "regen-1",
  });
  assert.equal(regen.status, 200);
  assert.equal(regen.body.generation.regenerated, true);
  assert.equal(regen.body.generation.status, "pending");

  const repeat = await call<GenerationResponse>(server.origin, "POST", `/api/p/${page.profileId}/generations`, {
    requestId: "regen-1",
  });
  assert.equal(repeat.body.generation.id, regen.body.generation.id);

  await drainServer(server);
  assert.ok(provider.callCount > afterFirst, "регенерация обязана вызвать провайдера");
  const latest = findLatestJob(server.db, page.profileId, "step4");
  assert.equal(latest?.regenerated, true);
  assert.equal(latest?.status, "ready");

  const status = await call<GenerationResponse>(
    server.origin,
    "GET",
    `/api/p/${page.profileId}/generations/${latest?.generationId}`,
  );
  assert.equal(status.body.generation.regenerated, true);
});

test("при постоянном отказе провайдера ответы сохранены, страница читаема", async (t) => {
  const provider = new FakeProvider({ turns: [{ kind: "постоянный отказ", code: "auth" }], pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  const open = listAnswers(server.db, page.profileId).find((row) => row.kind === "открытый");
  assert.ok(open && String(open.value).length > 20);

  await drainServer(server);
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.status, "failed");

  const readable = await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`);
  assert.equal(readable.status, 200);
  assert.equal(readable.body.card.name, "Артём");
  assert.equal(readable.body.state, "s4");
  const after = listAnswers(server.db, page.profileId).find((row) => row.kind === "открытый");
  assert.equal(after?.value, open.value);
  assert.equal(countJobs(server.db, page.profileId), 1, "повторный GET не ставит второе задание на тот же отказ");
});

test("результат задания и кэш в файле базы не лежат открытым текстом", () => {
  const db = openDatabase({ path: ":memory:", keys: buildKeyring(TEST_KEY, []) });
  try {
    up(db);
    insertProfile(db, { profileId: "p1", name: "Аня", birthDate: null });
    const { job } = insertJob(db, "p1", {
      slot: "step4",
      inputHash: "hash",
      contentVersion: "ver",
      regenerated: false,
      requestId: null,
    });
    const secret = "Ты доводишь до предпоказа и там останавливаешься.";
    const result = {
      heading: "Как это складывается",
      paragraphs: [secret],
      highlight: null,
      storyline: { value: "круг", code: "loop", confidence: "low" as const },
    };
    saveJobResult(db, job, result);
    saveCache(db, "p1", { inputHash: "hash", contentVersion: "ver", result });

    const raw = [
      ...db.all<{ v: string | null }>("SELECT result_payload AS v FROM generation_jobs"),
      ...db.all<{ v: string | null }>("SELECT result_payload AS v FROM generation_cache"),
    ]
      .map((row) => row.v ?? "")
      .join(" ");
    assert.ok(!raw.includes("предпоказа"), "результат генерации записан открытым текстом");
  } finally {
    db.close();
  }
});

test("удаление профиля уносит задания, журнал вызовов и кэш", async (t) => {
  const provider = answering(envelope());
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  await drainServer(server);
  assert.ok(countJobs(server.db, page.profileId) > 0);

  await call(server.origin, "DELETE", `/api/p/${page.profileId}`);
  for (const table of ["generation_jobs", "generation_calls", "generation_cache"]) {
    const left = server.db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE profile_id = ?`, [
      page.profileId,
    ]);
    assert.equal(left?.total, 0, `${table}: остались записи удалённого профиля`);
  }
});

test("кризисный крючок не ставит задание сам: место для E4-06", () => {
  assert.equal(crisisGate("хочу умереть и не вижу смысла"), "enqueue");
  assert.equal(crisisGate("обычный открытый ответ про круг дел"), "enqueue");
});
