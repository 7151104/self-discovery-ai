/**
 * Хеш входа генерации (E4-11).
 *
 * Кэш ключуется хешем «промпт плюс версия контента». Одноразовая граница
 * конверта в хеш не входит: иначе один и тот же ответ человека никогда бы
 * не попал в кэш.
 *
 * Версия контента — отпечаток файлов, из которых слой собирает задание и
 * проверяет выход. Правка любого из них меняет ключ, и старый кэш не выдаётся.
 */

import { createHash } from "node:crypto";

import { readRepoFile } from "./content.js";
import { crisisOf } from "./crisis.js";
import { escapeUserText } from "./isolation.js";
import { buildSlicePrompt, buildStep4Prompt, type SliceTask } from "./prompt.js";
import type { LlmTask } from "./engine.js";

/**
 * Файлы, от которых зависит вход модели и приёмка выхода. Сборщик их слою
 * не отдаёт отдельным полем, поэтому отпечаток считается здесь.
 */
const CONTENT_FILES = [
  "content/step4-open-synthesis.md",
  "content/forbidden.md",
  "content/scoring-rules.md",
  "docs/06-report-structure.md",
  "content/crisis.md",
  "prompts/full-report-assembler.md",
  "prompts/paid-slice-templates.md",
] as const;

/** Граница, которая не меняется от вызова к вызову: только для хеша, не для провайдера. */
const STABLE_NONCE = "0".repeat(16);

const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Отпечаток контента, из которого собран промпт и валидатор. */
export function contentVersion(): string {
  return digest(CONTENT_FILES.map((file) => `${file}\n${readRepoFile(file)}`).join("\n\0\n"));
}

/**
 * Стабильная запись входа: инструкция из контента, профиль, узел, блоки и
 * экранированный открытый ответ — без одноразовой границы конверта.
 */
export function stableGenerationInput(task: LlmTask, version: string = contentVersion()): string {
  const avoid = crisisOf([task.input.openAnswer]).avoid;
  const prompt = buildStep4Prompt(task, STABLE_NONCE, avoid);
  return [
    version,
    prompt.instruction,
    prompt.segments
      .filter((segment) => segment.kind === "данные")
      .map((segment) => `${segment.title}\n${segment.body}`)
      .join("\n\n"),
    escapeUserText(task.input.openAnswer),
  ].join("\n\0\n");
}

/** Ключ кэша: хеш стабильного входа. */
export function hashGenerationInput(task: LlmTask, version: string = contentVersion()): string {
  return digest(stableGenerationInput(task, version));
}

export function stableSliceInput(task: SliceTask, version: string = contentVersion()): string {
  const avoid = crisisOf(task.openAnswers.map((item) => item.text)).avoid;
  const prompt = buildSlicePrompt(task, STABLE_NONCE, avoid);
  return [
    version,
    task.slice,
    prompt.instruction,
    prompt.segments
      .filter((segment) => segment.kind === "данные")
      .map((segment) => `${segment.title}\n${segment.body}`)
      .join("\n\n"),
    task.openAnswers.map((item) => `${item.id}\n${escapeUserText(item.text)}`).join("\n"),
  ].join("\n\0\n");
}

export function hashSliceInput(task: SliceTask, version: string = contentVersion()): string {
  return digest(stableSliceInput(task, version));
}
