/**
 * Карточка входа, ступень 0.
 *
 * Имя обязательно, дата рождения — нет. Из даты не делается ни одного вывода
 * о характере: это сказано текстом из реестра, компонент его не сочиняет.
 */

import { h, type VNode } from "../src/dom.js";

export interface IntroLabels {
  title: string;
  about: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  dateLabel: string;
  dateHint: string;
  submit: string;
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
  onSubmit?: (value: { name: string; birthDate: string | null }) => void;
}

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
    h("h1", { class: "intro__title" }, props.labels.title),
    h("p", { class: "intro__about" }, props.labels.about),
    h(
      "label",
      { class: "intro__field", for: "name" },
      h("span", { class: "intro__label" }, props.labels.nameLabel),
      h("input", {
        class: "intro__input",
        id: "name",
        name: "name",
        type: "text",
        autocomplete: "given-name",
        required: true,
        maxlength: 40,
        placeholder: props.labels.namePlaceholder,
        value: name,
        disabled,
      }),
      props.nameError ? h("p", { class: "intro__error", role: "alert" }, props.nameError) : null,
    ),
    h(
      "label",
      { class: "intro__field", for: "birth" },
      h("span", { class: "intro__label" }, props.labels.dateLabel),
      h("input", {
        class: "intro__input",
        id: "birth",
        name: "birth",
        type: "date",
        autocomplete: "bday",
        value: birthDate,
        disabled,
      }),
      h("p", { class: "intro__hint" }, props.labels.dateHint),
    ),
    props.consent ?? null,
    h("button", { class: "intro__submit", type: "submit", disabled: disabled || props.submitDisabled === true }, props.labels.submit),
  );
}
