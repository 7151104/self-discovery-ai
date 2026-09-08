/**
 * Шкала из пяти отметок с подписями полюсов (E6-05).
 *
 * Чисел в интерфейсе нет: человек выбирает положение между двумя
 * формулировками, а не оценку (`docs/11-ui-page-spec.md`). Для скринридера
 * каждая отметка имеет собственное имя — иначе это набор безымянных точек.
 *
 * Продуктовых строк здесь нет: подписи полюсов и имена отметок приходят
 * параметрами из контента.
 */

import { h, type Handler, type VNode } from "../src/dom.js";

/** Значения совпадают с `AnswerInput` типа «шкала» в контракте сервера. */
export const SCALE_VALUES = [1, 2, 3, 4, 5] as const;
export type ScaleValue = (typeof SCALE_VALUES)[number];

export interface ScaleProps {
  group: string;
  /** Текст вопроса: имя всей группы. */
  label: string;
  poles: { low: string; high: string };
  /** Имя каждой из пяти отметок для скринридера, слева направо. */
  markLabels: readonly [string, string, string, string, string];
  value?: ScaleValue | null;
  disabled?: boolean;
  onSelect?: Handler;
}

export function renderScale(props: ScaleProps): VNode {
  const disabled = props.disabled === true;
  return h(
    "fieldset",
    {
      class: "scale",
      role: "radiogroup",
      "data-state": disabled ? "disabled" : "rest",
      disabled,
    },
    h("legend", { class: "scale__question" }, props.label),
    h(
      "div",
      { class: "scale__marks" },
      SCALE_VALUES.map((value, index) => {
        const id = `${props.group}-${value}`;
        const selected = props.value === value;
        return h(
          "label",
          { class: "scale__mark", for: id, "data-state": disabled ? "disabled" : selected ? "selected" : "rest" },
          h("input", {
            class: "scale__input",
            type: "radio",
            id,
            name: props.group,
            value: String(value),
            "aria-label": props.markLabels[index],
            checked: selected,
            disabled,
            onChange: props.onSelect,
          }),
          h("span", { class: "scale__dot", "aria-hidden": "true" }),
        );
      }),
    ),
    h(
      "div",
      { class: "scale__poles" },
      h("span", { class: "scale__pole" }, props.poles.low),
      h("span", { class: "scale__pole" }, props.poles.high),
    ),
  );
}
