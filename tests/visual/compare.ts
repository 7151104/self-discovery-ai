/**
 * Сверка с эталоном. Прогон только читает файлы: перезапись — `update.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { baselineFile, baselinePath, type SnapshotSource } from "./files.js";
import type { PageStateId } from "../states.js";
import type { Viewport } from "./viewport.js";

export class SnapshotMismatch extends Error {
  constructor(readonly file: string, readonly actual: string, readonly expected: string) {
    super(messageOf(file, actual, expected));
    this.name = "SnapshotMismatch";
  }
}

function firstDiff(actual: string, expected: string): string {
  const left = actual.split("\n");
  const right = expected.split("\n");
  const limit = Math.max(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      return `строка ${index + 1}\n  эталон: ${right[index] ?? "«нет»"}\n  сейчас: ${left[index] ?? "«нет»"}`;
    }
  }
  return "тексты разной длины при одинаковых строках";
}

function messageOf(file: string, actual: string, expected: string): string {
  return [
    `снимок ${file} не совпал с эталоном.`,
    firstDiff(actual, expected),
    "Если изменение осознанное, обнови эталон: npm run snapshots:update",
  ].join("\n");
}

export function compareSnapshot(
  source: SnapshotSource,
  state: PageStateId,
  viewport: Viewport,
  actual: string,
): void {
  const path = baselinePath(source, state, viewport);
  const file = baselineFile(source, state, viewport);
  if (!existsSync(path)) {
    throw new Error(`нет эталона ${file}. Сними его осознанно: npm run snapshots:update`);
  }
  const expected = readFileSync(path, "utf8");
  if (actual !== expected) throw new SnapshotMismatch(file, actual, expected);
}
