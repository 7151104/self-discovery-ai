/**
 * Очередь генерации (E4-03), учёт стоимости (E4-10), кэш и деградация (E4-11).
 *
 * Слой LLM остаётся чистым: считает промпт, хеш входа, вызывает провайдера и
 * отдаёт числа. Здесь — постановка задания, переживание перезапуска, журнал
 * вызовов и кэш. Защита от второй генерации держится уникальным индексом
 * `generation_jobs_active_slot_idx`, а не проверкой в коде.
 */

import {
  answering,
  costOf,
  contentVersion,
  envelope,
  generateLadderFinal,
  GenerationError,
  hashGenerationInput,
  loadLlmConfig,
  type GenerationProvider,
  type GenerationResult,
  type LlmConfig,
  type Step4Reason,
} from "../llm/dist/index.js";
import type { BlockSlot, GenerationDto } from "./contract/index.js";
import type { Db } from "./db/driver.js";
import { detectCrisis, type LlmTask } from "./engine.js";
import { log } from "./log.js";
import { assemble } from "./page.js";
import {
  deferJob,
  failJob,
  findActiveJob,
  findCache,
  findJobById,
  findJobByRequest,
  findLatestJob,
  findProfile,
  insertCall,
  insertJob,
  listDueJobs,
  markJobStarted,
  profileCostKopecks,
  releaseActiveJob,
  saveBlockContent,
  saveCache,
  saveJobResult,
  type CallOutcome,
  type GenerationJobRecord,
  type GenerationResultBody,
  type ProfileRecord,
} from "./store.js";

