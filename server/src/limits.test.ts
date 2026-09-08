/**
 * Ограничение частоты и защита от перебора (E3-10).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { answersForStep, call, portionKey, profileBody, startTestServer } from "./test-support.js";
import { RateLimiter, type RateRules } from "./http/rate-limit.js";
import { DEFAULTS, loadConfig } from "./config.js";
import { newProfileId } from "./ids.js";
import type { PageStateDto } from "./contract/index.js";

const countProfiles = (db: { get: <T extends object>(sql: string) => T | null }): number =>
  db.get<{ total: number }>("SELECT COUNT(*) AS total FROM profiles")?.total ?? 0;

test("скользящее окно пропускает ровно столько, сколько разрешено", () => {
  const rules: RateRules = {
    createProfile: { limit: 2, windowMs: 1000 },
    portion: { limit: 2, windowMs: 1000 },
    state: { limit: 2, windowMs: 1000 },
    miss: { limit: 2, windowMs: 1000 },
    errors: { limit: 2, windowMs: 1000 },
  };
  const limiter = new RateLimiter(rules, true);

  assert.equal(limiter.take("state", "a", 0).allowed, true);
  assert.equal(limiter.take("state", "a", 100).allowed, true);
  const denied = limiter.take("state", "a", 200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 800);

  // Счётчики у разных клиентов и у разных корзин раздельные.
  assert.equal(limiter.take("state", "b", 200).allowed, true);
  assert.equal(limiter.take("portion", "a", 200).allowed, true);

  // Окно уехало — место освободилось.
  assert.equal(limiter.take("state", "a", 1101).allowed, true);

  limiter.sweep(10_000);
  assert.equal(limiter.take("state", "a", 10_000).allowed, true);
});

test("выключенный лимитер пропускает всё", () => {
  const limiter = new RateLimiter(DEFAULTS.rate, false);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    assert.equal(limiter.take("createProfile", "a").allowed, true);
  }
});

test("превышение лимита создания профилей возвращает отказ и не создаёт записей", async (t) => {
  const server = await startTestServer({ SDAI_RATE_CREATE_PROFILE: "2" });
  t.after(() => server.close());

  const body = { name: "Аня", birthDate: null };
  assert.equal((await call(server.origin, "POST", "/api/profiles", body)).status, 201);
  assert.equal((await call(server.origin, "POST", "/api/profiles", body)).status, 201);
  assert.equal(countProfiles(server.db), 2);

  const denied = await call<{ error: { code: string } }>(server.origin, "POST", "/api/profiles", body);
  assert.equal(denied.status, 429);
  assert.equal(denied.body.error.code, "rate_limited");
  assert.equal(countProfiles(server.db), 2);
});

test("превышение лимита порции не записывает ответы", async (t) => {
  const server = await startTestServer({ SDAI_RATE_PORTION: "1" });
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Аня", null));
  const profileId = created.body.profileId;

  const first = await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "one",
  });
  assert.equal(first.status, 200);

  const denied = await call<{ error: { code: string } }>(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(2),
    answers: answersForStep(2),
    requestId: "two",
  });
  assert.equal(denied.status, 429);

  const state = await call<PageStateDto>(server.origin, "GET", `/api/p/${profileId}`);
  assert.equal(state.body.state, "s1");
  assert.equal(state.body.nextPortion?.key, "step:2");
});

test("перебор идентификаторов упирается в отдельный счётчик промахов", async (t) => {
  const server = await startTestServer({ SDAI_RATE_MISS: "3", SDAI_RATE_STATE: "1000" });
  t.after(() => server.close());

  const codes: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    codes.push((await call(server.origin, "GET", `/api/p/${newProfileId()}`)).status);
  }
  assert.deepEqual(codes, [404, 404, 404, 429, 429]);

  // Публичные токены считаются тем же счётчиком: перебор ссылок тоже перебор.
  assert.equal((await call(server.origin, "GET", `/api/s/${newProfileId()}`)).status, 429);
});

test("промахи не расходуют лимит у того, кто ходит по своей странице", async (t) => {
  const server = await startTestServer({ SDAI_RATE_MISS: "1" });
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", { name: "Аня", birthDate: null });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const reply = await call(server.origin, "GET", `/api/p/${created.body.profileId}`);
    assert.equal(reply.status, 200);
  }
});

test("лимиты настраиваются переменными окружения и выключаются целиком", () => {
  const configured = loadConfig({
    SDAI_RATE_CREATE_PROFILE: "5",
    SDAI_RATE_PORTION: "7",
    SDAI_RATE_STATE: "9",
    SDAI_RATE_MISS: "11",
    SDAI_RATE_ERROR: "13",
  });
  assert.equal(configured.rateLimit.enabled, true);
  assert.equal(configured.rateLimit.rules.createProfile.limit, 5);
  assert.equal(configured.rateLimit.rules.portion.limit, 7);
  assert.equal(configured.rateLimit.rules.state.limit, 9);
  assert.equal(configured.rateLimit.rules.miss.limit, 11);
  assert.equal(configured.rateLimit.rules.errors.limit, 13);

  assert.equal(loadConfig({ SDAI_RATE_LIMIT: "0" }).rateLimit.enabled, false);
  assert.throws(() => loadConfig({ SDAI_RATE_PORTION: "0" }), /config:expected-positive-integer:SDAI_RATE_PORTION/);
});
