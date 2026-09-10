/**
 * Вход на живую страницу, ступень 0.
 *
 * Сначала идея: что это за страница, из чего она состоит, зачем вопросы.
 * Поля имени и даты — второй блок, действие «открыть», а не вся карточка.
 * Имя обязательно, дата рождения — нет. Из даты не делается ни одного вывода
 * о характере: это сказано текстом из реестра, компонент его не сочиняет.
 */

import { h, type VNode } from "../src/dom.js";

export interface IntroLabels {
  title: string;
  lead: string;
  about: string;
  beats: string[];
  startTitle: string;
  legal: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  dateLabel: string;
  dateHint: string;
  submit: string;
  wordmarkSrc: string;
  wordmarkAlt: string;
}

export interface IntroValues {
  name: string;
  birthDate: string;
}

export interface IntroProps {
  labels: IntroLabels;
  values?: Partial<IntroValues>;
  nameError?: string | null;
  disabled?: boolean;
  /** Кнопка неактивна, пока отметка согласия не стоит. Поля при этом живут. */
  submitDisabled?: boolean;
  /** Отметка согласия внутри формы, без модального окна. */
  consent?: VNode;
  /** Набранное поднимается наверх сразу: перерисовка формы иначе его теряет. */
  onInput?: (field: "name" | "birthDate", value: string) => void;
  onSubmit?: (value: { name: string; birthDate: string | null }) => void;
}

const fieldInput =
  (props: IntroProps, field: "name" | "birthDate") =>
  (event: Event): void => {
    const target = event.currentTarget as { value?: unknown } | null;
    props.onInput?.(field, typeof target?.value === "string" ? target.value : "");
  };

export function introPayload(name: string, birthDate: string): { ok: true; name: string; birthDate: string | null } | { ok: false } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false };
  const date = birthDate.trim();
  return { ok: true, name: trimmed, birthDate: date.length === 0 ? null : date };
}

export function renderIntro(props: IntroProps): VNode {
  const name = props.values?.name ?? "";
  const birthDate = props.values?.birthDate ?? "";
  const disabled = props.disabled === true;
  const labels = props.labels;

  return h(
    "form",
    {
      class: "intro",
      "data-screen": "intro",
      onSubmit: (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement | null;
        const named = (key: string): string => {
          const field = form?.elements.namedItem(key);
          return field !== null && field !== undefined && "value" in field ? String(field.value) : "";
        };
        const payload = introPayload(named("name") || name, named("birth") || birthDate);
        if (!payload.ok) return;
        props.onSubmit?.({ name: payload.name, birthDate: payload.birthDate });
      },
    },
    h(
      "header",
      { class: "intro__hero" },
      h("img", {
        class: "intro__logo",
        src: labels.wordmarkSrc,
        alt: labels.wordmarkAlt,
      }),
      h("h1", { class: "intro__title" }, labels.title),
      h("p", { class: "intro__lead" }, labels.lead),
      h("p", { class: "intro__about" }, labels.about),
      labels.beats.length > 0
        ? h(
            "ul",
            { class: "intro__beats" },
            labels.beats.map((beat) => h("li", { class: "intro__beat" }, beat)),
          )
        : null,
    ),
    h(
      "section",
      { class: "intro__start" },
      h("h2", { class: "intro__start-title" }, labels.startTitle),
      h("p", { class: "intro__legal" }, labels.legal),
      h(
        "label",
        { class: "intro__field", for: "name" },
        h("span", { class: "intro__label" }, labels.nameLabel),
        h("input", {
          class: "intro__input",
          id: "name",
          name: "name",
          type: "text",
          autocomplete: "given-name",
          required: true,
          maxlength: 40,
          placeholder: labels.namePlaceholder,
          value: name,
          disabled,
          onInput: fieldInput(props, "name"),
          onChange: fieldInput(props, "name"),
        }),
        props.nameError ? h("p", { class: "intro__error", role: "alert" }, props.nameError) : null,
      ),
      h(
        "details",
        { class: "intro__optional" },
        h("summary", { class: "intro__optional-summary" }, labels.dateLabel),
        h(
          "label",
          { class: "intro__field", for: "birth" },
          h("input", {
            class: "intro__input",
            id: "birth",
            name: "birth",
            type: "date",
            autocomplete: "bday",
            "aria-label": labels.dateLabel,
            value: birthDate,
            disabled,
            onInput: fieldInput(props, "birthDate"),
            onChange: fieldInput(props, "birthDate"),
          }),
          h("p", { class: "intro__hint" }, labels.dateHint),
        ),
      ),
      props.consent ?? null,
      h("button", { class: "intro__submit", type: "submit", disabled: disabled || props.submitDisabled === true }, labels.submit),
    ),
  );
}
