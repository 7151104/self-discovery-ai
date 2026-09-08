/**
 * Слой LLM: что он отдаёт наружу.
 *
 * Слой чистый и вызываемый: функции на вход-выход, без HTTP и без своей базы.
 * Очередь, журнал стоимости и кэш хранит сервер (E4-03, E4-10, E4-11); слой
 * отдаёт ему проверенный результат, хеш входа и числа.
 *
 * Границы, которые слой держит и которые нельзя обойти вызовом:
 *   провайдер виден только через порт `GenerationProvider`;
 *   задание модели собирается из `content/step4-open-synthesis.md`, а не из кода;
 *   пользовательский текст не склеивается с инструкцией;
 *   сюжет для координаты 15 уходит наружу только после всех проверок.
 */

export {
  costOf,
  estimateCost,
  GenerationError,
  type GenerationFailure,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type TokenPricing,
  type TokenUsage,
} from "./provider.js";

export { FakeProvider, answering, type FakeProviderOptions, type FakeTurn } from "./fake-provider.js";

export { StubProvider, stubEnvelope, type StubProviderOptions } from "./stub-provider.js";

export {
  createGenerationProvider,
  knownLlmProviders,
  UnknownLlmProvider,
  type ProviderFactoryInput,
  type ProviderName,
} from "./registry.js";

export { envelope, GOOD_TEXT, DEMO_ANSWERS, DEMO_PERSON, textOfVolume, sliceEnvelope } from "./fixtures.js";

export {
  runGeneration,
  type CostPolicy,
  type RetryPolicy,
  type RunFailure,
  type RunOptions,
  type RunOutcome,
} from "./runner.js";

export { DEFAULTS, LlmConfigError, loadLlmConfig, type LlmConfig } from "./config.js";

export {
  buildStep4Prompt,
  buildSlicePrompt,
  instructionOf,
  openAnswerWords,
  outputTokenBudget,
  sliceHeading,
  sliceReportType,
  type AssembledPrompt,
  type PromptSegment,
  type SegmentKind,
  type SliceTask,
} from "./prompt.js";

export {
  detectHijack,
  escapeUserText,
  newNonce,
  wrapUserText,
  type Envelope,
  type HijackCheck,
  type HijackSign,
} from "./isolation.js";

export {
  CLAIM_KINDS,
  describeProblem,
  outputContractText,
  parseModelOutput,
  type ModelOutput,
  type OutputProblem,
  type ParsedOutput,
  type Statement,
  type StatementKind,
  type Storyline,
} from "./output.js";

export { checkRegisters, describeRegisterProblem, type RegisterCheck, type RegisterProblem } from "./registers.js";

export { failureNotesForLog, stripQuotedFailureDetail } from "./failure-notes.js";

export {
  LADDER_FINAL,
  describeViolation,
  validateText,
  type TextCheckOptions,
  type TextVerdict,
  type ValidationRule,
  type Violation,
} from "./validator.js";

export { generateLadderFinal, type Step4Options, type Step4Outcome, type Step4Reason } from "./step4.js";

export { contentVersion, hashGenerationInput, hashSliceInput, stableGenerationInput, stableSliceInput } from "./input-hash.js";

export { ladderCapOf, registerMarkers, reportTypes, volumeOf, assemblerPrompt, sliceOverlay, overlaySlices, reportTypeOfSlice, type ReportType, type WordRange } from "./content.js";

export { crisisGate, crisisOf, avoidInstruction } from "./crisis.js";

export { generatePaidSlice, findingsForSlice, openAnswersOf, sliceTaskOf, type SliceOptions, type SliceOutcome, type SliceReason } from "./slice.js";
