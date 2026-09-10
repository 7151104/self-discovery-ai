/**
 * Реестр провайдеров генерации (E4-12, вопрос 5).
 *
 * Рабочие записи: `stub` — заглушка без ключа; `openai` — GPT-5 через
 * OpenAI-совместимый шлюз (рабочий путь из РФ); `openrouter` — тот же HTTP,
 * другой адрес, если шлюз доступен. Поддельный провайдер с ходами
 * (`FakeProvider`) в реестр не входит. Смена модели и адреса — переменные,
 * не новый модуль.
 */

import type { TokenPricing } from "./provider.js";
import type { GenerationProvider } from "./provider.js";
import { createOpenAiProvider, createOpenRouterProvider } from "./openrouter-provider.js";
import { StubProvider } from "./stub-provider.js";

export interface ProviderFactoryInput {
  pricing: TokenPricing;
  model: string;
  /** Пусто у заглушки. У живого адаптера пустой ключ — отказ собрать провайдера. */
  apiKey?: string;
  /** Подменяется в тестах адаптера. В рабочем контуре не передаётся. */
  fetch?: typeof fetch;
  /** Пусто — адрес из самой реализации. Нужен российскому совместимому шлюзу. */
  baseUrl?: string;
}

type Factory = (input: ProviderFactoryInput) => GenerationProvider;

const FACTORIES = {
  stub: (input: ProviderFactoryInput) =>
    new StubProvider({
      pricing: input.pricing,
      ...(input.model ? { model: input.model } : {}),
    }),
  openai: (input: ProviderFactoryInput) =>
    createOpenAiProvider({
      apiKey: input.apiKey ?? "",
      model: input.model,
      pricing: input.pricing,
      ...(input.baseUrl ? { endpoint: input.baseUrl } : {}),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }),
  openrouter: (input: ProviderFactoryInput) =>
    createOpenRouterProvider({
      apiKey: input.apiKey ?? "",
      model: input.model,
      pricing: input.pricing,
      ...(input.baseUrl ? { endpoint: input.baseUrl } : {}),
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
