/**
 * Реестр провайдеров генерации (E4-12, вопрос 5).
 *
 * Рабочие записи: `stub` — заглушка для тестов и локального контура без ключа;
 * `openrouter` — Claude Sonnet 5 через OpenRouter. Поддельный провайдер с ходами
 * (`FakeProvider`) в реестр не входит: ему нужны заготовленные ответы, и его
 * собирают тесты напрямую. Смена модели — переменная `SDAI_LLM_MODEL`, не новый
 * модуль. Больше нигде имени провайдера нет.
 */

import type { TokenPricing } from "./provider.js";
import type { GenerationProvider } from "./provider.js";
import { createOpenRouterProvider } from "./openrouter-provider.js";
import { StubProvider } from "./stub-provider.js";

export interface ProviderFactoryInput {
  pricing: TokenPricing;
  model: string;
  /** Пусто у заглушки. У OpenRouter пустой ключ — отказ собрать провайдера. */
  apiKey?: string;
  /** Подменяется в тестах адаптера. В рабочем контуре не передаётся. */
  fetch?: typeof fetch;
}

type Factory = (input: ProviderFactoryInput) => GenerationProvider;

const FACTORIES = {
  stub: (input: ProviderFactoryInput) =>
    new StubProvider({
      pricing: input.pricing,
      ...(input.model ? { model: input.model } : {}),
    }),
  openrouter: (input: ProviderFactoryInput) =>
    createOpenRouterProvider({
      apiKey: input.apiKey ?? "",
      model: input.model,
      pricing: input.pricing,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }),
} as const;

export type ProviderName = keyof typeof FACTORIES;

export class UnknownLlmProvider extends Error {
  constructor(readonly provider: string) {
    super(`unknown-llm-provider:${provider}`);
    this.name = "UnknownLlmProvider";
  }
}

/** Провайдер по имени из настроек. Незнакомое имя — отказ на старте, а не при первом вызове. */
export function createGenerationProvider(input: ProviderFactoryInput & { provider: string }): GenerationProvider {
  const factory = FACTORIES[input.provider as ProviderName] as Factory | undefined;
  if (!factory) throw new UnknownLlmProvider(input.provider);
  return factory(input);
}

/** Имена, которые слой умеет поднять. Нужно настройкам, тестам и сообщению об ошибке. */
export const knownLlmProviders = (): ProviderName[] => Object.keys(FACTORIES) as ProviderName[];
