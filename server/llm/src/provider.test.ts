/**
 * E4-01: порт провайдера, таймауты, повторы, предел стоимости.
 *
 * Ни один тест здесь не выходит в сеть и не читает ключа: провайдер — поддельный,
 * а второй, написанный прямо в тесте, доказывает, что смена реализации не требует
 * правок вне `server/llm/`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULTS, LlmConfigError, loadLlmConfig } from "./config.js";
import { FakeProvider, answering } from "./fake-provider.js";
import {
  GenerationError,
  costOf,
  estimateCost,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
} from "./provider.js";
import { runGeneration, type CostPolicy, type RetryPolicy } from "./runner.js";

const REQUEST: GenerationRequest = {
  instruction: "инструкция",
  data: "данные",
  expects: "json",
  maxOutputTokens: 100,
  temperature: 0,
};

const retry = (overrides: Partial<RetryPolicy> = {}): RetryPolicy => ({
  attempts: 3,
  timeoutMs: 50,
  backoffMs: 10,
  backoffFactor: 2,
  ...overrides,
});

const cost = (limit = 1_000_000): CostPolicy => ({ profileLimitKopecks: limit });

/** Паузы в тестах не ждут: они записываются. */
const recorder = (): { pauses: number[]; sleep: (ms: number) => Promise<void> } => {
  const pauses: number[] = [];
  return {
    pauses,
    sleep: async (ms) => {
      pauses.push(ms);
    },
  };
};

test("поддельный провайдер отвечает без сети и показывает, что ушло в модель", async () => {
  const provider = answering("ответ модели");
  const outcome = await runGeneration({ provider, request: REQUEST, retry: retry(), cost: cost(), spentKopecks: 0 });

  assert.ok(outcome.ok);
  assert.equal(outcome.result.text, "ответ модели");
  assert.equal(outcome.attempts, 1);
  assert.equal(provider.callCount, 1);
  assert.equal(provider.calls[0]!.instruction, "инструкция");
  assert.equal(provider.calls[0]!.data, "данные");
});

test("временный отказ повторяется с растущей паузой, постоянный — нет", async () => {
  const temporary = new FakeProvider({
    turns: [
      { kind: "отказ", failure: "временный отказ", code: "429" },
      { kind: "отказ", failure: "временный отказ", code: "503" },
      { kind: "ответ", text: "с третьей попытки" },
    ],
  });
  const clock = recorder();
  const retried = await runGeneration({
    provider: temporary,
    request: REQUEST,
    retry: retry(),
    cost: cost(),
    spentKopecks: 0,
    sleep: clock.sleep,
  });

  assert.ok(retried.ok);
  assert.equal(retried.attempts, 3);
  assert.deepEqual(clock.pauses, [10, 20], "пауза обязана расти");

  const permanent = new FakeProvider({ turns: [{ kind: "отказ", failure: "постоянный отказ", code: "auth" }] });
  const failed = await runGeneration({
    provider: permanent,
    request: REQUEST,
    retry: retry(),
    cost: cost(),
    spentKopecks: 0,
    sleep: clock.sleep,
  });

  assert.equal(failed.ok, false);
  assert.equal(permanent.callCount, 1, "постоянный отказ повторять нельзя");
  if (!failed.ok) {
    assert.equal(failed.failure, "отказ провайдера");
    assert.equal(failed.code, "auth");
    assert.equal(failed.attempts, 1);
  }
});

test("зависший вызов прекращается таймаутом, а не висит до конца теста", async () => {
  const provider = new FakeProvider({ turns: [{ kind: "зависание" }] });
  const clock = recorder();
  const outcome = await runGeneration({
    provider,
    request: REQUEST,
    retry: retry({ attempts: 2, timeoutMs: 5 }),
    cost: cost(),
    spentKopecks: 0,
    sleep: clock.sleep,
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure, "таймаут");
    assert.equal(outcome.attempts, 2);
  }
  assert.equal(provider.callCount, 2);
});

