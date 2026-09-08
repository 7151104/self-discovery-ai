/**
 * Опрос статуса: один таймер, остановка, без бесконечного цикла.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { GENERATION_POLL_MS, startPoll } from "./poll.js";
import { createManualTimer } from "./test-support.js";

test("интервал опроса задан одним числом и конечен", () => {
  assert.equal(Number.isFinite(GENERATION_POLL_MS), true);
  assert.ok(GENERATION_POLL_MS > 0);
});

test("опрос ставит следующий тик только после ответа предыдущего", async () => {
  const timer = createManualTimer();
  const ticks: number[] = [];
  let resume!: (value: boolean) => void;
  const poller = startPoll({
    host: timer,
    intervalMs: GENERATION_POLL_MS,
    tick: () => {
      ticks.push(ticks.length);
      return new Promise<boolean>((resolve) => {
        resume = resolve;
      });
    },
  });

  assert.equal(timer.count(), 1, "первый тик должен быть поставлен сразу");
  timer.flush();
  assert.equal(ticks.length, 1);
  assert.equal(timer.count(), 0, "пока тик не ответил, следующий не ставится");

  resume(true);
  await poller.idle();
  assert.equal(timer.count(), 1, "после продолжения ставится ровно один следующий тик");

  timer.flush();
  resume(false);
  await poller.idle();
  assert.equal(poller.stopped, true);
  assert.equal(timer.count(), 0);
});

test("остановка снимает таймер и отменяет продолжение", async () => {
  const timer = createManualTimer();
  let ticks = 0;
  const poller = startPoll({
    host: timer,
    tick: async () => {
      ticks += 1;
      return true;
    },
  });

  timer.flush();
  await poller.idle();
  assert.equal(ticks, 1);
  poller.stop();
  assert.equal(poller.stopped, true);
  assert.equal(timer.count(), 0);

  timer.flush();
  await poller.idle();
  assert.equal(ticks, 1, "после остановки тик не должен повториться");
});
