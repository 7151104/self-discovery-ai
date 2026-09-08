/**
 * Вариант ответа (E6-05).
 *
 * Один вариант — одна строка полным текстом: список коротких ярлыков
 * («да / нет / иногда») не годится, человек выбирает формулировку, а не балл.
 * Выбор варианта и есть переход дальше, кнопки «Далее» у типа «выбор» нет
 * (`docs/11-ui-page-spec.md`).
 *
 * Продуктовых строк здесь нет: весь текст приходит параметрами.
 */

import { h, type Handler, type VNode } from "../src/dom.js";

export type OptionState = "rest" | "selected" | "disabled";

export interface OptionProps {
  /** Имя группы: все варианты одного вопроса делят его. */
  group: string;
  /** Машинный ключ варианта из контента. */
  value: string;
  text: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: Handler;
}

export const optionState = (props: OptionProps): OptionState =>
  props.disabled ? "disabled" : props.selected ? "selected" : "rest";

export function renderOption(props: OptionProps): VNode {
  const id = `${props.group}-${props.value}`;
  return h(
    "label",
    { class: "option", for: id, "data-state": optionState(props) },
    h("input", {
      class: "option__input",
      type: "radio",
      id,
      name: props.group,
      value: props.value,
      checked: props.selected === true,
      disabled: props.disabled === true,
      onChange: props.onSelect,
    }),
    h("span", { class: "option__mark", "aria-hidden": "true" }),
    h("span", { class: "option__text" }, props.text),
  );
}

export interface OptionsProps {
  group: string;
  /** Текст вопроса: он же имя группы для скринридера. */
  label: string;
  options: { value: string; text: string }[];
  selected?: string | null;
  disabled?: boolean;
  onSelect?: Handler;
}

/** Список вариантов одного вопроса — группа радиокнопок с именем. */
export function renderOptions(props: OptionsProps): VNode {
  return h(
    "div",
    { class: "options", role: "radiogroup", "aria-label": props.label },
    props.options.map((option) =>
      renderOption({
        group: props.group,
        value: option.value,
        text: option.text,
        selected: option.value === (props.selected ?? null),
        disabled: props.disabled === true,
        onSelect: props.onSelect,
      }),
    ),
  );
}
