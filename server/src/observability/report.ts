/**
 * Сборка отчёта об ошибке и перехват необработанных исключений (E10-06).
 *
 * Чистка стоит здесь, а не в приёмнике: одна запись с именем в сообщении —
 * и требование «в трекере нет персональных данных» нарушено молча. Фильтр
 * тот же, что у журнала (`server/src/log.ts`): запрещённое поле и «значение
 * не похоже на машинный код».
 */

import type { BuildInfo } from "../config.js";
import { HIDDEN, log, scrubValue } from "../log.js";
import type { ErrorReport, ErrorSource, ErrorTracker } from "./provider.js";

const MACHINE_NAME = /^[A-Za-z][A-Za-z0-9_$]*$/;

function errorNameOf(error: unknown): string {
  if (error instanceof Error && MACHINE_NAME.test(error.name)) return error.name;
  if (typeof error === "string") return "Error";
  return "Error";
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const cleaned = scrubValue("detail", raw);
  return typeof cleaned === "string" ? cleaned : HIDDEN;
}

function routeOf(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const path = route.split("?")[0] ?? "";
  const cleaned = scrubValue("route", path);
  return typeof cleaned === "string" && cleaned !== HIDDEN ? cleaned : undefined;
}

export interface ReportContext {
  source: ErrorSource;
  build: BuildInfo;
  route?: string;
  occurredAt?: string;
}

/** Собирает отчёт: версия сборки из одного места, персональные данные не входят. */
export function toErrorReport(error: unknown, context: ReportContext): ErrorReport {
  const report: ErrorReport = {
    source: context.source,
    errorName: errorNameOf(error),
    message: messageOf(error),
    version: context.build.version,
    commit: context.build.commit,
    occurredAt: context.occurredAt ?? new Date().toISOString(),
  };
  const route = routeOf(context.route);
  if (route) report.route = route;
  return report;
}

/** Отправляет в приёмник. Отказ приёмника сам не должен ронять обработчик. */
export function captureError(tracker: ErrorTracker, error: unknown, context: ReportContext): void {
  const report = toErrorReport(error, context);
  try {
    tracker.capture(report);
  } catch {
    log("errors.capture_failed", { tracker: tracker.name, source: context.source });
    return;
  }
  log("errors.captured", {
    tracker: tracker.name,
    source: report.source,
    errorName: report.errorName,
    version: report.version,
  });
}

/**
 * Необработанные исключения процесса. В тестах не ставится: тестовый раннер
 * сам ловит необработанные отказы, и чужой обработчик ему мешает.
 */
export function attachProcessHooks(tracker: ErrorTracker, build: BuildInfo): void {
  const report = (error: unknown): void => {
    captureError(tracker, error, { source: "server", build });
  };
  process.on("uncaughtException", report);
  process.on("unhandledRejection", report);
}
