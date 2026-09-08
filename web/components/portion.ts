/**
 * Порция вопросов (E6-12).
 *
 * Не страница опросника, а карточка внизу заполненной части: человек всё
 * время остаётся на своей странице (`docs/11-ui-page-spec.md`).
 *
 * Правила, закреплённые здесь:
 *   — один вопрос на экране, а не список из четырёх;
 *   — прогресс только внутри порции; общее число вопросов не заявляется,
 *     потому что лестница не тест;
 *   — у типа «выбор» кнопки «дальше» нет: выбор и есть переход;
 *   — «назад» доступно везде, кроме первого вопроса порции.
 *
 * Тексты приходят параметрами, как и у остальных компонентов.
 */

import { h, type Handler, type VNode } from "../src/dom.js";
import type { QuestionDto } from "../src/contract.js";
import { renderOpenField, type OpenFieldState } from "./open-field.js";
import { renderOptions } from "./option.js";
import { renderScale } from "./scale.js";

export interface PortionLabels {
  /** Подводка порции. Приходит из контента вместе с самой порцией. */
  lead: string;
  /** Подпись прогресса для скринридера: «вопрос такой-то из такого-то». */
  progress: string;
  back: string | null;
  /** Подписи отметок шкалы: пять штук, по одной на отметку. */
  scaleMarks: [string, string, string, string, string];
  scaleHint: string;
  openHint: string;
  openSubmit: string;
  counterText: (state: OpenFieldState) => string;
}

export interface PortionProps {
  /** Ключ порции: машинный, человеку не показывается. */
  id: string;
  question: QuestionDto;
  /** Номер вопроса внутри порции, с нуля. */
  index: number;
  total: number;
  labels: PortionLabels;
  value?: string | null;
  disabled?: boolean;
  onAnswer?: Handler;
  onBack?: Handler;
  onSubmit?: Handler;
}

/** Точки прогресса. Числа рядом с ними не печатаются — только для скринридера. */
const renderProgress = (props: PortionProps): VNode =>
  h(
    "p",
    { class: "portion__progress", role: "status", "aria-label": props.labels.progress },
    Array.from({ length: props.total }, (_, place) =>
      h("span", {
        class: "portion__dot",
        "aria-hidden": "true",
        "data-state": place < props.index ? "done" : place === props.index ? "current" : "rest",
      }),
    ),
  );

/** Ответ на шкалу приходит из хранилища как строка или число: отметок ровно пять. */
const scaleValue = (value: PortionProps["value"]): 1 | 2 | 3 | 4 | 5 | undefined => {
  const mark = value === null || value === undefined ? NaN : Number(value);
  return mark === 1 || mark === 2 || mark === 3 || mark === 4 || mark === 5 ? mark : undefined;
};

function renderQuestion(props: PortionProps): VNode {
  const { question, labels } = props;

  if (question.kind === "шкала") {
    return renderScale({
      group: question.id,
      label: question.text,
      poles: question.scale ?? { low: "", high: "" },
      markLabels: labels.scaleMarks,
      hint: labels.scaleHint,
      value: scaleValue(props.value),
      disabled: props.disabled === true,
      onSelect: props.onAnswer,
    });
  }

  if (question.kind === "открытый") {
    return renderOpenField({
      id: question.id,
      label: question.text,
      hint: labels.openHint,
      value: props.value ?? "",
      submitLabel: labels.openSubmit,
      counterText: labels.counterText,
      disabled: props.disabled === true,
      onInput: props.onAnswer,
      onSubmit: props.onSubmit,
    });
  }

  return renderOptions({
    group: question.id,
    label: question.text,
    options: question.options.map((option) => ({ value: option.key, text: option.text })),
    selected: props.value ?? null,
    disabled: props.disabled === true,
    onSelect: props.onAnswer,
  });
}

export function renderPortion(props: PortionProps): VNode {
  return h(
    "section",
    { class: "portion", "data-portion": props.id, "data-kind": props.question.kind === "открытый" ? "open" : "closed" },
    h("p", { class: "portion__lead" }, props.labels.lead),
    renderProgress(props),
    renderQuestion(props),
    props.index > 0 && props.labels.back !== null
      ? h("button", { class: "portion__back", type: "button", onClick: props.onBack }, props.labels.back)
      : null,
  );
}
