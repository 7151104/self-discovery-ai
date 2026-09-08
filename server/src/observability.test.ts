/**
 * Трекинг ошибок (E10-06).
 *
 * Приёмка: искусственная ошибка на сервере и в клиенте приходит в поддельный
 * трекер с версией сборки и без имени, даты рождения и открытого текста ответа.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { API } from "./contract/index.js";
import type { Db } from "./db/driver.js";
import { call, startTestServer, TEST_KEY } from "./test-support.js";
import { createFakeTracker, readFakeFile } from "./observability/fake.js";
import { createErrorTracker, knownTrackers, UnknownTracker } from "./observability/registry.js";
import { toErrorReport } from "./observability/report.js";
import type { ErrorTracker } from "./observability/provider.js";
import { HIDDEN } from "./log.js";

const SECRETS = ["Аня", "1990-05-05", "берусь за дело"] as const;
const POISON = "Аня, 1990-05-05, Обычно я берусь за дело быстро и с интересом";

function asFake(tracker: ErrorTracker): ReturnType<typeof createFakeTracker> {
  assert.equal(tracker.name, "fake");
  return tracker as ReturnType<typeof createFakeTracker>;
}

function wrapThrowingGet(db: Db, message: string): Db {
  return {
    ...db,
    get(sql, params) {
      if (typeof sql === "string" && sql.includes("FROM profiles")) {
        throw new Error(message);
      }
      return db.get(sql, params);
    },
  };
}

test("реестр поднимает поддельный приёмник и отказывает незнакомому", () => {
  assert.deepEqual(knownTrackers(), ["fake"]);
  const tracker = createErrorTracker({ tracker: "fake", path: "" });
  assert.equal(tracker.name, "fake");
  assert.throws(() => createErrorTracker({ tracker: "sentry", path: "" }), UnknownTracker);
});

test("поддельный приёмник пишет в память и в файл", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdai-errors-"));
  const path = join(dir, "errors.jsonl");
  try {
    const tracker = createFakeTracker({ path });
    tracker.capture({
      source: "server",
      errorName: "Error",
      message: HIDDEN,
      version: "2026-09-08-1",
      commit: "abc",
      occurredAt: "2026-09-08T10:00:00.000Z",
    });
    assert.equal(tracker.events.length, 1);
    assert.equal(readFakeFile(path).length, 1);
    assert.equal(readFakeFile(path)[0]?.version, "2026-09-08-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("смена реализации не требует правок вне порта: второй приёмник в тесте", () => {
  const captured: string[] = [];
  const other: ErrorTracker = {
    name: "memory",
    capture(report) {
      captured.push(report.version);
    },
  };
  other.capture({
    source: "server",
    errorName: "Error",
    message: "ok",
    version: "v",
    commit: "c",
    occurredAt: "2026-09-08T10:00:00.000Z",
  });
  assert.deepEqual(captured, ["v"]);
});

test("отчёт берёт версию сборки и скрывает человеческий текст", () => {
  const report = toErrorReport(new Error(POISON), {
    source: "server",
    build: { version: "2026-09-08-3", commit: "deadbeef", builtAt: null },
    route: "/api/p/abc",
  });
  assert.equal(report.version, "2026-09-08-3");
  assert.equal(report.commit, "deadbeef");
  assert.equal(report.source, "server");
  for (const secret of SECRETS) {
    assert.ok(!JSON.stringify(report).includes(secret), `в отчёт попало «${secret}»`);
  }
  assert.equal(report.message, HIDDEN);
});

test("искусственная ошибка на сервере и в клиенте приходит в трекер с версией и без персональных данных", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sdai-errors-"));
  const path = join(dir, "errors.jsonl");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const server = await startTestServer(
    {
      SDAI_BUILD_VERSION: "2026-09-08-3",
      SDAI_BUILD_COMMIT: "0123456789abcdef",
      SDAI_ERROR_TRACKER: "fake",
      SDAI_ERROR_TRACKER_PATH: path,
    },
    { wrapDb: (db) => wrapThrowingGet(db, POISON) },
  );
  t.after(() => server.close());

  const fake = asFake(server.errors);

  // Сервер: обработчик падает на чтении профиля, в сообщении — персональные данные.
  const serverReply = await call(server.origin, "GET", "/api/p/AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(serverReply.status, 500);

  // Клиент: тот же эндпоинт, которым пользуется web/src/errors.ts.
  assert.equal(API.reportError.path, "/api/errors");
  const clientReply = await call<{ accepted: true }>(server.origin, "POST", "/api/errors", {
    errorName: "TypeError",
    message: POISON,
  });
  assert.equal(clientReply.status, 202);
  assert.equal(clientReply.body.accepted, true);

  assert.ok(fake.events.length >= 2, `в трекере ${fake.events.length} отчётов`);
  const sources = new Set(fake.events.map((event) => event.source));
  assert.ok(sources.has("server"), "серверной ошибки нет");
  assert.ok(sources.has("client"), "клиентской ошибки нет");

  for (const event of fake.events) {
    assert.equal(event.version, "2026-09-08-3");
    assert.equal(event.commit, "0123456789abcdef");
    const text = JSON.stringify(event);
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `в трекере есть «${secret}»: ${text}`);
    }
    assert.ok(!/[А-Яа-яЁё]/.test(text.replace(/\[скрыто\]/g, "")), text);
  }

  const fromFile = readFakeFile(path);
  assert.ok(fromFile.length >= 2);
  for (const event of fromFile) {
    const text = JSON.stringify(event);
    for (const secret of SECRETS) assert.ok(!text.includes(secret), text);
  }
});

test("версия сборки в отчёте — та же, что в конфигурации выпуска", () => {
  const released = loadConfig({
    SDAI_BUILD_VERSION: "2026-09-08-3",
    SDAI_BUILD_COMMIT: "0123456789abcdef",
    SDAI_ENCRYPTION_KEY: TEST_KEY,
  });
  assert.equal(released.build.version, "2026-09-08-3");
  const report = toErrorReport(new Error("boom"), { source: "server", build: released.build });
  assert.equal(report.version, released.build.version);
  assert.equal(report.commit, released.build.commit);
});
