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
 *   — «назад» доступно везде, кроме первого вопроса порции;
 *   — тип «число» бывает с одной величиной и с двумя: подписи полей
 *     приходят в `options` вопроса, пока контракт не несёт их отдельно.
 *
 * Тексты приходят параметрами, как и у остальных компонентов.
 */

import { h, type Handler, type VNode } from "../src/dom.js";
import type { QuestionDto, QuestionKind } from "../src/contract.js";
import { renderOpenField, type OpenFieldState } from "./open-field.js";
import { renderOptions } from "./option.js";
import { renderScale } from "./scale.js";

/** Машинный ключ типа для атрибута: в разметке не кириллица. */
export const PORTION_KIND: Record<QuestionKind, string> = {
  выбор: "choice",
  шкала: "scale",
  открытый: "open",
  число: "number",
};

export interface PortionLabels {
  /** Имя раздела: вопросы живут на этой странице, а не уводят в сторону. */
  title?: string | null;
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
  /** Порог кнопки открытого ответа. Нет — порог лестницы. */
  submitFromWords?: number;
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

/**
 * Поля числового вопроса. Две величины — два поля; подписи берутся из
 * `options`, если сервер их прислал, иначе одно поле с текстом вопроса.
 */
export function numberFields(question: QuestionDto): { key: string; label: string }[] {
  if (question.options.length > 0) {
    return question.options.map((option) => ({ key: option.key, label: option.text }));
  }
  return [{ key: question.id, label: question.text }];
}

/** Ответ типа «число»: одно значение или несколько через запятую, как на сервере. */
const numberValues = (value: PortionProps["value"], count: number): string[] => {
  const parts = (value ?? "").split(",").map((part) => part.trim());
  return Array.from({ length: count }, (_, index) => parts[index] ?? "");
};

const numberFilled = (parts: string[]): boolean =>
  parts.every((part) => part.trim() !== "" && Number.isFinite(Number(part.replace(",", ".").trim())));

function renderNumber(props: PortionProps): VNode {
  const fields = numberFields(props.question);
  const values = numberValues(props.value, fields.length);
  const disabled = props.disabled === true;
  const ready = numberFilled(values);

  return h(
    "div",
    { class: "portion__number", role: "group", "aria-label": props.question.text },
    h("p", { class: "portion__question" }, props.question.text),
    fields.map((field, index) => {
      const id = `${props.question.id}-${field.key}`;
      return h(
        "label",
        { class: "portion__number-field", for: id },
        h("span", { class: "portion__number-label" }, field.label),
        h("input", {
          class: "portion__number-input",
          type: "text",
          inputmode: "numeric",
          id,
          name: id,
          value: values[index],
          disabled,
          onInput: (event) => {
            const target = event.target as { value?: unknown } | null;
            const value = target && typeof target.value === "string" ? target.value : "";
            const next = [...values];
            next[index] = value;
            props.onAnswer?.({
              ...event,
              target: { ...(typeof target === "object" && target !== null ? target : {}), value: next.join(",") },
            } as unknown as Event);
          },
        }),
      );
    }),
    h(
      "button",
      {
        class: "portion__submit",
        type: "button",
        disabled: disabled || !ready,
        onClick: props.onSubmit,
      },
      props.labels.openSubmit,
    ),
  );
}

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
      submitFromWords: labels.submitFromWords,
    });
  }

  if (question.kind === "число") {
    return renderNumber(props);
  }

  return h(
    "div",
    { class: "portion__choice" },
    h("p", { class: "portion__question" }, question.text),
    renderOptions({
      group: question.id,
      label: question.text,
      options: question.options.map((option) => ({ value: option.key, text: option.text })),
      selected: props.value ?? null,
      disabled: props.disabled === true,
      onSelect: props.onAnswer,
    }),
  );
}

export function renderPortion(props: PortionProps): VNode {
  return h(
    "section",
    {
      class: "portion",
      "data-portion": props.id,
      "data-kind": PORTION_KIND[props.question.kind],
      "data-index": String(props.index),
      "data-total": String(props.total),
    },
    props.labels.title ? h("h2", { class: "section-title" }, props.labels.title) : null,
    h("p", { class: "portion__lead" }, props.labels.lead),
    renderProgress(props),
    renderQuestion(props),
    props.index > 0 && props.labels.back !== null
      ? h("button", { class: "portion__back", type: "button", onClick: props.onBack }, props.labels.back)
      : null,
  );
}
