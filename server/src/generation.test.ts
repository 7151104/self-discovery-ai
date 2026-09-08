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
import { answering, DEMO_ANSWERS, envelope, FakeProvider, sliceEnvelope, textOfVolume, volumeOf, reportTypeOfSlice } from "../llm/dist/index.js";
import type { AnswerInput, GenerationResponse, PageStateDto, PortionDto } from "./contract/index.js";
import { rawContent, rawExtraContent } from "./engine.js";
import { sliceAnswers } from "../../engine/dist/slice-fixtures.js";
import { buildKeyring } from "./db/crypto.js";
import { up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import { crisisGate, enqueueStep4 } from "./generation.js";
import { setLogSink } from "./log.js";
import { parseSliceQuestionId } from "./page.js";
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
import { call, deliverWebhook, drainServer, profileAtStep, profileBody, startTestServer, TEST_KEY } from "./test-support.js";

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

test("кризисный крючок не ставит задание при блокирующей формулировке", () => {
  assert.equal(crisisGate("хочу умереть и не вижу смысла"), "skip");
  assert.equal(crisisGate("обычный открытый ответ про круг дел"), "enqueue");
});

test("кризисный открытый ответ не доходит до поддельного провайдера и не предлагает срез", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Артём", "1994-03-12"));
  let page = created.body;
  for (const step of [1, 2, 3] as const) {
    const reply = await call<PageStateDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: demoAnswersForStep(step),
      requestId: `crisis-${step}`,
    });
    page = reply.body;
  }

  const crisisText =
    "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь. Хочу умереть и не вижу смысла жить дальше.";
  const step4 = demoAnswersForStep(4).map((answer) =>
    answer.questionId === "L12" && answer.kind === "открытый" ? { ...answer, text: crisisText } : answer,
  );
  const after = await call<PageStateDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
    portion: "step:4",
    answers: step4,
    requestId: "crisis-4",
  });

  await drainServer(server);
  assert.equal(provider.callCount, 0, "кризисный текст не должен уходить в модель");
  assert.equal(findLatestJob(server.db, page.profileId, "step4"), null);

  assert.equal(after.body.offer, null, "предложения нет в API");
  assert.ok(after.body.crisis, "кризисное состояние не попало в API");
  assert.equal(after.body.crisis?.place, "ladder");

  const html = await fetch(`${server.origin}/p/${page.profileId}`);
  const text = await html.text();
  assert.equal(html.status, 200);
  assert.match(text, /<div id="app"><\/div>/);
  assert.match(text, /\/web\/src\/app\.js/);
  assert.ok(!text.includes('data-role="state"'), "временная оболочка не должна подменять клиента");
});

test("похожие, но не кризисные формулировки доходят до провайдера", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const asWritten = (form: string): string => (form.endsWith("*") ? `${form.slice(0, -1)}ось` : form);
  assert.ok(rawExtraContent.crisis.safe.length >= 8);
  for (const phrase of rawExtraContent.crisis.safe) {
    assert.equal(
      crisisGate(
        `Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша. ${asWritten(phrase)}.`,
      ),
      "enqueue",
      `крючок срезал «${phrase}»`,
    );
  }

  const safe = rawExtraContent.crisis.safe[0]!;
  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Артём", "1994-03-12"));
  let page = created.body;
  for (const step of [1, 2, 3] as const) {
    const reply = await call<PageStateDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: demoAnswersForStep(step),
      requestId: `safe-${step}`,
    });
    page = reply.body;
  }

  const answer =
    "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша, потом злюсь на себя. " +
    `${asWritten(safe)}.`;
  const step4 = demoAnswersForStep(4).map((item) =>
    item.questionId === "L12" && item.kind === "открытый" ? { ...item, text: answer } : item,
  );
  await call<PageStateDto>(server.origin, "POST", `/api/p/${page.profileId}/portions`, {
    portion: "step:4",
    answers: step4,
    requestId: "safe-4",
  });
  await drainServer(server);
  assert.equal(provider.callCount, 1, "некризисная похожая фраза не должна резать провайдера");
  assert.equal(findLatestJob(server.db, page.profileId, "step4")?.status, "ready");
});

