/**
 * Настройки слоя генерации. Все — из переменных окружения (E4-01).
 *
 * Ключ провайдера в репозитории не лежит и лежать не может: он читается из
 * окружения и в журнал не попадает. По умолчанию `SDAI_LLM_PROVIDER` — `stub`,
 * чтобы тесты и CI не ходили в сеть. Живая литература — `openrouter`
 * (вопрос 5 закрыт: Claude Sonnet 5).
 *
 * Предел себестоимости профиля — 30 ₽, настраивается переменной. Число выбрано
 * как около пяти процентов самого дешёвого среза: профиль дороже этого
 * генерируется по кругу и его надо останавливать.
 */

import type { TokenPricing } from "./provider.js";
import { knownLlmProviders, type ProviderName } from "./registry.js";
import type { CostPolicy, RetryPolicy } from "./runner.js";

export type { ProviderName };

export interface LlmConfig {
  provider: ProviderName;
  /** Имя модели у провайдера. Пусто — берётся имя, заданное самой реализацией. */
  model: string;
  /**
   * Ключ провайдера. Пусто у подделки; у настоящего адаптера пустой ключ —
   * причина не стартовать, и проверяет это адаптер, а не эти настройки.
   */
  apiKey: string;
  pricing: TokenPricing;
  retry: RetryPolicy;
  cost: CostPolicy;
}

export const DEFAULTS = {
  provider: "stub" as ProviderName,
  model: "",
  /**
   * Таймаут и повторы. Финал лестницы человек ждёт на экране, поэтому попыток
   * три, а не бесконечность. Одна попытка — минута: платный JSON на 1200–2500
   * слов иначе обрезается, а короткий финал лестницы обычно укладывается раньше.
   */
  retry: { attempts: 3, timeoutMs: 60_000, backoffMs: 500, backoffFactor: 2 } satisfies RetryPolicy,
  /**
   * Предел себестоимости одного профиля — 30 ₽. Это около пяти процентов самого
   * дешёвого среза маршрута (590 ₽): профиль, который столько стоит, точно
   * генерируется по кругу, и его надо остановить. Вопрос 5 это число подтвердил.
   */
  cost: { profileLimitKopecks: 3_000 } satisfies CostPolicy,
  /** Цена модели неизвестна, пока неизвестен провайдер. Ноль означает «не задана». */
  pricing: { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 } satisfies TokenPricing,
} as const;

export class LlmConfigError extends Error {
  constructor(readonly variables: string[], readonly reason: string) {
    super(`llm-config:${reason}:${variables.join(",")}`);
    this.name = "LlmConfigError";
  }
}

function readInteger(env: NodeJS.ProcessEnv, variable: string, fallback: number): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new LlmConfigError([variable], "expected-non-negative-integer");
  return value;
}

function readProvider(env: NodeJS.ProcessEnv): ProviderName {
  const raw = env["SDAI_LLM_PROVIDER"];
  if (raw === undefined || raw === "") return DEFAULTS.provider;
  if ((knownLlmProviders() as string[]).includes(raw)) return raw as ProviderName;
  throw new LlmConfigError(["SDAI_LLM_PROVIDER"], "unknown-provider");
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const retry: RetryPolicy = {
    attempts: readInteger(env, "SDAI_LLM_ATTEMPTS", DEFAULTS.retry.attempts),
    timeoutMs: readInteger(env, "SDAI_LLM_TIMEOUT_MS", DEFAULTS.retry.timeoutMs),
    backoffMs: readInteger(env, "SDAI_LLM_BACKOFF_MS", DEFAULTS.retry.backoffMs),
    backoffFactor: readInteger(env, "SDAI_LLM_BACKOFF_FACTOR", DEFAULTS.retry.backoffFactor),
  };
  if (retry.attempts < 1) throw new LlmConfigError(["SDAI_LLM_ATTEMPTS"], "expected-at-least-one-attempt");
  if (retry.timeoutMs < 1) throw new LlmConfigError(["SDAI_LLM_TIMEOUT_MS"], "expected-positive-timeout");

  return {
    provider: readProvider(env),
    model: env["SDAI_LLM_MODEL"] || DEFAULTS.model,
    apiKey: env["SDAI_LLM_API_KEY"] || "",
    pricing: {
      inputKopecksPerMillion: readInteger(
        env,
        "SDAI_LLM_PRICE_INPUT_KOPECKS_PER_MTOK",
        DEFAULTS.pricing.inputKopecksPerMillion,
      ),
      outputKopecksPerMillion: readInteger(
        env,
        "SDAI_LLM_PRICE_OUTPUT_KOPECKS_PER_MTOK",
        DEFAULTS.pricing.outputKopecksPerMillion,
      ),
    },
    retry,
    cost: {
      profileLimitKopecks: readInteger(env, "SDAI_LLM_PROFILE_COST_LIMIT_KOPECKS", DEFAULTS.cost.profileLimitKopecks),
    },
  };
}
