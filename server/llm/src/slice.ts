/**
 * Генерация платного среза (E4-08).
 *
 * Тот же контур, что у финала лестницы: порог и кризис — до провайдера,
 * промпт из файлов, валидатор выхода, регистры если модель их разметила.
 * Порог не взят → отчёт не пишется, наружу уходят уточняющие из файла среза.
 */

import { reportTypeOfSlice, volumeOf } from "./content.js";
import { crisisOf } from "./crisis.js";
import {
  applySlice,
  buildFullMapProfile,
  checkThreshold,
  detectCrisis,
  fullMapQuestions,
  fullMapThreshold,
  fullMapThresholdBeforeSynthesis,
  rawContent,
  scanText,
  type FullMapInput,
  type Profile,
  type ProfileOptions,
  type SliceAnswers,
  type SliceTextFindings,
} from "./engine.js";
import { detectHijack, type HijackSign } from "./isolation.js";
import { describeProblem, parseModelOutput, type Storyline } from "./output.js";
import { buildSlicePrompt, outputTokenBudget, sliceHeading, type SliceTask } from "./prompt.js";
import { checkRegisters, describeRegisterProblem } from "./registers.js";
import { runGeneration, type CostPolicy, type RetryPolicy } from "./runner.js";
import { paragraphs } from "./text.js";
import { describeViolation, validateText, type Violation } from "./validator.js";
import type { GenerationProvider } from "./provider.js";

export type SliceReason =
  | "кризис"
  | "порог"
  | "предел стоимости"
  | "провайдер"
  | "машинный выход"
  | "перехват"
  | "текст"
  | "регистры";

