/**
 * Наборы ответов для тестов доборов: демо-человек из examples/demo-person-answers.md
 * плюс по одному подготовленному набору на каждый срез. Не часть движка —
 * общие данные для `slices.test.ts` и `slice-thresholds.test.ts`.
 */

import { applyNodes } from "./nodes.js";
import { buildProfile } from "./scoring.js";
import type { LadderAnswers, Profile, SliceAnswers } from "./types.js";

const LADDER: LadderAnswers = {
  L1: "B",
  L2: "C",
  L3: "A",
  L4: "B",
  L5: "D",
  L6: 5,
  L7: 2,
  L8: "A",
  L9: 5,
  L10: 4,
  L11: 4,
  L12: "Беру на себя больше, чем могу вынести. Сначала загораюсь, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша.",
};

/** Текст нужной длины: пороги считают слова, а не смысл. */
export const textLonger = (count: number): string =>
  Array.from({ length: count }, (_value, index) => `слово${index + 1}`).join(" ");

/**
 * Профиль демо-человека после бесплатной лестницы. Сюжет координаты 15 приходит
 * синтезом ступени 4 — без него прикладные срезы не проходят порог.
 */
export const demoProfile = (): Profile => {
  const profile = buildProfile(LADDER, {
    storyline: { value: "берёт на себя больше, чем выносит, и бросает у финиша", code: "overload_then_drop", confidence: "medium" },
  });
  return applyNodes(profile, LADDER);
};

const ANSWERS: Record<string, SliceAnswers> = {
  slice_node_finish: {
    S1: "A",
    S2: "A",
    S3: "C",
    S4: 4,
    S5: "B",
    S6: "B",
    S7: "A",
    S8: textLonger(20),
    S9: "A",
    S10: "C",
  },
  slice_motivation: {
    S1: "A",
    S2: 5,
    S3: "A",
    S4: "B",
    S5: [4, 1],
    S6: "D",
    S7: "A",
    S8: textLonger(20),
    S9: textLonger(12),
  },
  slice_stress: {
    S1: "A",
    S2: "A",
    S3: "D",
    S4: 4,
    S5: 2,
    S6: "F",
    S7: "D",
    S8: textLonger(14),
    S9: textLonger(14),
  },
  slice_reactivity: {
    S1: textLonger(25),
    S2: "A",
    S3: "D",
    S4: "A",
    S5: "D",
    S6: 4,
    S7: "C",
    S8: "A",
    S9: textLonger(10),
  },
  slice_decisions: {
    S1: "A",
    S2: "A",
    S3: "A",
    S4: 4,
    S5: "C",
    S6: "B",
    S7: textLonger(20),
    S8: "A",
    S9: textLonger(10),
    S10: textLonger(10),
  },
  slice_work: {
    S1: "C",
    S2: "B",
    S3: "A",
    S4: "A",
    S5: "C",
    S6: "D",
    S7: "B",
    S8: "A",
    S9: textLonger(15),
    S10: [45, 10],
    S11: "C",
    S12: "A",
    S13: 2,
    S14: textLonger(15),
    S15: "D",
    S16: textLonger(12),
    S17: "D",
    S18: "A",
    S19: "B",
    S20: textLonger(15),
  },
  slice_relationships: {
    S1: "B",
    S2: "A",
    S3: "C",
    S4: "D",
    S5: "B",
    S6: "B",
    S7: "A",
    S8: 4,
    S9: "E",
    S10: 2,
    S11: textLonger(25),
    S12: "C",
    S13: "C",
    S14: "A",
    S15: "D",
    S16: 2,
    S17: textLonger(10),
    S18: [5, 1],
    S19: textLonger(12),
    S20: textLonger(12),
  },
  slice_decision_moment: {
    entry: textLonger(90),
    S1: textLonger(15),
    S2: "D",
    S3: textLonger(15),
    S4: "C",
    S5: textLonger(15),
    S6: "D",
    S7: textLonger(15),
    S8: textLonger(15),
  },
};

/** Подготовленный набор ответов на добор среза. */
export const sliceAnswers = (slice: string): SliceAnswers => {
  const answers = ANSWERS[slice];
  if (!answers) throw new Error(`Для среза ${slice} нет набора ответов в тестовых данных`);
  return { ...answers };
};
