/**
 * Сборка состояния личной страницы.
 *
 *   Ввод → Rule Engine → Profile{16} → lookup-блоки 1–3 → задание LLM на 4 →
 *   → полосы карты → двери → одно платное предложение
 *
 * См. docs/01-architecture.md. Код здесь — водопровод: вся смысловая часть
 * лежит в content/*.md, движок только выбирает и складывает.
 */

import { rawContent } from "./generated/content.js";
import { buildStep1Block, buildStep2Block, buildStep3Block, buildStep4Task, step4Heading } from "./blocks.js";
import { buildMap } from "./map.js";
import { applyNodes } from "./nodes.js";
import { buildDoors, selectOffer } from "./offers.js";
import { applyDisagreements, buildProfile, type ProfileOptions } from "./scoring.js";
import type {
  Block,
  Disagreement,
  LadderAnswers,
  PageState,
  Portion,
  Question,
  Step0Card,
  Step0Input,
} from "./types.js";

export * from "./types.js";
export {
  applyDisagreement,
  applyDisagreements,
  blockCoordinates,
  buildProfile,
  buildProfileFromBank,
  bandFromMean,
  reverseScale,
  scoreCoordinate,
  unknownCoordinates,
  DISAGREEMENT_RULES,
  LADDER_CAP,
} from "./scoring.js";
export { applyNodes, NODE_RULES, fallbackNodeText } from "./nodes.js";
export { buildMap, BAR_DEFINITIONS } from "./map.js";
export { selectOffer, selectOfferAfterSlice, buildDoors } from "./offers.js";
export {
  applySlice,
  checkThreshold,
  nextSliceAfter,
  sameSubtype,
  sliceOwnedCodes,
  subtypeRegistry,
  SCORED_SLICES,
} from "./slices.js";
export { rawContent } from "./generated/content.js";

const SEASONS: { season: string; months: number[] }[] = [
  { season: "Весна", months: [3, 4, 5] },
  { season: "Лето", months: [6, 7, 8] },
  { season: "Осень", months: [9, 10, 11] },
  { season: "Зима", months: [12, 1, 2] },
];

/**
 * Карточка входа. Дата рождения нужна для карточки и визуала и не участвует
 * в скоринге: сезон берётся по текущей дате (content/step0-welcome.md).
 */
export function buildStep0Card(input: Step0Input, now: Date = new Date()): Step0Card {
  const cta = "Три вопроса — и я скажу, как ты на самом деле работаешь";
  if (!input.birthDate) {
    return { name: input.name, season: null, theme: null, metaphor: null, cta };
  }

  const month = now.getMonth() + 1;
  const season = SEASONS.find((candidate) => candidate.months.includes(month))?.season ?? null;
  const theme = rawContent.step0.themes.find((candidate) => candidate.season === season)?.theme ?? null;
  const metaphor = rawContent.step0.metaphors.find((candidate) => candidate.season === season)?.text ?? null;

  return { name: input.name, season, theme, metaphor, cta };
}

const toQuestion = (question: (typeof rawContent.questions)[number]): Question => ({
  id: question.id,
  type: question.type,
  text: question.text,
  options: question.options,
  scale: question.scale,
});

export function portionForStep(step: 1 | 2 | 3 | 4): Portion | null {
  const questions = rawContent.questions.filter((question) => question.step === step);
  if (!questions.length) return null;
  return { step, lead: rawContent.leads[String(step)] ?? "", questions: questions.map(toQuestion) };
}

/** Последняя ступень, порция которой отвечена полностью. */
export function completedStep(answers: LadderAnswers): 0 | 1 | 2 | 3 | 4 {
  const answered = (id: string): boolean => {
    const value = (answers as Record<string, string | number | undefined>)[id];
    if (typeof value === "string") return value.trim().length > 0;
    return value !== undefined;
  };

  let completed: 0 | 1 | 2 | 3 | 4 = 0;
  for (const step of [1, 2, 3, 4] as const) {
    const ids = rawContent.questions.filter((question) => question.step === step).map((question) => question.id);
    if (ids.length && ids.every(answered)) completed = step;
    else break;
  }
  return completed;
}

export interface PageOptions extends ProfileOptions {
  /**
   * Несогласия с уже показанными блоками. Понижают уверенность в координатах
   * блока и не трогают его текст (content/scoring-rules.md, «Несогласие с блоком»).
   */
  disagreements?: Disagreement[];
}

/**
 * Полное состояние страницы по текущим ответам: публичная половина в `view`,
 * профиль и задание для LLM — в `internal`. Наружу уходит только `view`.
 */
export function buildPage(input: Step0Input, answers: LadderAnswers, options: PageOptions = {}): PageState {
  const step = completedStep(answers);
  // Несогласие применяется после узлов: сработавший узел от него не меняется,
  // а значит, и текст блока ступени 3 остаётся прежним.
  const profile = applyDisagreements(applyNodes(buildProfile(answers, options), answers), options.disagreements ?? []);

  const blocks: Block[] = [];
  if (step >= 1) {
    const block = buildStep1Block(answers);
    if (block) blocks.push(block);
  }
  if (step >= 2) {
    const block = buildStep2Block(answers);
    if (block) blocks.push(block);
  }
  if (step >= 3) {
    const block = buildStep3Block(profile);
    if (block) blocks.push(block);
  }

  const llmTask = step >= 4 ? buildStep4Task(answers, profile, blocks) : null;
  if (llmTask) {
    blocks.push({ step: 4, heading: step4Heading(), paragraphs: [], highlight: null, source: "llm" });
  }

  const offer = step >= 4 && llmTask ? selectOffer(profile) : null;
  const hook = step >= 3 ? (profile.nodes[0]?.text.split(". ")[0] ?? null) : (blocks[0]?.highlight ?? null);

  return {
    view: {
      step,
      card: buildStep0Card(input),
      hook: hook ? `${hook.replace(/\.$/, "")}.` : null,
      map: buildMap(profile, answers),
      blocks,
      doors: buildDoors(profile, blocks, offer, step),
      offer,
      nextPortion: step < 4 ? portionForStep((step + 1) as 1 | 2 | 3 | 4) : null,
    },
    internal: { profile, llmTask },
  };
}