export interface LlmRuntime {
  provider: GenerationProvider;
  config: LlmConfig;
  /**
   * Обрабатывать очередь после запроса. В тестах, которым достаточно постановки,
   * выключается, чтобы не гонять провайдера на каждом профиле ступени 4.
   */
  autostart: boolean;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Рабочий контур слоя: настройки из окружения и поддельный провайдер, пока
 * настоящий не назван. Тесты подменяют провайдера и выключают автозапуск.
 */
export function createLlmRuntime(
  overrides: {
    config?: LlmConfig;
    provider?: GenerationProvider;
    autostart?: boolean;
    sleep?: (ms: number) => Promise<void>;
    env?: NodeJS.ProcessEnv;
  } = {},
): LlmRuntime {
  const config = overrides.config ?? loadLlmConfig(overrides.env);
  const provider =
    overrides.provider ??
    answering(envelope(), {
      pricing: config.pricing,
      ...(config.model ? { model: config.model } : {}),
    });
  return {
    provider,
    config,
    autostart: overrides.autostart ?? true,
    ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
  };
}

export interface GenerationContext {
  db: Db;
  llm: LlmRuntime;
}

/**
 * Место для E4-06. Кризис проверяется до INSERT в очередь: если вернуть
 * `skip`, провайдер не вызывается и задание не создаётся.
 *
 * Детектор `detectCrisis` уже доступен из движка. Саму проверку пишет E4-06;
 * здесь постановка всегда разрешена.
 */
export function crisisGate(_openAnswer: string): "enqueue" | "skip" {
  void detectCrisis;
  return "enqueue";
}

export const toGenerationDto = (job: GenerationJobRecord): GenerationDto => ({
  id: job.generationId,
  blockId: job.slot,
  status: job.status,
  regenerated: job.regenerated,
});

const nextAttemptAt = (config: LlmConfig, attempts: number): string => {
  const delay = config.retry.backoffMs * Math.pow(config.retry.backoffFactor, Math.max(0, attempts));
  return new Date(Date.now() + delay).toISOString();
};

function currentTask(context: GenerationContext, profile: ProfileRecord): LlmTask | null {
  return assemble({
    db: context.db,
    profile,
    publicOrigin: "",
    omitStoryline: true,
  }).internal.internal.llmTask;
}

/**
 * Ставит задание ступени 4 в очередь. Повтор той же постановки и одновременный
 * второй запрос возвращают уже существующее живое задание.
 */
export function enqueueStep4(
  context: GenerationContext,
  profile: ProfileRecord,
  options: { regenerate?: boolean; requestId?: string } = {},
): GenerationJobRecord | null {
  const task = currentTask(context, profile);
  if (!task) return null;

  if (crisisGate(task.input.openAnswer) === "skip") return null;

  const version = contentVersion();
  const inputHash = hashGenerationInput(task, version);
  const slot: BlockSlot = "step4";
  const regenerate = options.regenerate === true;

  if (options.requestId) {
    const existing = findJobByRequest(context.db, profile.profileId, options.requestId);
    if (existing) return existing;
  }

  if (regenerate) {
    releaseActiveJob(context.db, profile.profileId, slot, "superseded");
  } else {
    const active = findActiveJob(context.db, profile.profileId, slot);
    if (active) return active;

    const latest = findLatestJob(context.db, profile.profileId, slot);
    // Тот же вход: готовое не пересобираем, проваленное не ставим вторым.
    // Ручная регенерация идёт другой веткой и обходит кэш.
    if (latest && latest.inputHash === inputHash && latest.status !== "pending") return latest;
  }

  const inserted = insertJob(context.db, profile.profileId, {
    slot,
    inputHash,
    contentVersion: version,
    regenerated: regenerate,
    requestId: options.requestId ?? null,
  });

  if (inserted.created) {
    log("generation.enqueued", {
      profileId: profile.profileId,
      generationId: inserted.job.generationId,
      slot,
      regenerated: regenerate ? 1 : 0,
    });
  }

  return inserted.job;
}

const running = new WeakSet<Db>();
const stopped = new WeakSet<LlmRuntime>();
const workers = new WeakMap<LlmRuntime, Promise<void>>();
const inflightByRuntime = new WeakMap<LlmRuntime, Map<string, AbortController>>();

function inflightOf(llm: LlmRuntime): Map<string, AbortController> {
  const existing = inflightByRuntime.get(llm);
  if (existing) return existing;
  const created = new Map<string, AbortController>();
  inflightByRuntime.set(llm, created);
  return created;
}

/**
 * Остановка сервера: живые вызовы прерываются, очередь больше не берёт задания.
 * Сами строки в базе остаются `pending` и доигрываются после следующего старта.
 */
export function abortInflightGenerations(llm: LlmRuntime): void {
  stopped.add(llm);
  const inflight = inflightOf(llm);
  for (const controller of inflight.values()) controller.abort();
  inflight.clear();
}

/** Дождаться текущего прохода очереди. Нужно закрытию сервера, чтобы не писать в закрытую базу. */
export function waitForGenerationWorker(llm: LlmRuntime): Promise<void> {
  return workers.get(llm) ?? Promise.resolve();
}

export function scheduleGenerations(context: GenerationContext): void {
  if (!context.llm.autostart) return;
  if (stopped.has(context.llm)) return;
  if (running.has(context.db)) return;
  running.add(context.db);
  const work = processDueJobs(context).finally(() => running.delete(context.db));
  workers.set(context.llm, work);
}

/** После перезапуска: живые задания доигрываются тем же воркером. */
export function resumeGenerations(context: GenerationContext): void {
  scheduleGenerations(context);
}

async function processDueJobs(context: GenerationContext): Promise<void> {
  if (stopped.has(context.llm)) return;
  const inflight = inflightOf(context.llm);
  for (const job of listDueJobs(context.db)) {
    if (stopped.has(context.llm)) return;
    if (inflight.has(job.generationId)) continue;
    await processJob(context, job.generationId);
  }
}

export async function processJob(context: GenerationContext, generationId: string): Promise<void> {
  if (stopped.has(context.llm)) return;
  const inflight = inflightOf(context.llm);
  const controller = new AbortController();
  inflight.set(generationId, controller);
  try {
    await runJob(context, generationId, controller.signal);
  } finally {
    inflight.delete(generationId);
  }
}

/** Дождаться текущего прогона очереди. Нужно тестам, а не обработчикам. */
export async function drainGenerations(context: GenerationContext): Promise<void> {
  if (stopped.has(context.llm)) return;
  const previous = context.llm.autostart;
  context.llm.autostart = true;
  const work = processDueJobs(context).finally(() => {
    context.llm.autostart = previous;
  });
  workers.set(context.llm, work);
  await work;
}

function applyResult(
  context: GenerationContext,
  job: GenerationJobRecord,
  result: GenerationResultBody,
  cache: boolean,
  profileVersion: number,
): void {
  saveJobResult(context.db, job, result);
  saveBlockContent(context.db, job.profileId, {
    slot: job.slot,
    profileVersion,
    purchased: job.slot.startsWith("slice:"),
    heading: result.heading,
    paragraphs: result.paragraphs,
    highlight: result.highlight,
  });
  if (cache) {
    saveCache(context.db, job.profileId, {
      inputHash: job.inputHash,
      contentVersion: job.contentVersion,
      result,
    });
  }
}

interface CallDraft {
  attempt: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costKopecks: number;
  durationMs: number;
  outcome: CallOutcome;
}

function journalingProvider(
  inner: GenerationProvider,
  sink: (draft: CallDraft) => void,
): GenerationProvider {
  let attempt = 0;
  return {
    id: inner.id,
    model: inner.model,
    pricing: inner.pricing,
    async generate(request, signal): Promise<GenerationResult> {
      attempt += 1;
      const started = Date.now();
      try {
        const result = await inner.generate(request, signal);
        sink({
          attempt,
          provider: inner.id,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costKopecks: costOf(result.usage, inner.pricing),
          durationMs: Date.now() - started,
          outcome: "ok",
        });
        return result;
      } catch (error) {
        const failure = error instanceof GenerationError ? error : new GenerationError("постоянный отказ", "исключение");
        const outcome: CallOutcome =
          failure.code === "таймаут" || failure.code === "прекращено"
            ? "timeout"
            : failure.failure === "временный отказ"
              ? "temporary"
              : "permanent";
        sink({
          attempt,
          provider: inner.id,
          model: inner.model,
          inputTokens: 0,
          outputTokens: 0,
          costKopecks: 0,
          durationMs: Date.now() - started,
          outcome,
        });
        throw error;
      }
    },
  };
}

function flushCalls(context: GenerationContext, job: GenerationJobRecord, drafts: CallDraft[]): void {
  for (const draft of drafts) {
    insertCall(context.db, {
      generationId: job.generationId,
      profileId: job.profileId,
      ...draft,
    });
  }
}

const failureOf = (
  reason: Step4Reason,
): "cost_limit" | "provider" | "output" | "hijack" | "validation" | "storyline" => {
  if (reason === "предел стоимости") return "cost_limit";
  if (reason === "провайдер") return "provider";
  if (reason === "машинный выход") return "output";
  if (reason === "перехват") return "hijack";
  if (reason === "сюжет") return "storyline";
  return "validation";
};

async function runJob(context: GenerationContext, generationId: string, signal: AbortSignal): Promise<void> {
  if (stopped.has(context.llm) || signal.aborted) return;
  const listed = findJobById(context.db, generationId);
  if (!listed || listed.status !== "pending") return;

  const profile = findProfile(context.db, listed.profileId);
  if (!profile) {
    failJob(context.db, listed, "superseded");
    return;
  }

  const task = currentTask(context, profile);
  if (!task) {
    failJob(context.db, listed, "superseded");
    return;
  }

  const version = contentVersion();
  const inputHash = hashGenerationInput(task, version);
  if (inputHash !== listed.inputHash) {
    failJob(context.db, listed, "superseded");
    return;
  }

  markJobStarted(context.db, listed);

  if (!listed.regenerated) {
    const cached = findCache(context.db, listed.profileId, listed.inputHash);
    if (cached) {
      context.db.transaction(() => {
        insertCall(context.db, {
          generationId: listed.generationId,
          profileId: listed.profileId,
          provider: context.llm.provider.id,
          model: "cache",
          attempt: 0,
          inputTokens: 0,
          outputTokens: 0,
          costKopecks: 0,
          durationMs: 0,
          outcome: "cached",
        });
        applyResult(context, listed, cached, false, profile.version);
      });
      log("generation.cached", { profileId: listed.profileId, generationId: listed.generationId, slot: listed.slot });
      return;
    }
  }

  const drafts: CallDraft[] = [];
  const provider = journalingProvider(context.llm.provider, (draft) => drafts.push(draft));
  const spentKopecks = profileCostKopecks(context.db, listed.profileId);

  const outcome = await generateLadderFinal({
    task,
    provider,
    retry: context.llm.config.retry,
    cost: context.llm.config.cost,
    spentKopecks,
    ...(context.llm.sleep ? { sleep: context.llm.sleep } : {}),
    signal,
  });

  // Остановка сервера: задание остаётся живым и доиграется после старта.
  // Прерванный вызов в журнал не пишем — токенов не потрачено.
  if (signal.aborted) return;

  context.db.transaction(() => {
    flushCalls(context, listed, drafts);

    if (outcome.ok) {
      const result: GenerationResultBody = {
        heading: outcome.block.heading,
        paragraphs: outcome.block.paragraphs,
        highlight: outcome.block.highlight,
        storyline: outcome.storyline,
      };
      applyResult(context, listed, result, true, profile.version);
      log("generation.ready", {
        profileId: listed.profileId,
        generationId: listed.generationId,
        slot: listed.slot,
        costKopecks: outcome.costKopecks,
        attempts: outcome.attempts,
      });
      return;
    }

    const code = failureOf(outcome.reason);
    if (code === "provider") {
      const last = drafts[drafts.length - 1];
      const temporary = last?.outcome === "temporary" || last?.outcome === "timeout";
      if (temporary) {
        deferJob(context.db, listed, nextAttemptAt(context.llm.config, listed.attemptCount));
        log("generation.deferred", {
          profileId: listed.profileId,
          generationId: listed.generationId,
          slot: listed.slot,
        });
        return;
      }
    }

    failJob(context.db, listed, code);
    log("generation.failed", {
      profileId: listed.profileId,
      generationId: listed.generationId,
      slot: listed.slot,
      reason: code,
    });
  });
}
