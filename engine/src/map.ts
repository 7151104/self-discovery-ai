/**
 * Визуальная карта: 7 полос из 16 координат.
 *
 * Состав и подписи — docs/11-ui-page-spec.md, раздел «Визуальная карта».
 * Тест в `content.test.ts` сверяет этот список с таблицей в документе.
 * Наружу не выходят ни числа, ни названия координат, ни методики.
 */

import { rawContent } from "./generated/content.js";
import { barCopy, uiCopy } from "./ui-copy.js";
import type { Band, LadderAnswers, MapBar, Profile } from "./types.js";

interface BarDefinition {
  /** Устойчивый ключ полосы: им её опознаёт клиент вместо номера координаты. */
  key: string;
  /** Внутреннее: какая координата питает полосу. Наружу не выходит. */
  coordinate: number;
  label: string;
  poles: { low: string; high: string } | null;
  /** true — высокая полоса координаты рисуется слева. */
  invert: boolean;
  /** Что нужно ответить, чтобы полоса открылась. */
  hint: string;
}

/** Состав полос — код, подписи — реестр микрокопии (`content/ui-copy.md`). */
const bar = (key: string, coordinate: number, invert = false): BarDefinition => {
  const copy = barCopy(coordinate);
  return { key, coordinate, label: copy.label, poles: copy.poles, invert, hint: copy.empty };
};

export const BAR_DEFINITIONS: BarDefinition[] = [
  bar("tempo", 2),
  bar("completion", 11),
  bar("pressure", 9),
  bar("trigger", 8),
  bar("attention", 3),
  bar("structure", 5, true),
  bar("holding", 7),
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
        key: definition.key,
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
      key: definition.key,
      label: definition.label,
      poles: definition.poles,
      state: coordinate.confidence === "high" ? ("precise" as const) : ("approximate" as const),
      position,
      category,
      hint: uiCopy(coordinate.confidence === "high" ? "UI_MAP_HINT_PRECISE" : "UI_MAP_HINT_APPROXIMATE"),
    };
  });
}
