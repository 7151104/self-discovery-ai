/**
 * Сбор контакта после первой порции. Не вход: ценность уже получена, пропуск
 * всегда возможен. Компонент текстов не знает.
 */

import { h, type VNode } from "../src/dom.js";

export interface ContactLabels {
  title: string;
  lead: string;
  emailLabel: string;
  emailPlaceholder: string;
  channelLabel: string;
  channelHint: string;
  submit: string;
  skip: string;
  error: string;
}

export interface ContactValues {
  email: string;
  channel: string;
}

export interface ContactProps {
  labels: ContactLabels;
  values?: Partial<ContactValues>;
  error?: string | null;
  disabled?: boolean;
  onInput?: (field: "email" | "channel", value: string) => void;
  onSubmit?: (value: { email: string; channel: string }) => void;
  onSkip?: () => void;
}

const fieldInput =
  (props: ContactProps, field: "email" | "channel") =>
  (event: Event): void => {
    const target = event.currentTarget as { value?: unknown } | null;
    props.onInput?.(field, typeof target?.value === "string" ? target.value : "");
  };

export function contactPayload(
  email: string,
  channel: string,
): { ok: true; email: string; channel: string } | { ok: false } {
  const trimmedEmail = email.trim();
  const trimmedChannel = channel.trim();
  if (trimmedEmail.length === 0 && trimmedChannel.length === 0) return { ok: false };
  return { ok: true, email: trimmedEmail, channel: trimmedChannel };
}

export function renderContactCard(props: ContactProps): VNode {
  const email = props.values?.email ?? "";
  const channel = props.values?.channel ?? "";
  const disabled = props.disabled === true;
  const labels = props.labels;

  return h(
    "form",
    {
      class: "contact",
      "data-screen": "contact",
      onSubmit: (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement | null;
        const named = (key: string): string => {
          const field = form?.elements.namedItem(key);
          return field !== null && field !== undefined && "value" in field ? String(field.value) : "";
        };
        const payload = contactPayload(named("email") || email, named("channel") || channel);
        if (!payload.ok) return;
        props.onSubmit?.({ email: payload.email, channel: payload.channel });
      },
    },
    h("h2", { class: "contact__title" }, labels.title),
    h("p", { class: "contact__lead" }, labels.lead),
    h(
      "label",
      { class: "contact__field", for: "contact-email" },
      h("span", { class: "contact__label" }, labels.emailLabel),
      h("input", {
        class: "contact__input",
        id: "contact-email",
        name: "email",
        type: "email",
        autocomplete: "email",
        inputmode: "email",
        placeholder: labels.emailPlaceholder,
        value: email,
        disabled,
        onInput: fieldInput(props, "email"),
      }),
    ),
    h(
      "label",
      { class: "contact__field", for: "contact-channel" },
      h("span", { class: "contact__label" }, labels.channelLabel),
      h("input", {
        class: "contact__input",
        id: "contact-channel",
        name: "channel",
        type: "text",
        autocomplete: "tel",
        placeholder: labels.channelLabel,
        value: channel,
        disabled,
        onInput: fieldInput(props, "channel"),
      }),
      h("p", { class: "contact__hint" }, labels.channelHint),
    ),
    props.error ? h("p", { class: "contact__error", role: "alert" }, props.error) : null,
    h(
      "div",
      { class: "contact__actions" },
      h("button", { class: "contact__submit", type: "submit", disabled }, labels.submit),
      h(
        "button",
        {
          class: "contact__skip",
          type: "button",
          disabled,
          onClick: () => props.onSkip?.(),
        },
        labels.skip,
      ),
    ),
  );
}