const asSliceInput = (slice: string, portion: PortionDto, answers: ReturnType<typeof sliceAnswers>): AnswerInput[] =>
  portion.questions.map((question): AnswerInput => {
    const parsed = parseSliceQuestionId(question.id);
    const value = parsed ? answers[parsed.questionId] : undefined;
    if (question.kind === "выбор") {
      return { questionId: question.id, kind: "выбор", option: String(value ?? question.options[0]?.key) };
    }
    if (question.kind === "шкала") {
      return { questionId: question.id, kind: "шкала", scale: Number(value ?? 4) as 1 | 2 | 3 | 4 | 5 };
    }
    if (question.kind === "число") {
      const numbers = Array.isArray(value) ? value : typeof value === "number" ? [value] : [5, 2];
      return { questionId: question.id, kind: "число", numbers };
    }
    return { questionId: question.id, kind: "открытый", text: String(value ?? "") };
  });

async function answerSliceWith(
  origin: string,
  profileId: string,
  slice: string,
  answers: ReturnType<typeof sliceAnswers>,
): Promise<PageStateDto> {
  let page = (await call<PageStateDto>(origin, "GET", `/api/p/${profileId}`)).body;
  for (let guard = 0; guard < 5; guard += 1) {
    const portion = page.nextPortion;
    if (!portion || !portion.key.startsWith("slice:")) break;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${profileId}/portions`, {
      portion: portion.key,
      answers: asSliceInput(slice, portion, answers),
      requestId: `slice-${portion.key}`,
    });
    page = reply.body;
  }
  return page;
}

test("платный срез: непройденный порог не вызывает провайдера и возвращает уточняющие", async (t) => {
  const provider = answering(envelope(), { pricing: PRICE });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  await drainServer(server);
  const afterLadder = provider.callCount;
  const slice = "slice_node_finish";

  const order = await call<{ order: { orderId: string; price: number; payment: { url: string } | null } }>(
    server.origin,
    "POST",
    `/api/p/${page.profileId}/orders`,
    { slice, requestId: `buy-${slice}` },
  );
  await deliverWebhook(server.origin, {
    kind: "payment.succeeded",
    orderId: order.body.order.orderId,
    reference: order.body.order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "",
    amount: order.body.order.price,
  });

  const weak = { ...sliceAnswers(slice), S8: "мало слов", S9: "D" };
  const afterAnswers = await answerSliceWith(server.origin, page.profileId, slice, weak);
  await drainServer(server);

  assert.equal(provider.callCount, afterLadder, "порог не взят, а провайдера вызвали на срез");
  assert.equal(findLatestJob(server.db, page.profileId, `slice:${slice}`), null);
  assert.ok(afterAnswers.clarifications, "уточняющих нет");
  assert.equal(afterAnswers.clarifications?.slice, slice);
  assert.ok((afterAnswers.clarifications?.questions.length ?? 0) > 0);
  assert.deepEqual(afterAnswers.blocks.find((block) => block.id === `slice:${slice}`)?.paragraphs, []);
});

test("платный срез: пройденный порог даёт отчёт", async (t) => {
  const provider = new FakeProvider({
    turns: [{ kind: "ответ", text: envelope() }],
    pricing: PRICE,
  });
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtDemoLadder(server.origin);
  await drainServer(server);

  const slice = "slice_node_finish";
  const order = await call<{ order: { orderId: string; price: number; payment: { url: string } | null } }>(
    server.origin,
    "POST",
    `/api/p/${page.profileId}/orders`,
    { slice, requestId: `buy-ok-${slice}` },
  );
  await deliverWebhook(server.origin, {
    kind: "payment.succeeded",
    orderId: order.body.order.orderId,
    reference: order.body.order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "",
    amount: order.body.order.price,
  });

  const type = reportTypeOfSlice(slice);
  const volume = volumeOf(type);
  provider.setTurns([{ kind: "ответ", text: sliceEnvelope(textOfVolume(volume.min, volume.max)) }]);

  const afterAnswers = await answerSliceWith(server.origin, page.profileId, slice, sliceAnswers(slice));
  await drainServer(server);

  assert.equal(afterAnswers.clarifications ?? null, null);
  const job = findLatestJob(server.db, page.profileId, `slice:${slice}`);
  assert.equal(job?.status, "ready", job?.failureCode ?? "задания нет");
  const block = (await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`)).body.blocks.find(
    (item) => item.id === `slice:${slice}`,
  );
  assert.ok(block);
  assert.ok((block.paragraphs.length ?? 0) > 0);
});

