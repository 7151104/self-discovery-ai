/**
 * Реестр платёжных провайдеров (E8-01).
 *
 * Здесь ровно одна запись — поддельный провайдер. Когда основатель назовёт
 * реального, к ней добавится вторая строка и рядом появится модуль адаптера.
 * Больше нигде в сервере имени провайдера нет.
 */

import type { PaymentConfig } from "../config.js";
import { createFakeProvider } from "./fake.js";
import type { PaymentProvider } from "./provider.js";

export interface ProviderContext {
  payments: PaymentConfig;
  publicOrigin: string;
}

type Factory = (context: ProviderContext) => PaymentProvider;

const FACTORIES: Record<string, Factory> = {
  fake: (context) =>
    createFakeProvider({ secret: context.payments.webhookSecret, publicOrigin: context.publicOrigin }),
};

export class UnknownProvider extends Error {
  constructor(readonly provider: string) {
    super(`unknown-payment-provider:${provider}`);
    this.name = "UnknownProvider";
  }
}

/** Провайдер по имени из настроек. Незнакомое имя — отказ на старте, а не при первой оплате. */
export function createProvider(context: ProviderContext): PaymentProvider {
  const factory = FACTORIES[context.payments.provider];
  if (!factory) throw new UnknownProvider(context.payments.provider);
  return factory(context);
}

/** Имена, которые сервер умеет поднять. Нужно тестам и сообщению об ошибке. */
export const knownProviders = (): string[] => Object.keys(FACTORIES);