export interface SliceOptions {
  task: SliceTask;
  provider: GenerationProvider;
  retry: RetryPolicy;
  cost: CostPolicy;
  spentKopecks: number;
  nonce?: string;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export type SliceOutcome =
  | {
      ok: true;
      heading: string;
      paragraphs: string[];
      highlight: string | null;
      warnings: Violation[];
      attempts: number;
      costKopecks: number;
      /** Задача периода (координата 16): только полная карта, из того же вызова. */
      periodTask?: Storyline | null;
    }
  | {
      ok: false;
      reason: SliceReason;
      details: string[];
      followUps: string[];
      attempts: number;
      costKopecks: number;
    };

const sliceFile = (slice: string) => {
  const found = rawContent.slices.find((item) => item.id === slice);
  if (!found) throw new Error(`llm/slice: нет среза ${slice}`);
  return found;
};

/**
 * Находки из открытых ответов, которые движок сам не читает.
 * Для развилки — безопасна ли тема: кризис и клиническая/медицинская рамка
 * закрывают `safeTopic`, иначе порог `slice_decision_moment` не берётся.
 */
export function findingsForSlice(slice: string, answers: SliceAnswers): SliceTextFindings {
  if (slice !== "slice_decision_moment") return {};
  const texts = Object.values(answers).filter((value): value is string => typeof value === "string");
  const blob = texts.join("\n");
  if (!blob.trim()) return { safeTopic: false };
  const blocked = detectCrisis(blob).blocked;
  const clinical = scanText(blob, "разбор", { group: "FORBIDDEN_CLINICAL" });
  const medical = scanText(blob, "разбор", { group: "FORBIDDEN_MEDICAL" });
  return { safeTopic: !blocked && clinical.length === 0 && medical.length === 0 };
}

export function openAnswersOf(slice: string, answers: SliceAnswers): { id: string; text: string }[] {
  if (slice === "slice_full_map") {
    const out: { id: string; text: string }[] = [];
    for (const question of fullMapQuestions()) {
      if (question.type !== "открытый") continue;
      const value = answers[question.id];
      if (typeof value === "string" && value.trim()) out.push({ id: question.id, text: value.trim() });
    }
    return out;
  }
  const content = sliceFile(slice);
  const out: { id: string; text: string }[] = [];
  for (const question of content.questions) {
    if (question.type !== "открытый") continue;
    const value = answers[question.id];
    if (typeof value === "string" && value.trim()) out.push({ id: question.id, text: value });
  }
  if (typeof answers.entry === "string" && answers.entry.trim()) {
    if (!out.some((item) => item.id === "entry")) out.unshift({ id: "entry", text: answers.entry });
  }
  return out;
}

/**
 * Задание полной карты. В `SCORED_SLICES` её нет: `applySlice` и `checkThreshold`
 * её не принимают. Порог — `fullMapThreshold` после разбора, не до провайдера.
 */
export function fullMapTaskOf(
  input: FullMapInput,
  extra: {
    shownBlocks?: SliceTask["shownBlocks"];
    storyline?: NonNullable<ProfileOptions["storyline"]>;
  } = {},
): SliceTask {
  const options: ProfileOptions = extra.storyline ? { storyline: extra.storyline } : {};
  const profile = buildFullMapProfile(input, options);
  const answers: SliceAnswers = { ...(input.bank ?? {}) };
  return {
    slice: "slice_full_map",
    profile,
    before: profile,
    answers,
    findings: {},
    shownBlocks: extra.shownBlocks ?? [],
    openAnswers: openAnswersOf("slice_full_map", answers),
    fullMap: input,
    ...(extra.storyline ? { storyline: extra.storyline } : {}),
  };
}

const fail = (
  reason: SliceReason,
  details: string[],
  extra: { followUps?: string[]; attempts: number; costKopecks: number },
): SliceOutcome => ({
  ok: false,
  reason,
  details,
  followUps: extra.followUps ?? [],
  attempts: extra.attempts,
  costKopecks: extra.costKopecks,
});

export async function generatePaidSlice(options: SliceOptions): Promise<SliceOutcome> {
  if (options.task.slice === "slice_full_map") return generateFullMapSlice(options);

  const { task, provider } = options;
  const spent = { attempts: 0, costKopecks: 0 };
  const findings = task.findings;
  const after = applySlice(task.slice, task.before, task.answers, findings);
  const open = task.openAnswers.length ? task.openAnswers : openAnswersOf(task.slice, task.answers);
  const joined = open.map((item) => item.text);

  const crisis = crisisOf(joined);
  if (crisis.blocked) {
    return fail("кризис", crisis.reason ? [crisis.reason, ...crisis.categories] : crisis.categories, {
      ...spent,
    });
  }

  const threshold = checkThreshold(task.slice, after, task.answers, findings, task.before);
  if (threshold.blocked) {
    return fail("кризис", [threshold.blocked], spent);
  }
  if (!threshold.passed) {
    return fail("порог", threshold.missing, { ...spent, followUps: threshold.followUps });
  }

  const prompt = buildSlicePrompt({ ...task, profile: after, findings, openAnswers: open }, options.nonce, crisis.avoid);
  const type = reportTypeOfSlice(task.slice);
  const volume = volumeOf(type);

  const run = await runGeneration({
    provider,
    request: {
      instruction: prompt.instruction,
      data: prompt.data,
      expects: "json",
      maxOutputTokens: outputTokenBudget(volume.max),
      temperature: 0,
    },
    retry: options.retry,
    cost: options.cost,
    spentKopecks: options.spentKopecks,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!run.ok) {
    const reason: SliceReason = run.failure === "предел стоимости" ? "предел стоимости" : "провайдер";
    return fail(reason, [`${run.failure}: ${run.code}`], { attempts: run.attempts, costKopecks: 0 });
  }

  const paid = { attempts: run.attempts, costKopecks: run.costKopecks };

  const parsed = parseModelOutput(run.result.text, {
    knownCoordinates: prompt.knownCoordinates,
    storyline: "optional",
    statements: "optional",
  });
  if (!parsed.ok) return fail("машинный выход", parsed.problems.map(describeProblem), paid);

  const { text, statements } = parsed.output;
  const hijack: HijackSign[] = detectHijack(text, {
    nonce: prompt.nonce,
    openAnswer: joined.join("\n"),
  });
  if (hijack.length) return fail("перехват", hijack.map((sign) => `${sign.kind}: ${sign.detail}`), paid);

  const verdict = validateText(text, { type });
  if (!verdict.ok) return fail("текст", verdict.violations.map(describeViolation), paid);

  if (statements.length) {
    const registers = checkRegisters(parsed.output, {
      profile: after,
      openAnswer: joined.join("\n"),
    });
    if (registers.length) return fail("регистры", registers.map(describeRegisterProblem), paid);
  }

  return {
    ok: true,
    heading: sliceHeading(task.slice),
    paragraphs: paragraphs(text),
    highlight: null,
    warnings: verdict.warnings,
    ...paid,
  };
}

/**
 * Полная карта: порог до провайдера только на О3 (иначе курица-яйцо координаты 16).
 * `задача_периода` уходит в том же конверте, что текст; `fullMapThreshold` —
 * после разбора и до записи. `applySlice` не вызывается.
 */
async function generateFullMapSlice(options: SliceOptions): Promise<SliceOutcome> {
  const { task, provider } = options;
  const spent = { attempts: 0, costKopecks: 0 };
  const input = task.fullMap;
  if (!input) return fail("порог", ["нет входа полной карты"], spent);

  const open = task.openAnswers.length ? task.openAnswers : openAnswersOf(task.slice, task.answers);
  const joined = open.map((item) => item.text);
  const crisis = crisisOf(joined);
  if (crisis.blocked) {
    return fail("кризис", crisis.reason ? [crisis.reason, ...crisis.categories] : crisis.categories, {
      ...spent,
    });
  }

  const preOptions: ProfileOptions = task.storyline ? { storyline: task.storyline } : {};
  const preProfile = buildFullMapProfile(input, preOptions);
  const pre = fullMapThresholdBeforeSynthesis(input, preOptions);
  if (!pre.passed) {
    return fail("порог", pre.missing, { ...spent, followUps: pre.followUps });
  }

  const prompt = buildSlicePrompt({ ...task, profile: preProfile, openAnswers: open }, options.nonce, crisis.avoid);
  const type = reportTypeOfSlice(task.slice);
  const volume = volumeOf(type);

  const run = await runGeneration({
    provider,
    request: {
      instruction: prompt.instruction,
      data: prompt.data,
      expects: "json",
      maxOutputTokens: outputTokenBudget(volume.max),
      temperature: 0,
    },
    retry: options.retry,
    cost: options.cost,
    spentKopecks: options.spentKopecks,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!run.ok) {
    const reason: SliceReason = run.failure === "предел стоимости" ? "предел стоимости" : "провайдер";
    return fail(reason, [`${run.failure}: ${run.code}`], { attempts: run.attempts, costKopecks: 0 });
  }

  const paid = { attempts: run.attempts, costKopecks: run.costKopecks };
  const parsed = parseModelOutput(run.result.text, {
    knownCoordinates: prompt.knownCoordinates,
    storyline: "optional",
    periodTask: "required",
    statements: "optional",
  });
  if (!parsed.ok) return fail("машинный выход", parsed.problems.map(describeProblem), paid);

  const { text, statements, periodTask } = parsed.output;
  if (!periodTask) return fail("машинный выход", ["нет поля: задача_периода"], paid);

  const afterOptions: ProfileOptions = {
    ...preOptions,
    periodTask,
  };
  const after = buildFullMapProfile(input, afterOptions);
  const threshold = fullMapThreshold(input, after, afterOptions);
  if (!threshold.passed) {
    return fail("порог", threshold.missing, { ...paid, followUps: threshold.followUps });
  }

  const hijack: HijackSign[] = detectHijack(text, {
    nonce: prompt.nonce,
    openAnswer: joined.join("\n"),
  });
  if (hijack.length) return fail("перехват", hijack.map((sign) => `${sign.kind}: ${sign.detail}`), paid);

  const verdict = validateText(text, { type });
  if (!verdict.ok) return fail("текст", verdict.violations.map(describeViolation), paid);

  if (statements.length) {
    const registers = checkRegisters(parsed.output, {
      profile: after,
      openAnswer: joined.join("\n"),
    });
    if (registers.length) return fail("регистры", registers.map(describeRegisterProblem), paid);
  }

  return {
    ok: true,
    heading: sliceHeading(task.slice),
    paragraphs: paragraphs(text),
    highlight: null,
    warnings: verdict.warnings,
    periodTask,
    ...paid,
  };
}

/** Собрать задание среза из профиля и ответов: порог считает движок. */
export function sliceTaskOf(
  slice: string,
  profile: Profile,
  answers: SliceAnswers,
  extra: { before?: Profile; shownBlocks?: SliceTask["shownBlocks"]; findings?: SliceTextFindings } = {},
): SliceTask {
  const findings = extra.findings ?? findingsForSlice(slice, answers);
  const before = extra.before ?? profile;
  const after = applySlice(slice, before, answers, findings);
  return {
    slice,
    profile: after,
    before,
    answers,
    findings,
    shownBlocks: extra.shownBlocks ?? [],
    openAnswers: openAnswersOf(slice, answers),
  };
}