test("провайдер по умолчанию доводит ступень 4 до ready на живом профиле", async (t) => {
  const server = await startTestServer(LLM_FAST);
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  await drainServer(server);

  const job = findLatestJob(server.db, page.profileId, "step4");
  assert.equal(job?.status, "ready", job?.failureCode ?? "задания нет");
  const state = (await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`)).body;
  const block = state.blocks.find((item) => item.id === "step4");
  assert.ok(block);
  assert.equal(block.generation?.status, "ready");
  assert.ok(block.paragraphs.length >= 3, "блок ступени 4 пришёл без текста");
  assert.notEqual(block.generation?.status, "failed");
});

/**
 * Срезы разных машинных типов: у узлового объём вдвое меньше, чем у прикладного,
 * и на живом сервере оба должны доходить до готового блока. Разбор развилки
 * сюда не входит: его порог требует подтип координаты 14, а тот приходит
 * отдельным срезом — объём того типа проверяется тестом заглушки.
 */
for (const slice of ["slice_node_finish", "slice_work"]) {
  test(`провайдер по умолчанию доводит оплаченный срез ${slice} до ready`, async (t) => {
    const server = await startTestServer(LLM_FAST);
    t.after(() => server.close());

    const page = await profileAtDemoLadder(server.origin);
    await drainServer(server);

    const order = await call<{ order: { orderId: string; price: number; payment: { url: string } | null } }>(
      server.origin,
      "POST",
      `/api/p/${page.profileId}/orders`,
      { slice, requestId: `buy-stub-${slice}` },
    );
    await deliverWebhook(server.origin, {
      kind: "payment.succeeded",
      orderId: order.body.order.orderId,
      reference: order.body.order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "",
      amount: order.body.order.price,
    });

    await answerSliceWith(server.origin, page.profileId, slice, sliceAnswers(slice));
    await drainServer(server);

    const job = findLatestJob(server.db, page.profileId, `slice:${slice}`);
    assert.equal(job?.status, "ready", job?.failureCode ?? "задания нет");
    const block = (await call<PageStateDto>(server.origin, "GET", `/api/p/${page.profileId}`)).body.blocks.find(
      (item) => item.id === `slice:${slice}`,
    );
    assert.ok(block);
    assert.equal(block.generation?.status, "ready");
    assert.ok((block.paragraphs.length ?? 0) > 0);
  });
}

test("generation.failed не кладёт фразу человека в журнал", async (t) => {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  t.after(() => setLogSink(null));

  const provider = answering(envelope());
  const server = await startTestServer(LLM_FAST, { provider });
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  await drainServer(server);

  const job = findLatestJob(server.db, page.profileId, "step4");
  assert.equal(job?.status, "failed");
  assert.equal(job?.failureCode, "validation");

  const journal = lines.join("\n");
  assert.ok(journal.includes("generation.failed"), journal);
  const leaked = ["берусь за дело", "без всякого желания", "Ты сам назвал круг", "тащу всё сам", "крендельковый"];
  for (const phrase of leaked) {
    assert.equal(journal.includes(phrase), false, `в журнал попала фраза «${phrase}»\n${journal}`);
  }
  assert.match(journal, /quote_not_from_answer|register_gt_confidence/);
});
