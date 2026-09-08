/**
 * Настройки слоя генерации. Все — из переменных окружения (E4-01).
 *
 * Ключ провайдера в репозитории не лежит и лежать не может: он читается из
 * окружения и в журнал не попадает. Пока основатель не назвал настоящую модель,
 * настройка `SDAI_LLM_PROVIDER` по умолчанию — `stub`, рабочая заглушка.
 *
 * Предел себестоимости профиля основателем не назван (открытый вопрос 5 в
 * `docs/14-state.md`). Он здесь — настраиваемое число с безопасным значением по
 * умолчанию, а не правило в коде: правилом он станет, когда основатель назовёт
 * число.
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
   * Таймаут и повторы. Финал лестницы человек ждёт на экране, поэтому предел
   * ожидания одной попытки — полминуты, а всего попыток три: две сверх первой
   * закрывают обычный временный отказ провайдера и не превращают ожидание в
   * бесконечное.
   */
  retry: { attempts: 3, timeoutMs: 30_000, backoffMs: 500, backoffFactor: 2 } satisfies RetryPolicy,
  /**
   * Предел себестоимости одного профиля — 30 ₽. Это около пяти процентов самого
   * дешёвого среза маршрута (590 ₽): профиль, который столько стоит, точно
   * генерируется по кругу, и его надо остановить. Число временное и настраивается
   * переменной: настоящее назовёт основатель (вопрос 5).
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
