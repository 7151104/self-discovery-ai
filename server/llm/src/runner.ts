/**
 * Вызов провайдера с таймаутом, повторами и пределом себестоимости (E4-01).
 *
 * Функция на вход-выход: ни хранения, ни HTTP. Сколько на профиль уже потрачено,
 * сообщает вызывающий (`spentKopecks`), сколько стоил вызов — возвращается наружу.
 * Журнал стоимости и очередь заданий — работа владельца сервера (E4-10, E4-03);
 * слой отдаёт ему числа, а не пишет их сам.
 */

import { GenerationError, costOf, estimateCost, type GenerationProvider, type GenerationRequest, type GenerationResult } from "./provider.js";

export interface RetryPolicy {
  /** Сколько всего попыток, включая первую. */
  attempts: number;
  /** Предел ожидания одной попытки. */
  timeoutMs: number;
  /** Пауза перед второй попыткой. */
  backoffMs: number;
  /** Во сколько раз растёт пауза перед каждой следующей. */
  backoffFactor: number;
}

export interface CostPolicy {
  /** Предел себестоимости одного профиля в копейках. */
  profileLimitKopecks: number;
}

/** Почему генерация не состоялась. Возвращается наружу вместо исключения. */
export type RunFailure =
  /** Провайдер отказал окончательно или попытки кончились. */
  | "отказ провайдера"
  /** Ни одна попытка не уложилась в таймаут. */
  | "таймаут"
  /** Вызов не сделан: профиль исчерпал предел себестоимости. */
  | "предел стоимости";

export type RunOutcome =
  | { ok: true; result: GenerationResult; attempts: number; costKopecks: number }
  | { ok: false; failure: RunFailure; code: string; attempts: number; costKopecks: number };

export interface RunOptions {
  provider: GenerationProvider;
  request: GenerationRequest;
  retry: RetryPolicy;
  cost: CostPolicy;
  /** Сколько уже потрачено на этот профиль. Число приносит вызывающий. */
  spentKopecks: number;
  /** Пауза между попытками. Подменяется в тестах, чтобы они не ждали. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Один вызов провайдера, прекращаемый по таймауту. */
async function attemptOnce(
  provider: GenerationProvider,
  request: GenerationRequest,
  timeoutMs: number,
): Promise<GenerationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let timedOut = false;
  const onAbort = (): void => {
    timedOut = true;
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await provider.generate(request, controller.signal);
  } catch (error) {
    if (timedOut) throw new GenerationError("временный отказ", "таймаут");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Вызов с повторами. Повторяется только временный отказ: на постоянном повтор
 * лишь тратит деньги и время человека, который ждёт блок на экране.
 *
 * Предел себестоимости проверяется до вызова по оценке сверху: узнать настоящую
 * цену после того, как деньги потрачены, — это не предел, а отчёт.
 */
export async function runGeneration(options: RunOptions): Promise<RunOutcome> {
  const { provider, request, retry, cost, spentKopecks } = options;
  const sleep = options.sleep ?? realSleep;

  const forecast = estimateCost(request, provider.pricing);
  if (spentKopecks + forecast > cost.profileLimitKopecks) {
    return { ok: false, failure: "предел стоимости", code: "профиль", attempts: 0, costKopecks: 0 };
  }

  let lastCode = "неизвестно";
  let lastFailure: RunFailure = "отказ провайдера";
  let pause = retry.backoffMs;
  let used = 0;

  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    used = attempt;
    try {
      const result = await attemptOnce(provider, request, retry.timeoutMs);
      return { ok: true, result, attempts: attempt, costKopecks: costOf(result.usage, provider.pricing) };
    } catch (error) {
      const failure = error instanceof GenerationError ? error : new GenerationError("постоянный отказ", "исключение");
      lastCode = failure.code;
      lastFailure = failure.code === "таймаут" ? "таймаут" : "отказ провайдера";
      if (!failure.retryable || attempt === retry.attempts) break;
      await sleep(pause);
      pause *= retry.backoffFactor;
    }
  }

  return { ok: false, failure: lastFailure, code: lastCode, attempts: used, costKopecks: 0 };
}
