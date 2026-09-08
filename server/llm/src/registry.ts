/**
 * Реестр провайдеров генерации (E4-12).
 *
 * Здесь пока одна рабочая запись — заглушка. Поддельный провайдер с ходами
 * (`FakeProvider`) в реестр не входит: ему нужны заготовленные ответы, и его
 * собирают тесты напрямую. Когда основатель назовёт настоящую модель, сюда
 * добавится вторая строка и рядом появится модуль адаптера. Больше нигде
 * имени провайдера нет — смена реализации не требует правок вне `server/llm/`.
 */

import type { TokenPricing } from "./provider.js";
import type { GenerationProvider } from "./provider.js";
import { StubProvider } from "./stub-provider.js";

export interface ProviderFactoryInput {
  pricing: TokenPricing;
  model: string;
}

type Factory = (input: ProviderFactoryInput) => GenerationProvider;

const FACTORIES = {
  stub: (input: ProviderFactoryInput) =>
    new StubProvider({
      pricing: input.pricing,
      ...(input.model ? { model: input.model } : {}),
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
