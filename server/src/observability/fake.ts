/**
 * Поддельный приёмник ошибок (E10-06).
 *
 * Пишет в память процесса и, если задан путь, в файл по строке на отчёт.
 * Тест читает и то и другое: память — сразу, файл — что пережило бы перезапуск.
 *
 * В рабочем окружении это и есть реализация, пока нет внешнего сервиса:
 * в отличие от платежей, поддельный приёмник не проводит денег и поэтому
 * с `SDAI_ENV=production` совместим.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ErrorReport, ErrorTracker } from "./provider.js";

export interface FakeErrorTracker extends ErrorTracker {
  readonly name: "fake";
  /** Снимки отчётов в порядке поступления. */
  readonly events: readonly ErrorReport[];
  /** Путь файла или null, если пишем только в память. */
  readonly path: string | null;
}

export interface FakeTrackerOptions {
  /** Файл JSONL. Пусто — только память. */
  path?: string;
}

export function createFakeTracker(options: FakeTrackerOptions = {}): FakeErrorTracker {
  const events: ErrorReport[] = [];
  const path = options.path || null;

  return {
    name: "fake",
    events,
    path,

    capture(report: ErrorReport): void {
      events.push(report);
      if (!path) return;
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(report)}\n`);
    },
  };
}

/** Читает отчёты из файла поддельного приёмника. Нужно тестам. */
export function readFakeFile(path: string): ErrorReport[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ErrorReport);
}
