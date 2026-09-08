/**
 * Реестр приёмников ошибок (E10-06).
 *
 * Здесь ровно одна запись — поддельный приёмник. Когда основатель назовёт
 * внешний сервис, к ней добавится вторая строка и рядом появится модуль
 * адаптера. Больше нигде в сервере имени приёмника нет.
 */

import type { ErrorsConfig } from "../config.js";
import { createFakeTracker } from "./fake.js";
import type { ErrorTracker } from "./provider.js";

type Factory = (config: ErrorsConfig) => ErrorTracker;

const FACTORIES: Record<string, Factory> = {
  fake: (config) => createFakeTracker({ path: config.path || undefined }),
};

export class UnknownTracker extends Error {
  constructor(readonly tracker: string) {
    super(`unknown-error-tracker:${tracker}`);
    this.name = "UnknownTracker";
  }
}

/** Приёмник по имени из настроек. Незнакомое имя — отказ на старте, а не при первой ошибке. */
export function createErrorTracker(config: ErrorsConfig): ErrorTracker {
  const factory = FACTORIES[config.tracker];
  if (!factory) throw new UnknownTracker(config.tracker);
  return factory(config);
}

/** Имена, которые сервер умеет поднять. Нужно тестам и сообщению об ошибке. */
export const knownTrackers = (): string[] => Object.keys(FACTORIES);
