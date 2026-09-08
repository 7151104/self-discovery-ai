/**
 * Открытое поле (E6-05) — вопрос L12.
 *
 * Два порога из `docs/11-ui-page-spec.md`: счётчик слов появляется после пяти
 * слов, кнопка включается от пятнадцати. Подсказка не исчезает при фокусе:
 * человеку объясняют, чего не хватает, пока он пишет, а не после отправки.
 *
 * Пороги живут здесь, а не у вызывающего кода: иначе они разъедутся между
 * страницей и витриной. Тексты приходят параметрами.
 */

import { h, type Handler, type VNode } from "../src/dom.js";

/** Счётчик слов появляется, начиная с этого числа. */
export const COUNTER_FROM_WORDS = 5;

/** Кнопка включается, начиная с этого числа (порог движка для ступени 4). */
export const SUBMIT_FROM_WORDS = 15;

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  return words.length;
}

export interface OpenFieldState {
  words: number;
  counterVisible: boolean;
  submitEnabled: boolean;
}

export function openFieldState(text: string): OpenFieldState {
  const words = countWords(text);
  return {
    words,
    counterVisible: words >= COUNTER_FROM_WORDS,
    submitEnabled: words >= SUBMIT_FROM_WORDS,
  };
}

export interface OpenFieldProps {
  id: string;
  /** Текст вопроса. */
  label: string;
  /** Подсказка, которая не исчезает при фокусе. */
  hint: string;
  value: string;
  submitLabel: string;
  /** Текст счётчика по числу слов: формулировка живёт в контенте. */
  counterText: (state: OpenFieldState) => string;
  disabled?: boolean;
  onInput?: Handler;
  onSubmit?: Handler;
}

export function renderOpenField(props: OpenFieldProps): VNode {
  const state = openFieldState(props.value);
  const disabled = props.disabled === true;
  const hintId = `${props.id}-hint`;
  const counterId = `${props.id}-counter`;

  return h(
    "div",
    { class: "field", "data-state": disabled ? "disabled" : state.submitEnabled ? "ready" : "short" },
    h("label", { class: "field__label", for: props.id }, props.label),
    h("textarea", {
      class: "field__input",
      id: props.id,
      rows: 6,
      "aria-describedby": state.counterVisible ? `${hintId} ${counterId}` : hintId,
      disabled,
      onInput: props.onInput,
    }, props.value),
    h("p", { class: "field__hint", id: hintId }, props.hint),
    h(
      "div",
      { class: "field__foot" },
      h(
        "p",
        { class: "field__counter", id: counterId, role: "status", "aria-live": "polite", hidden: !state.counterVisible },
        state.counterVisible ? props.counterText(state) : "",
      ),
      h(
        "button",
        {
          class: "field__submit",
          type: "button",
          disabled: disabled || !state.submitEnabled,
          onClick: props.onSubmit,
        },
        props.submitLabel,
      ),
    ),
  );
}
