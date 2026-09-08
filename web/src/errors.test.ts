/**
 * Клиентский сбор ошибок (E10-06).
 *
 * Проверяется, что искусственная ошибка уходит на эндпоинт тем же телом,
 * которое примет сервер, и что в полезную нагрузку не кладутся поля про человека.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ERROR_ENDPOINT,
  installClientErrorReporter,
  payloadFromError,
  reportClientError,
} from "./errors.js";

test("полезная нагрузка несёт только класс ошибки и сообщение", () => {
  const error = new TypeError("Аня, 1990-05-05, берусь за дело");
  const payload = payloadFromError(error);
  assert.deepEqual(Object.keys(payload).sort(), ["errorName", "message"]);
  assert.equal(payload.errorName, "TypeError");
  assert.equal(payload.message, error.message);
});

test("искусственная ошибка уходит на POST /api/errors", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const fakeFetch: typeof fetch = (async (url, init) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  }) as typeof fetch;

  const error = new Error("Аня, 1990-05-05, берусь за дело");
  error.name = "TypeError";
  await reportClientError(error, { fetch: fakeFetch });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, ERROR_ENDPOINT);
  assert.equal(sent[0]?.init.method, "POST");
  const body = JSON.parse(String(sent[0]?.init.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["errorName", "message"]);
  assert.equal(body["errorName"], "TypeError");
  assert.ok(!("name" in body));
  assert.ok(!("birthDate" in body));
  assert.ok(!("answer" in body));
  assert.ok(!("profileId" in body));
});

test("слушатели ловят необработанный отказ и шлют тот же отчёт", async () => {
  const target = new EventTarget();
  const sent: string[] = [];
  const fakeFetch: typeof fetch = (async (_url, init) => {
    sent.push(String(init?.body));
    return new Response("{}", { status: 202 });
  }) as typeof fetch;

  installClientErrorReporter({ target, fetch: fakeFetch, endpoint: ERROR_ENDPOINT });

  const error = new Error("Аня, 1990-05-05, берусь за дело");
  const rejection = new Event("unhandledrejection");
  Object.defineProperty(rejection, "reason", { value: error });
  target.dispatchEvent(rejection);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0] ?? "{}") as Record<string, unknown>;
  assert.equal(body["message"], "Аня, 1990-05-05, берусь за дело");
});
