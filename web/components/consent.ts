/**
 * Отметка согласия в потоке (E9-01).
 *
 * Не модальное окно: стоит в карточке входа, чекбокс не предзажат.
 * Тексты приходят параметрами — формулировки живут в `content/legal/consent.md`.
 */

import { h, type Child, type VNode } from "../src/dom.js";

export interface ConsentPart {
  text: string;
  href?: string;
}

export interface ConsentProps {
  title: string;
  body: string;
  mark: ConsentPart[];
  refuse: ConsentPart[];
  checked: boolean;
  onChange?: (checked: boolean) => void;
}

const marked = (parts: ConsentPart[], className: string): Child[] =>
  parts.map((part) =>
    part.href === undefined
      ? part.text
      : h("a", { class: className, href: part.href }, part.text),
  );

export function renderConsent(props: ConsentProps): VNode {
  return h(
    "fieldset",
    { class: "consent", "data-consent": props.checked ? "on" : "off" },
    h("legend", { class: "consent__title" }, props.title),
    h("p", { class: "consent__body" }, props.body),
    h(
      "label",
      { class: "consent__mark", for: "consent" },
      h("input", {
        class: "consent__input",
        id: "consent",
        name: "consent",
        type: "checkbox",
        checked: props.checked,
        required: true,
        onChange: (event: Event) => {
          const target = event.currentTarget as { checked?: boolean } | null;
          props.onChange?.(target?.checked === true);
        },
      }),
      h("span", { class: "consent__text" }, ...marked(props.mark, "consent__link")),
    ),
    h("p", { class: "consent__refuse" }, ...marked(props.refuse, "consent__link")),
  );
}
