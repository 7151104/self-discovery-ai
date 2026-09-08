/**
 * Финал лестницы: от задания движка до проверенного блока (E4-02, E4-04, E4-05, E4-07, E4-09).
 *
 * Функция на вход-выход. Ни хранения, ни HTTP, ни очереди: на вход — задание
 * движка, провайдер и политика вызова, на выход — либо блок с сюжетом для
 * координаты 15, либо отказ с причиной. Что делать с отказом (повторить, показать
 * ожидание, записать стоимость), решает владелец сервера — это задачи E4-03,
 * E4-10 и E4-11.
 *
 * Сюжет наружу отдаётся ровно в той форме, которую принимает движок
 * (`ProfileOptions.storyline`), и только после всех проверок: невалидный машинный
 * выход в профиль не попадает.
 */

import { ladderCapOf, volumeOf } from "./content.js";
import { rawContent, type Block, type Confidence, type LlmTask } from "./engine.js";
import { detectHijack, type HijackSign } from "./isolation.js";
import { parseModelOutput, describeProblem, type Statement, type Storyline } from "./output.js";
import { buildStep4Prompt, outputTokenBudget } from "./prompt.js";
import { checkRegisters, describeRegisterProblem } from "./registers.js";
import { runGeneration, type CostPolicy, type RetryPolicy } from "./runner.js";
import { paragraphs } from "./text.js";
import { LADDER_FINAL, describeViolation, validateText, type Violation } from "./validator.js";
import type { GenerationProvider } from "./provider.js";

/** Почему блок не собран. Одна причина — один вид отказа для сервера. */
export type Step4Reason =
  | "предел стоимости"
  | "провайдер"
  | "машинный выход"
  | "перехват"
  | "текст"
  | "регистры"
  | "сюжет";

export interface Step4Options {
  task: LlmTask;
  provider: GenerationProvider;
  retry: RetryPolicy;
  cost: CostPolicy;
  /** Сколько уже потрачено на этот профиль: число приносит вызывающий. */
  spentKopecks: number;
  /** Граница конверта. Задаётся только в тестах. */
  nonce?: string;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export type Step4Outcome =
  | {
      ok: true;
      block: Block;
      /** Готов к передаче в движок как `ProfileOptions.storyline`. */
      storyline: Storyline;
      statements: Statement[];
      /** Места, которые реестр оставляет человеку. Блок при них выдаётся. */
      warnings: Violation[];
      attempts: number;
      costKopecks: number;
    }
  | { ok: false; reason: Step4Reason; details: string[]; attempts: number; costKopecks: number };

const ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Сюжет приходит из открытого ответа, а его потолок в лестнице записан в
 * `content/scoring-rules.md`. Модель, объявившая `high`, обошла бы правило
 * лестницы: движок потолок к синтезу не применяет, значит применяет слой.
 */
function storylineProblems(storyline: Storyline): string[] {
  const cap = ladderCapOf(15);
  if (cap && ORDER[storyline.confidence] > ORDER[cap])
    return [`уверенность сюжета ${storyline.confidence} выше потолка лестницы ${cap}`];
  return [];
}

export async function generateLadderFinal(options: Step4Options): Promise<Step4Outcome> {
  const { task, provider } = options;
  const prompt = buildStep4Prompt(task, options.nonce);
  const volume = volumeOf(LADDER_FINAL);

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
    const reason: Step4Reason = run.failure === "предел стоимости" ? "предел стоимости" : "провайдер";
    return { ok: false, reason, details: [`${run.failure}: ${run.code}`], attempts: run.attempts, costKopecks: 0 };
  }

  const spent = { attempts: run.attempts, costKopecks: run.costKopecks };
  const fail = (reason: Step4Reason, details: string[]): Step4Outcome => ({ ok: false, reason, details, ...spent });

  const parsed = parseModelOutput(run.result.text, { knownCoordinates: prompt.knownCoordinates });
  if (!parsed.ok) return fail("машинный выход", parsed.problems.map(describeProblem));

  const { text, statements, storyline } = parsed.output;

  const hijack: HijackSign[] = detectHijack(text, { nonce: prompt.nonce, openAnswer: task.input.openAnswer });
  if (hijack.length) return fail("перехват", hijack.map((sign) => `${sign.kind}: ${sign.detail}`));

  const verdict = validateText(text, { type: LADDER_FINAL });
  if (!verdict.ok) return fail("текст", verdict.violations.map(describeViolation));

  const registers = checkRegisters(parsed.output, { profile: task.input.profile, openAnswer: task.input.openAnswer });
  if (registers.length) return fail("регистры", registers.map(describeRegisterProblem));

  const storylineIssues = storylineProblems(storyline);
  if (storylineIssues.length) return fail("сюжет", storylineIssues);

  return {
    ok: true,
    block: { step: 4, heading: rawContent.step4.heading, paragraphs: paragraphs(text), highlight: null, source: "llm" },
    storyline,
    statements,
    warnings: verdict.warnings,
    ...spent,
  };
}
