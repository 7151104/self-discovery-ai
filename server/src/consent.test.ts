/**
 * Согласие в потоке (E9-01): отметка до сохранения ответов, без модального окна.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { answersForStep, call, currentConsentVersion, portionKey, profileBody, startTestServer } from "./test-support.js";
import { findConsent, insertConsent, listAnswers, listConsents } from "./store.js";
import { LEGAL_DOCUMENTS } from "./engine.js";
import { LEGAL_PATHS } from "./contract/index.js";
import type { ErrorDto, PageStateDto } from "./contract/index.js";

test("адреса документов в контракте совпадают с каталогом движка", () => {
  for (const item of LEGAL_DOCUMENTS) {
    assert.equal(LEGAL_PATHS[item.id], item.path, item.id);
  }
  assert.deepEqual(Object.keys(LEGAL_PATHS).sort(), LEGAL_DOCUMENTS.map((item) => item.id).sort());
});

test("без согласия сервер ответы не сохраняет", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", {
    name: "Аня",
    birthDate: null,
  });
  assert.equal(created.status, 201);
  assert.equal(findConsent(server.db, created.body.profileId), null);

  const denied = await call<ErrorDto>(server.origin, "POST", `/api/p/${created.body.profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "one",
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "consent_required");
  assert.equal(listAnswers(server.db, created.body.profileId).length, 0);
});

test("чужая версия согласия не записывается, ответы тоже не сохраняются", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", {
    name: "Аня",
    birthDate: null,
    consentVersion: "0".repeat(64),
  });
  assert.equal(created.status, 201);
  assert.equal(findConsent(server.db, created.body.profileId), null);

  const denied = await call<ErrorDto>(server.origin, "POST", `/api/p/${created.body.profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "one",
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "consent_required");
});

test("с версией текущего документа факт и отпечаток пишутся в базу", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const version = currentConsentVersion();
  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Аня", null));
  assert.equal(created.status, 201);

  const consent = findConsent(server.db, created.body.profileId);
  assert.ok(consent);
  assert.equal(consent.version, version);
  assert.equal(consent.version.length, 64);
  assert.match(consent.consentedAt, /^\d{4}-\d{2}-\d{2}T/);

  const saved = await call<PageStateDto>(server.origin, "POST", `/api/p/${created.body.profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "one",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.state, "s1");
  assert.equal(listAnswers(server.db, created.body.profileId).length, answersForStep(1).length);
});

test("правка ответа без согласия отклоняется", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", {
    name: "Аня",
    birthDate: null,
  });
  const denied = await call<ErrorDto>(
    server.origin,
    "PATCH",
    `/api/p/${created.body.profileId}/answers/${answersForStep(1)[0]?.questionId}`,
    { answer: answersForStep(1)[0] },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "consent_required");
});

test("смена отпечатка согласия пишет новую строку и не затирает ответы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", profileBody("Аня", null));
  assert.equal(created.status, 201);
  const profileId = created.body.profileId;
  const first = currentConsentVersion();
  assert.equal(findConsent(server.db, profileId)?.version, first);

  const saved = await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "keep-answers",
  });
  assert.equal(saved.status, 200);
  const count = listAnswers(server.db, profileId).length;
  assert.ok(count > 0);

  insertConsent(server.db, profileId, "a".repeat(64));
  assert.equal(findConsent(server.db, profileId)?.version, "a".repeat(64));
  assert.equal(listConsents(server.db, profileId).length, 2);

  const denied = await call<ErrorDto>(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(2),
    answers: answersForStep(2),
    requestId: "stale",
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "consent_required");
  assert.equal(listAnswers(server.db, profileId).length, count);

  const renewed = await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/consent`, {
    consentVersion: first,
  });
  assert.equal(renewed.status, 200);
  assert.equal(findConsent(server.db, profileId)?.version, first);
  assert.equal(listConsents(server.db, profileId).length, 2);

  const next = await call<PageStateDto>(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(2),
    answers: answersForStep(2),
    requestId: "after-renew",
  });
  assert.equal(next.status, 200);
  assert.ok(listAnswers(server.db, profileId).length > count);
});

test("страница документа читает markdown и не копирует его в код сервера", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const policy = readFileSync(new URL("../../content/legal/privacy-policy.md", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/legal-page.ts", import.meta.url), "utf8");
  assert.equal(source.includes("Какие данные обрабатываются"), false);

  const response = await fetch(`${server.origin}/legal/privacy`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.ok(html.includes("Какие данные обрабатываются"));
  assert.ok(html.includes("{{ОПЕРАТОР_ИНН}}"));
  assert.ok(html.includes("data-unfilled=\"ОПЕРАТОР_ИНН\""));
  assert.ok(html.includes("не заполнено"));
  assert.equal(html.includes("ООО «Ромашка»"), false);
  assert.ok(html.includes("/legal/offer"));
  assert.ok(html.includes("/legal/consent"));
  assert.ok(policy.includes("Какие данные обрабатываются"));
});

test("оферта, согласие и дисклеймеры открываются по постоянным адресам", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  for (const item of LEGAL_DOCUMENTS) {
    const response = await fetch(`${server.origin}${item.path}`);
    assert.equal(response.status, 200, item.path);
    const html = await response.text();
    assert.ok(html.includes(`data-legal="${item.id}"`));
    assert.ok(html.includes("<article"));
  }

  const missing = await fetch(`${server.origin}/legal/нет`);
  assert.equal(missing.status, 404);
});
