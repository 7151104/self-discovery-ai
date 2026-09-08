/**
 * Продуктовая воронка и метрики генерации (E10-07, E10-08).
 *
 * Приёмка: воронка и метрики видны одной служебной ручкой; каждое событие
 * несёт профиль, ступень и версию сборки; в событиях и метриках нет имени,
 * даты рождения, открытого ответа, промпта и текста генерации.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API } from "./contract/index.js";
import { HIDDEN } from "./log.js";
import { buildFunnel, buildMetrics, FUNNEL_STAGES, recordFunnel } from "./funnel.js";
import { failJob, insertCall, insertJob, listEvents, saveBlockContent } from "./store.js";
import { call, profileAtStep, purchaseSlice, startTestServer } from "./test-support.js";
import type { FunnelSnapshot, MetricsSnapshot } from "./funnel.js";
import type { ErrorDto, PageStateDto } from "./contract/index.js";

const ADMIN = "admin-ok";
const ADMIN_ENV = { SDAI_ADMIN_SECRET: ADMIN, SDAI_BUILD_VERSION: "2026-09-08-funnel" };
const SECRETS = ["Аня", "1990-05-05", "берусь за дело"] as const;
const POISON = {
  name: "Аня",
  birthDate: "1990-05-05",
  answer: "Обычно я берусь за дело быстро и с интересом",
  prompt: "Собери разбор по открытому ответу человека",
  text: "Ты сам назвал круг незавершённого",
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "tools", "funnel.mjs");

const adminGet = <T>(origin: string, path: string, secret = ADMIN) =>
  call<T>(origin, "GET", path, undefined, { authorization: `Bearer ${secret}` });

const assertClean = (text: string, label: string): void => {
  for (const secret of SECRETS) {
    assert.ok(!text.includes(secret), `${label}: утекло «${secret}»: ${text}`);
  }
  assert.ok(!text.includes("Собери разбор"), `${label}: утекло промпт`);
  assert.ok(!text.includes("назвал круг"), `${label}: утекло текст генерации`);
  assert.ok(!/[А-Яа-яЁё]/.test(text.replace(/\[скрыто\]/g, "")), `${label}: кириллица: ${text}`);
};

test("воронка закрывает восемь ступеней приёмки и не торчит в контракте клиента", () => {
  assert.deepEqual(
    FUNNEL_STAGES.map((stage) => stage.id),
    ["entry", "portion", "block", "hook", "share", "offer", "payment", "slice"],
  );
  assert.ok(!Object.values(API).some((route) => route.path.startsWith("/api/admin")));
});

test("каждое событие несёт ступень и версию сборки, показ не плодится", async (t) => {
  const server = await startTestServer(ADMIN_ENV);
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  await call(server.origin, "GET", `/api/p/${page.profileId}`);
  await call(server.origin, "GET", `/api/p/${page.profileId}`);

  const events = listEvents(server.db, page.profileId);
  assert.ok(events.some((event) => event.type === "profile.created"));
  assert.equal(events.filter((event) => event.type === "portion.submitted").length, 4);
  assert.ok(events.some((event) => event.type === "block.shown"));
  assert.ok(events.some((event) => event.type === "hook.shown"));
  assert.ok(events.some((event) => event.type === "offer.shown"));

  for (const event of events) {
    const payload = JSON.parse(event.payload) as { step?: unknown; version?: unknown };
    assert.equal(typeof payload.step, "string", event.type);
    assert.notEqual(payload.step, "");
    assert.equal(payload.version, "2026-09-08-funnel", event.type);
  }

  const hooks = events.filter((event) => event.type === "hook.shown");
  assert.equal(hooks.length, 1, "повторный GET не должен писать крючок второй раз");
});

test("оплата, шеринг и готовый срез входят в воронку", async (t) => {
  const server = await startTestServer(ADMIN_ENV);
  t.after(() => server.close());

  const paid = await purchaseSlice(server.origin);
  await call(server.origin, "POST", `/api/p/${paid.page.profileId}/share`);
  const shared = (await call<PageStateDto>(server.origin, "GET", `/api/p/${paid.page.profileId}`)).body;
  assert.ok(shared.share?.url);
  const token = shared.share.url.split("/s/")[1] ?? "";
  await call(server.origin, "GET", `/api/s/${token}`);

  saveBlockContent(server.db, paid.page.profileId, {
    slot: `slice:${paid.slice}`,
    profileVersion: 1,
    purchased: true,
    heading: "slice",
    paragraphs: ["ok"],
    highlight: null,
  });
  await call(server.origin, "GET", `/api/p/${paid.page.profileId}`);

  const events = listEvents(server.db, paid.page.profileId);
  const types = new Set(events.map((event) => event.type));
  assert.ok(types.has("order.created"));
  assert.ok(types.has("order.paid"));
  assert.ok(types.has("share.enabled"));
  assert.ok(types.has("share.viewed"));
  assert.ok(types.has("slice.ready"));
});

test("персональные данные не проходят ни в событие, ни в метрику", async (t) => {
  const server = await startTestServer(ADMIN_ENV);
  t.after(() => server.close());

  recordFunnel(server.db, "probe.poison", {
    profileId: null,
    step: "none",
    version: "2026-09-08-funnel",
    payload: POISON,
  });

  const page = await profileAtStep(server.origin, 4);
  const events = listEvents(server.db, page.profileId);
  assertClean(events.map((event) => event.payload).join(" "), "события профиля");

  const poisoned = server.db.get<{ payload: string }>(
    "SELECT payload FROM events WHERE type = 'probe.poison'",
  );
  assert.ok(poisoned);
  assertClean(poisoned.payload, "отравленное событие");
  const hidden = JSON.parse(poisoned.payload) as Record<string, unknown>;
  assert.equal(hidden["name"], HIDDEN);
  assert.equal(hidden["answer"], HIDDEN);
  assert.equal(hidden["prompt"], HIDDEN);
  assert.equal(hidden["text"], HIDDEN);

  const funnel = await adminGet<FunnelSnapshot>(server.origin, "/api/admin/funnel");
  const metrics = await adminGet<MetricsSnapshot>(server.origin, "/api/admin/metrics");
  assert.equal(funnel.status, 200);
  assert.equal(metrics.status, 200);
  assertClean(JSON.stringify(funnel.body), "воронка");
  assertClean(JSON.stringify(metrics.body), "метрики");
});

test("ручки за секретом: без него отказ, с ним — воронка и метрики", async (t) => {
  const server = await startTestServer(ADMIN_ENV);
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 1);
  const denied = await call<ErrorDto>(server.origin, "GET", "/api/admin/funnel");
  assert.equal(denied.status, 401);
  const wrong = await adminGet<ErrorDto>(server.origin, "/api/admin/funnel", "other");
  assert.equal(wrong.status, 401);
  const post = await call<ErrorDto>(server.origin, "POST", "/api/admin/funnel", {}, { authorization: `Bearer ${ADMIN}` });
  assert.equal(post.status, 405);

  const funnel = await adminGet<FunnelSnapshot>(server.origin, "/api/admin/funnel");
  assert.equal(funnel.status, 200);
  assert.equal(funnel.body.version, "2026-09-08-funnel");
  assert.equal(funnel.body.stages.length, 8);
  const entry = funnel.body.stages.find((stage) => stage.id === "entry");
  const portion = funnel.body.stages.find((stage) => stage.id === "portion");
  assert.equal(entry?.profiles, 1);
  assert.ok((portion?.events ?? 0) >= 1);

  insertCall(server.db, {
    generationId: null,
    profileId: page.profileId,
    provider: "fake",
    model: "ledger",
    attempt: 1,
    inputTokens: 10,
    outputTokens: 20,
    costKopecks: 40,
    durationMs: 100,
    outcome: "ok",
  });
  insertCall(server.db, {
    generationId: null,
    profileId: page.profileId,
    provider: "fake",
    model: "ledger",
    attempt: 2,
    inputTokens: 10,
    outputTokens: 20,
    costKopecks: 20,
    durationMs: 50,
    outcome: "ok",
  });
  const accepted = insertJob(server.db, page.profileId, {
    slot: "step4",
    inputHash: "hash-ok",
    contentVersion: "v",
    regenerated: false,
    requestId: "job-ok",
  });
  failJob(server.db, accepted.job, "validation");
  const other = insertJob(server.db, page.profileId, {
    slot: "step4",
    inputHash: "hash-ready",
    contentVersion: "v",
    regenerated: false,
    requestId: "job-ready",
  });
  server.db.run("UPDATE generation_jobs SET status = 'ready', active_slot = NULL, failure_code = NULL WHERE generation_id = ?", [
    other.job.generationId,
  ]);

  const metrics = await adminGet<MetricsSnapshot>(server.origin, "/api/admin/metrics");
  assert.equal(metrics.status, 200);
  assert.equal(metrics.body.version, "2026-09-08-funnel");
  assert.equal(metrics.body.generation.calls, 2);
  assert.equal(metrics.body.generation.avgDurationMs, 75);
  assert.equal(metrics.body.generation.totalCostKopecks, 60);
  assert.equal(metrics.body.profileCost.profiles, 1);
  assert.equal(metrics.body.profileCost.avgKopecks, 60);
  assert.equal(metrics.body.validator.jobs, 2);
  assert.equal(metrics.body.validator.rejected, 1);
  assert.equal(metrics.body.validator.rejectionRate, 0.5);
});

test("пустой секрет никого не пускает, сводка на пустой базе нулевая", async (t) => {
  const server = await startTestServer({ SDAI_BUILD_VERSION: "empty-admin" });
  t.after(() => server.close());

  const denied = await adminGet<ErrorDto>(server.origin, "/api/admin/metrics", "admin-ok");
  assert.equal(denied.status, 401);

  const emptyFunnel = buildFunnel(server.db, "empty-admin");
  const emptyMetrics = buildMetrics(server.db, "empty-admin");
  assert.equal(emptyFunnel.stages.every((stage) => stage.events === 0 && stage.profiles === 0), true);
  assert.equal(emptyMetrics.generation.calls, 0);
  assert.equal(emptyMetrics.generation.avgDurationMs, null);
  assert.equal(emptyMetrics.profileCost.avgKopecks, null);
  assert.equal(emptyMetrics.validator.rejectionRate, null);
});

test("скрипт печатает воронку и метрики таблицей", async (t) => {
  const server = await startTestServer(ADMIN_ENV);
  t.after(() => server.close());
  await profileAtStep(server.origin, 1);

  const run = (): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, server.origin], {
        env: { ...process.env, SDAI_ADMIN_SECRET: ADMIN },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  const printed = await run();
  assert.equal(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /воронка version=2026-09-08-funnel/);
  assert.match(printed.stdout, /profile\.created/);
  assert.match(printed.stdout, /метрики version=2026-09-08-funnel/);
  assert.match(printed.stdout, /avgDurationMs=/);
  for (const secret of SECRETS) {
    assert.ok(!printed.stdout.includes(secret), `скрипт: утекло «${secret}»`);
  }
});
