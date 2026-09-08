/**
 * Сборка блоков страницы.
 *
 * Ступени 1–3 — только lookup из content/step*.md, без единого обращения к LLM
 * (docs/01-architecture.md). Ступень 4 текста не собирает, а отдаёт задание для LLM.
 */

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";
import { crisisBlocks } from "./crisis.js";
import { fallbackNodeText } from "./nodes.js";
import { slicePortions } from "./slices.js";
import type { Block, InterludeBlock, LadderAnswers, LlmTask, Profile, SliceAnswers } from "./types.js";

const answerAt = (answers: LadderAnswers, id: string): string | number | undefined =>
  (answers as Record<string, string | number | undefined>)[id];

const extrasMatch = (extras: Record<string, string>, answers: LadderAnswers): boolean =>
  Object.entries(extras).every(([question, expected]) => answerAt(answers, question) === expected);

const branchText = (
  branches: Record<string, Record<string, { label: string; text: string }>>,
  question: string,
  answer: string | undefined,
): string | null => (answer ? (branches[question]?.[answer]?.text ?? null) : null);

const scaleText = (question: string, value: number | undefined): string | null => {
  if (value === undefined) return null;
  const branch = rawContent.step2.scales[question]?.find((candidate) => value >= candidate.from && value <= candidate.to);
  return branch?.text ?? null;
};

/** Фраза-сшивка ступени 1: сначала строки с дополнительными условиями, они точнее. */
function pairPhrase(answers: LadderAnswers): string | null {
  const candidates = rawContent.step1.matrix
    .filter((row) => {
      const firstOk = row.first === "*" || row.first === answers.L1;
      const secondOk = row.second === "*" || row.second === answers.L2;
      return firstOk && secondOk && extrasMatch(row.firstExtra, answers) && extrasMatch(row.secondExtra, answers);
    })
    .sort(
      (a, b) =>
        Object.keys(b.firstExtra).length +
        Object.keys(b.secondExtra).length -
        (Object.keys(a.firstExtra).length + Object.keys(a.secondExtra).length),
    );
  return candidates[0]?.text ?? null;
}

/** Фраза «цена силы» ступени 2: ответ на L5 в паре с диапазоном L6. */
function pricePhrase(answers: LadderAnswers): string | null {
  if (answers.L6 === undefined) return null;
  const value = answers.L6;
  const row = rawContent.step2.matrix.find(
    (candidate) =>
      (candidate.first === "*" || candidate.first === answers.L5) &&
      extrasMatch(candidate.firstExtra, answers) &&
      value >= candidate.range.from &&
      value <= candidate.range.to,
  );
  return row?.text ?? null;
}

export function buildStep1Block(answers: LadderAnswers): Block | null {
  const paragraphs = [
    branchText(rawContent.step1.branches, "L1", answers.L1),
    branchText(rawContent.step1.branches, "L2", answers.L2),
    branchText(rawContent.step1.branches, "L3", answers.L3),
  ].filter((text): text is string => Boolean(text));

  if (paragraphs.length < 3) return null;
  return { step: 1, heading: rawContent.step1.heading, paragraphs, highlight: pairPhrase(answers), source: "lookup" };
}

export function buildStep2Block(answers: LadderAnswers): Block | null {
  const paragraphs = [
    branchText(rawContent.step2.branches, "L4", answers.L4),
    branchText(rawContent.step2.branches, "L5", answers.L5),
    scaleText("L6", answers.L6),
    scaleText("L7", answers.L7),
  ].filter((text): text is string => Boolean(text));

  if (paragraphs.length < 4) return null;
  return { step: 2, heading: rawContent.step2.heading, paragraphs, highlight: pricePhrase(answers), source: "lookup" };
}

export function buildStep3Block(profile: Profile): Block | null {
  const dominant = profile.nodes[0];
  return {
    step: 3,
    heading: rawContent.step3.heading,
    paragraphs: [dominant ? dominant.text : fallbackNodeText()],
    highlight: null,
    source: "lookup",
  };
}

/**
 * Ступень 4 текст не собирает: движок готовит вход для LLM по
 * content/step4-open-synthesis.md. Пустой или слишком короткий ответ задания не даёт.
 *
 * Кризисный ответ задания не даёт тоже, и это проверяется здесь, а не у
 * вызывающего: пока задания нет, отправить открытый текст в модель нечем
 * (`content/crisis.md`, `docs/08-legal-safety.md`).
 */
export function buildStep4Task(answers: LadderAnswers, profile: Profile, shownBlocks: Block[]): LlmTask | null {
  const openAnswer = (answers.L12 ?? "").trim();
  if (openAnswer.split(/\s+/).filter(Boolean).length < 15) return null;
  if (crisisBlocks(openAnswer)) return null;

  return {
    prompt: rawContent.step4.prompt,
    input: {
      profile,
      node: profile.nodes[0] ?? null,
      shownBlocks,
      openAnswer,
    },
  };
}

export const step4Heading = (): string => rawContent.step4.heading;

/**
 * Промежуточный блок прикладного среза: текст между первой и второй порцией
 * добора (`content/slices/work.md`, `relationships.md`, раздел «Промежуточный
 * блок после порции 1»).
 *
 * Lookup, как ступени 1–3: пара ответов первой порции → готовый текст. LLM здесь
 * не участвует, потому что по Закону 1 ценность выдаётся раньше, чем запрошен
 * следующий шаг, а ждать генерации между порциями человек не должен.
 *
 * `null` — на вопрос одной из осей ответа ещё нет: блок стоит на ответах, а не
 * на догадках. Отсутствие пары при полных ответах — ошибка контента, и она
 * падает, а не показывает пустое место: матрица покрыта целиком (E5-04).
 */
export function buildSliceInterludeBlock(slice: string, answers: SliceAnswers): InterludeBlock | null {
  const interlude = rawExtraContent.interludes.find((candidate) => candidate.slice === slice);
  if (!interlude) return null;

  const keys = interlude.axes.map((axis) => {
    const value = answers[axis.id];
    return typeof value === "string" && axis.keys.includes(value) ? value : null;
  });
  const [first, second] = keys;
  if (!first || !second) return null;

  const pair = interlude.pairs.find((candidate) => candidate.first === first && candidate.second === second);
  if (!pair) throw new Error(`content/slices/${interlude.file}: нет пары ${first}×${second} промежуточного блока`);

  const questions = new Map(slicePortions(slice).flatMap((portion) => portion.questions.map((question) => [question.id, portion.number])));
  const afterPortion = Math.max(...interlude.axes.map((axis) => questions.get(axis.id) ?? 1));

  return {
    slice,
    afterPortion,
    heading: interlude.heading,
    paragraphs: [pair.text],
    source: "lookup",
  };
}
