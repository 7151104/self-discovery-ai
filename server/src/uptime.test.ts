/**
 * Проверка доступности и бюджет ответа API (E10-09).
 *
 * Скрипт `tools/check-health.mjs` — то, что дергает таймер и конвейер.
 * Здесь проверяется его код возврата: живой сервер — ноль, мёртвый — не ноль.
 * Бюджет 300 мс на 95-м процентиле из docs/12, раздел 5.9: измерим без
 * браузера и без внешнего сервиса, на том же тестовом сервере.
 *
 * Скрипт запускается дочерним процессом, а не spawnSync: синхронный вызов
 * останавливает цикл событий тестового процесса, и сервер в нём же не отвечает.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { call, profileAtStep, startTestServer } from "./test-support.js";
import type { PageStateDto } from "./contract/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "tools", "check-health.mjs");

/** Бюджет из docs/12-target-state.md, 5.9: ответ состояния не медленнее 300 мс на p95. */
const PAGE_STATE_BUDGET_MS = 300;
const HEALTH_BUDGET_MS = 300;

const runCheck = (url: string): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, url]);
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

test("скрипт проверки доступности лежит в выпуске и вызывается таймером", () => {
  const script = readFileSync(SCRIPT, "utf8");
  assert.match(script, /\/api\/health/);
  const unit = readFileSync(join(ROOT, "deploy", "sdai-health.service"), "utf8");
  assert.match(unit, /tools\/check-health\.mjs/);
  assert.match(unit, /OnFailure=sdai-health-alert\.service/);
  const timer = readFileSync(join(ROOT, "deploy", "sdai-health.timer"), "utf8");
  assert.match(timer, /OnCalendar=\*:0\/5/);
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "uptime.yml"), "utf8");
  assert.match(workflow, /check-health\.mjs/);
  assert.match(workflow, /SDAI_HEALTH_URL/);
});

test("проверка доступности проходит на живом сервере и падает на мёртвом", async () => {
  const server = await startTestServer();
  const origin = server.origin;
  try {
    const alive = await runCheck(`${origin}/api/health`);
    assert.equal(alive.status, 0, alive.stderr);
    assert.match(alive.stdout, /доступно version=/);
  } finally {
    await server.close();
  }

  const dead = await runCheck(`${origin}/api/health`);
  assert.equal(dead.status, 1);
  assert.match(dead.stderr, /недоступно/);
});

test("проверка падает, если база недоступна, даже при HTTP 200", async (t) => {
  const stub = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", version: "x", database: "unavailable" }));
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        stub.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/health`;
  const result = await runCheck(url);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /database=unavailable/);
});

test("ответ здоровья и состояния страницы укладываются в 300 мс на 95-м процентиле", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const page = await profileAtStep(server.origin, 1);

  const sample = async (path: string): Promise<number> => {
    const started = performance.now();
    const reply = await call(server.origin, "GET", path);
    assert.equal(reply.status, 200);
    return performance.now() - started;
  };

  const health: number[] = [];
  const state: number[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    health.push(await sample("/api/health"));
    state.push(await sample(`/api/p/${(page as PageStateDto).profileId}`));
  }

  const percentile = (values: number[], p: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, index)] ?? 0;
  };

  const healthP95 = percentile(health, 95);
  const stateP95 = percentile(state, 95);
  assert.ok(healthP95 <= HEALTH_BUDGET_MS, `health p95 ${healthP95.toFixed(1)} мс при бюджете ${HEALTH_BUDGET_MS} мс`);
  assert.ok(stateP95 <= PAGE_STATE_BUDGET_MS, `pageState p95 ${stateP95.toFixed(1)} мс при бюджете ${PAGE_STATE_BUDGET_MS} мс`);
});