test("внешняя отмена не запускает повтор: задание доиграется после старта", async () => {
  const provider = new FakeProvider({ turns: [{ kind: "зависание" }] });
  const clock = recorder();
  const controller = new AbortController();
  const pending = runGeneration({
    provider,
    request: REQUEST,
    retry: retry({ attempts: 3, timeoutMs: 5_000 }),
    cost: cost(),
    spentKopecks: 0,
    sleep: clock.sleep,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  const outcome = await pending;

  assert.equal(outcome.ok, false);
  assert.equal(provider.callCount, 1, "остановку нельзя чинить повтором");
  assert.deepEqual(clock.pauses, []);
});

test("предел стоимости профиля останавливает вызов до провайдера", async () => {
  const pricing = { inputKopecksPerMillion: 1_000_000, outputKopecksPerMillion: 1_000_000 };
  const provider = answering("не должно быть вызвано", { pricing });

  const forecast = estimateCost(REQUEST, pricing);
  assert.ok(forecast > 0, "оценка стоимости обязана быть положительной");

  const blocked = await runGeneration({
    provider,
    request: REQUEST,
    retry: retry(),
    cost: cost(forecast - 1),
    spentKopecks: 0,
  });

  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.failure, "предел стоимости");
  assert.equal(provider.callCount, 0, "предел проверяется до вызова, а не после");

  const allowed = await runGeneration({
    provider,
    request: REQUEST,
    retry: retry(),
    cost: cost(forecast),
    spentKopecks: 0,
  });
  assert.ok(allowed.ok);
  assert.ok(allowed.costKopecks > 0, "стоимость вызова уходит наружу числом");
});

test("уже потраченное на профиль учитывается: слой ничего не хранит сам", async () => {
  const pricing = { inputKopecksPerMillion: 1_000_000, outputKopecksPerMillion: 1_000_000 };
  const provider = answering("ответ", { pricing });
  const forecast = estimateCost(REQUEST, pricing);

  const outcome = await runGeneration({
    provider,
    request: REQUEST,
    retry: retry(),
    cost: cost(forecast * 2),
    spentKopecks: forecast + 1,
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure, "предел стоимости");
});

test("потолок срабатывает по фактически потраченному даже при нулевой оценке следующего вызова", async () => {
  const provider = answering("не должно быть вызвано");
  const blocked = await runGeneration({
    provider,
    request: REQUEST,
    retry: retry(),
    cost: cost(10),
    spentKopecks: 10,
  });

  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.failure, "предел стоимости");
  assert.equal(provider.callCount, 0);
});

test("поддельный провайдер принимает ходы «временный отказ» и «постоянный отказ» напрямую", async () => {
  const temporary = new FakeProvider({
    turns: [{ kind: "временный отказ", code: "429" }, { kind: "ответ", text: "после паузы" }],
  });
  const clock = recorder();
  const retried = await runGeneration({
    provider: temporary,
    request: REQUEST,
    retry: retry({ attempts: 2 }),
    cost: cost(),
    spentKopecks: 0,
    sleep: clock.sleep,
  });
  assert.ok(retried.ok);
  assert.equal(temporary.callCount, 2);

  const permanent = new FakeProvider({ turns: [{ kind: "постоянный отказ", code: "auth" }] });
  const failed = await runGeneration({
    provider: permanent,
    request: REQUEST,
    retry: retry(),
    cost: cost(),
    spentKopecks: 0,
  });
  assert.equal(failed.ok, false);
  assert.equal(permanent.callCount, 1);
});

test("стоимость считается по токенам и округляется вверх", () => {
  const pricing = { inputKopecksPerMillion: 30_000, outputKopecksPerMillion: 60_000 };
  assert.equal(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, pricing), 90_000);
  assert.equal(costOf({ inputTokens: 1, outputTokens: 0 }, pricing), 1, "недосчитать хуже, чем пересчитать");
  assert.equal(costOf({ inputTokens: 0, outputTokens: 0 }, pricing), 0);
});

test("смена провайдера — новая реализация порта, без правок вокруг", async () => {
  /** Второй провайдер, написанный здесь и целиком: порт больше ничего не требует. */
  class OtherProvider implements GenerationProvider {
    readonly id = "другой";
    readonly model = "другая-модель";
    readonly pricing = { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 };

    async generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult> {
      if (signal.aborted) throw new GenerationError("временный отказ", "прекращено");
      return {
        text: `${request.expects}:${request.instruction.length}`,
        usage: { inputTokens: 1, outputTokens: 1 },
        model: this.model,
      };
    }
  }

  const outcome = await runGeneration({
    provider: new OtherProvider(),
    request: REQUEST,
    retry: retry(),
    cost: cost(),
    spentKopecks: 0,
  });

  assert.ok(outcome.ok);
  assert.equal(outcome.result.model, "другая-модель");
  assert.equal(outcome.result.text, `json:${REQUEST.instruction.length}`);
});

test("настройки читаются из окружения, ключа в репозитории нет", () => {
  const bare = loadLlmConfig({});
  assert.equal(bare.provider, "fake");
  assert.equal(bare.apiKey, "", "ключа по умолчанию не существует");
  assert.deepEqual(bare.retry, DEFAULTS.retry);
  assert.equal(bare.cost.profileLimitKopecks, DEFAULTS.cost.profileLimitKopecks);
  assert.ok(bare.cost.profileLimitKopecks > 0, "безопасное значение предела обязано быть положительным");

  const tuned = loadLlmConfig({
    SDAI_LLM_API_KEY: "ключ-из-окружения",
    SDAI_LLM_PROFILE_COST_LIMIT_KOPECKS: "500",
    SDAI_LLM_TIMEOUT_MS: "1000",
    SDAI_LLM_ATTEMPTS: "1",
    SDAI_LLM_PRICE_INPUT_KOPECKS_PER_MTOK: "3000",
  });
  assert.equal(tuned.apiKey, "ключ-из-окружения");
  assert.equal(tuned.cost.profileLimitKopecks, 500, "предел настраивается числом, а не зашит в код");
  assert.equal(tuned.retry.attempts, 1);
  assert.equal(tuned.pricing.inputKopecksPerMillion, 3000);

  assert.throws(() => loadLlmConfig({ SDAI_LLM_PROVIDER: "неизвестный" }), LlmConfigError);
  assert.throws(() => loadLlmConfig({ SDAI_LLM_ATTEMPTS: "0" }), LlmConfigError);
  assert.throws(() => loadLlmConfig({ SDAI_LLM_TIMEOUT_MS: "-1" }), LlmConfigError);
});
