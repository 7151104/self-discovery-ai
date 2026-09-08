/**
 * Визуальная карта: 7 полос из 16 координат.
 *
 * Состав и подписи — docs/11-ui-page-spec.md, раздел «Визуальная карта».
 * Тест в `content.test.ts` сверяет этот список с таблицей в документе.
 * Наружу не выходят ни числа, ни названия координат, ни методики.
 */

import { rawContent } from "./generated/content.js";
import type { Band, LadderAnswers, MapBar, Profile } from "./types.js";

interface BarDefinition {
  coordinate: number;
  label: string;
  poles: { low: string; high: string } | null;
  /** true — высокая полоса координаты рисуется слева. */
  invert: boolean;
  /** Что нужно ответить, чтобы полоса открылась. */
  hint: string;
}

export const BAR_DEFINITIONS: BarDefinition[] = [
  { coordinate: 2, label: "Темп", poles: { low: "ровный поток", high: "импульсы" }, invert: false, hint: "Откроется на первых трёх вопросах" },
  { coordinate: 11, label: "Доведение", poles: { low: "до конца", high: "обрыв" }, invert: false, hint: "Откроется на первых трёх вопросах" },
  { coordinate: 9, label: "Под давлением", poles: { low: "замирание", high: "ускорение" }, invert: false, hint: "Откроется на первых трёх вопросах" },
  { coordinate: 8, label: "Что задевает", poles: null, invert: false, hint: "Откроется на вопросах про то, что задевает" },
  { coordinate: 3, label: "Внимание", poles: { low: "конкретика", high: "связи" }, invert: false, hint: "Откроется на вопросах про то, как ты обрабатываешь" },
  { coordinate: 5, label: "Структура", poles: { low: "определённость", high: "открытый финал" }, invert: true, hint: "Откроется на вопросах про планы и решения" },
  { coordinate: 7, label: "Удержание", poles: { low: "отпускает", high: "держит долго" }, invert: false, hint: "Откроется на вопросах про то, как тебя задевает" },
];

const POSITION: Record<Band, number> = { low: 0.08, "mid-low": 0.3, mid: 0.5, "mid-high": 0.72, high: 0.92 };

const vulnerabilityOptions = (): { key: string; text: string }[] =>
  rawContent.questions.find((question) => question.id === "L8")?.options ?? [];

export function buildMap(profile: Profile, answers: LadderAnswers): MapBar[] {
  return BAR_DEFINITIONS.map((definition) => {
    const coordinate = profile.coordinates[definition.coordinate];
    const known = Boolean(coordinate && coordinate.sources.length);

    if (!coordinate || !known) {
      return {
        coordinate: definition.coordinate,
        label: definition.label,
        poles: definition.poles,
        state: "empty" as const,
        position: null,
        category: definition.poles ? null : { options: vulnerabilityOptions().map((option) => option.text), selected: null },
        hint: definition.hint,
      };
    }

    const raw = coordinate.band ? POSITION[coordinate.band] : null;
    const position = raw === null ? null : definition.invert ? Number((1 - raw).toFixed(2)) : raw;

    const category = definition.poles
      ? null
      : {
          options: vulnerabilityOptions().map((option) => option.text),
          selected: vulnerabilityOptions().find((option) => option.key === answers.L8)?.text ?? null,
        };

    return {
      coordinate: definition.coordinate,
      label: definition.label,
      poles: definition.poles,
      state: coordinate.confidence === "high" ? ("precise" as const) : ("approximate" as const),
      position,
      category,
      hint: coordinate.confidence === "high" ? "Точно" : "Пока предположение",
    };
  });
}
