/**
 * Очередь генерации (E4-03), учёт стоимости (E4-10), кэш и деградация (E4-11).
 *
 * Слой LLM остаётся чистым: считает промпт, хеш входа, вызывает провайдера и
 * отдаёт числа. Здесь — постановка задания, переживание перезапуска, журнал
 * вызовов и кэш. Защита от второй генерации держится уникальным индексом
 * `generation_jobs_active_slot_idx`, а не проверкой в коде.
 */

import {
  costOf,
  contentVersion,
  createGenerationProvider,
  failureNotesForLog,
  findingsForSlice,
  generateLadderFinal,
  generatePaidSlice,
  GenerationError,
  hashGenerationInput,
  hashSliceInput,
  loadLlmConfig,
  openAnswersOf,
  sliceTaskOf,
  fullMapTaskOf,
  crisisGate,
  type GenerationProvider,
  type GenerationResult,
  type LlmConfig,
  type SliceReason,
  type SliceTask,
  type Step4Reason,
} from "../llm/dist/index.js";
import type { BlockSlot, GenerationDto } from "./contract/index.js";
import type { Db } from "./db/driver.js";
import {
  applySlice,
  checkThreshold,
  fullMapThresholdBeforeSynthesis,
  nextFullMapPortion,
  SCORED_SLICES,
  sliceDelivered,
  type Block,
  type LlmTask,
} from "./engine.js";
import { log } from "./log.js";
import { assemble, toFullMapInput, toLadderAnswers, toSliceAnswers } from "./page.js";
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
  listAnswers,
  listBlocks,
  listDueJobs,
  markJobStarted,
  paidSlices,
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
 * Рабочий контур слоя: настройки из окружения и провайдер из реестра слоя.
 * По умолчанию это заглушка: она собирает валидный выход из самого задания.
 * Тесты подменяют провайдера и выключают автозапуск.
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
    createGenerationProvider({
      provider: config.provider,
      pricing: config.pricing,
      model: config.model,
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
 * Кризисный крючок очереди (E4-06). Детектор — движок, решение «ставить
 * задание или нет» — слой LLM. Постановка читает тот же крючок: `skip`
 * означает, что INSERT не делается и провайдер не вызывается.
 */
export { crisisGate };

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

function ladderShownBlocks(context: GenerationContext, profile: ProfileRecord): Block[] {
  const assembled = assemble({ db: context.db, profile, publicOrigin: "" });
  const lookup = assembled.internal.view.blocks.filter((block) => block.paragraphs.length);
  const saved = listBlocks(context.db, profile.profileId).find(
    (block) => block.slot === "step4" && block.status === "ready" && block.paragraphs.length,
  );
  if (!saved) return lookup;
  return [
    ...lookup,
    {
      step: 4,
      heading: saved.heading,
      paragraphs: saved.paragraphs,
      highlight: saved.highlight,
      source: "llm",
    },
  ];
}

function currentSliceTask(context: GenerationContext, profile: ProfileRecord, slice: string): SliceTask | null {
  if (slice === "slice_full_map") {
    const stored = listAnswers(context.db, profile.profileId);
    const input = toFullMapInput(stored, toLadderAnswers(stored), paidSlices(context.db, profile.profileId));
    if (nextFullMapPortion(input)) return null;
    const open = openAnswersOf(slice, toSliceAnswers(stored, slice));
    if (crisisGate(open.map((item) => item.text).join("\n")) === "skip") return null;
    const storyline = findLatestJob(context.db, profile.profileId, "step4")?.result?.storyline;
    const options = storyline ? { storyline } : {};
    const threshold = fullMapThresholdBeforeSynthesis(input, options);
    if (!threshold.passed) return null;
    return fullMapTaskOf(input, {
      shownBlocks: ladderShownBlocks(context, profile),
      ...(storyline ? { storyline } : {}),
    });
  }
  if (!SCORED_SLICES.includes(slice)) return null;
  const assembled = assemble({ db: context.db, profile, publicOrigin: "" });
  const answers = toSliceAnswers(listAnswers(context.db, profile.profileId), slice);
  if (!sliceDelivered(slice, answers)) return null;
  const findings = findingsForSlice(slice, answers);
  const before = assembled.internal.internal.profile;
  const after = applySlice(slice, before, answers, findings);
  const threshold = checkThreshold(slice, after, answers, findings, before);
  if (threshold.blocked || !threshold.passed) return null;
  const open = openAnswersOf(slice, answers);
  if (crisisGate(open.map((item) => item.text).join("\n")) === "skip") return null;
  return sliceTaskOf(slice, before, answers, {
    before,
    findings,
    shownBlocks: ladderShownBlocks(context, profile),
  });
}

function putJob(
  context: GenerationContext,
  profile: ProfileRecord,
  slot: BlockSlot,
  inputHash: string,
  options: { regenerate?: boolean; requestId?: string } = {},
): GenerationJobRecord {
  const version = contentVersion();
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

/**
 * Ставит в очередь оплаченные срезы, у которых добор пройден, порог взят
 * и кризисный крючок не режет. Порог не взят — задания нет: отчёт не пишется.
 */
export function enqueuePaidSlices(context: GenerationContext, profile: ProfileRecord): void {
  const version = contentVersion();
  const stored = listBlocks(context.db, profile.profileId);
  for (const slice of paidSlices(context.db, profile.profileId)) {
    const slot: BlockSlot = `slice:${slice}`;
    // Купленный готовый блок не переписывается: повторная постановка не нужна.
    if (stored.some((block) => block.slot === slot && block.status === "ready")) continue;
    const task = currentSliceTask(context, profile, slice);
    if (!task) continue;
    if (crisisGate(task.openAnswers.map((item) => item.text).join("\n")) === "skip") continue;
    putJob(context, profile, slot, hashSliceInput(task, version));
  }
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
  const seen = new Set<string>();
  for (;;) {
    if (stopped.has(context.llm)) return;
    const due = listDueJobs(context.db).filter(
      (job) => !inflight.has(job.generationId) && !seen.has(job.generationId),
    );
    if (!due.length) return;
    for (const job of due) {
      if (stopped.has(context.llm)) return;
      seen.add(job.generationId);
      await processJob(context, job.generationId);
    }
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
  reason: Step4Reason | SliceReason,
): "cost_limit" | "provider" | "output" | "hijack" | "validation" | "storyline" | "crisis" | "threshold" => {
  if (reason === "кризис") return "crisis";
  if (reason === "порог") return "threshold";
  if (reason === "предел стоимости") return "cost_limit";
  if (reason === "провайдер") return "provider";
  if (reason === "машинный выход") return "output";
  if (reason === "перехват") return "hijack";
  if (reason === "сюжет") return "storyline";
  return "validation";
};

type JobOutcome =
  | {
      ok: true;
      heading: string;
      paragraphs: string[];
      highlight: string | null;
      storyline?: GenerationResultBody["storyline"];
      periodTask?: GenerationResultBody["periodTask"];
      costKopecks: number;
      attempts: number;
    }
  | { ok: false; reason: Step4Reason | SliceReason; details: string[]; attempts: number; costKopecks: number };

async function runJob(context: GenerationContext, generationId: string, signal: AbortSignal): Promise<void> {
  if (stopped.has(context.llm) || signal.aborted) return;
  const listed = findJobById(context.db, generationId);
  if (!listed || listed.status !== "pending") return;

  const profile = findProfile(context.db, listed.profileId);
  if (!profile) {
    failJob(context.db, listed, "superseded");
    return;
  }

  const version = contentVersion();
  let inputHash: string;
  const slice = listed.slot.startsWith("slice:") ? listed.slot.slice("slice:".length) : null;

  if (listed.slot === "step4") {
    const task = currentTask(context, profile);
    if (!task) {
      failJob(context.db, listed, "superseded");
      return;
    }
    inputHash = hashGenerationInput(task, version);
  } else if (slice) {
    const task = currentSliceTask(context, profile, slice);
    if (!task) {
      failJob(context.db, listed, "superseded");
      return;
    }
    inputHash = hashSliceInput(task, version);
  } else {
    failJob(context.db, listed, "superseded");
    return;
  }

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
  const runOptions = {
    provider,
    retry: context.llm.config.retry,
    cost: context.llm.config.cost,
    spentKopecks,
    ...(context.llm.sleep ? { sleep: context.llm.sleep } : {}),
    signal,
  };

  let outcome: JobOutcome;
  if (listed.slot === "step4") {
    const task = currentTask(context, profile);
    if (!task) {
      failJob(context.db, listed, "superseded");
      return;
    }
    const generated = await generateLadderFinal({ task, ...runOptions });
    outcome = generated.ok
      ? {
          ok: true,
          heading: generated.block.heading,
          paragraphs: generated.block.paragraphs,
          highlight: generated.block.highlight,
          storyline: generated.storyline,
          costKopecks: generated.costKopecks,
          attempts: generated.attempts,
        }
      : generated;
  } else {
    const task = currentSliceTask(context, profile, slice!);
    if (!task) {
      failJob(context.db, listed, "superseded");
      return;
    }
    const generated = await generatePaidSlice({ task, ...runOptions });
    outcome = generated.ok
      ? {
          ok: true,
          heading: generated.heading,
          paragraphs: generated.paragraphs,
          highlight: generated.highlight,
          ...(generated.periodTask ? { periodTask: generated.periodTask } : {}),
          costKopecks: generated.costKopecks,
          attempts: generated.attempts,
        }
      : generated;
  }

  // Остановка сервера: задание остаётся живым и доиграется после старта.
  // Прерванный вызов в журнал не пишем — токенов не потрачено.
  if (signal.aborted) return;

  context.db.transaction(() => {
    flushCalls(context, listed, drafts);

    if (outcome.ok) {
      const result: GenerationResultBody = {
        heading: outcome.heading,
        paragraphs: outcome.paragraphs,
        highlight: outcome.highlight,
        ...(outcome.storyline ? { storyline: outcome.storyline } : {}),
        ...(outcome.periodTask ? { periodTask: outcome.periodTask } : {}),
      };
      applyResult(context, listed, result, true, profile.version);
      if (listed.slot === "step4") enqueuePaidSlices(context, profile);
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
    const problems = failureNotesForLog(outcome.details);
    log("generation.failed", {
      profileId: listed.profileId,
      generationId: listed.generationId,
      slot: listed.slot,
      reason: code,
      ...(problems ? { problems } : {}),
    });
  });
}
