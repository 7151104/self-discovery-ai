/**
 * Дисклеймеры продукта (E9-05). Текст приходит из `content/legal/disclaimers.md`.
 *
 * Незаполненная подстановка остаётся подстановкой: компонент её не выдумывает
 * и помечает так, чтобы было видно, что значение не заполнено.
 */

import { h, type Child, type VNode } from "../src/dom.js";

export interface DisclaimerItem {
  id: string;
  text: string;
}

export interface DisclaimerProps {
  items: DisclaimerItem[];
  unfilledLabel: string;
}

const SUBSTITUTION = /\{\{([А-ЯЁA-Z_]+)\}\}/g;

function marked(text: string, unfilledLabel: string): Child[] {
  const parts: Child[] = [];
  let cursor = 0;
  for (const match of text.matchAll(SUBSTITUTION)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));
    const name = match[1] ?? "";
    parts.push(
      h(
        "span",
        { class: "legal-unfilled", "data-unfilled": name, title: unfilledLabel },
        `{{${name}}}`,
      ),
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : [text];
}

export function renderDisclaimerList(props: DisclaimerProps): VNode | null {
  if (props.items.length === 0) return null;
  return h(
    "aside",
    { class: "disclaimer-list" },
    ...props.items.map((item) =>
      h("p", { class: "disclaimer", "data-disclaimer": item.id }, ...marked(item.text, props.unfilledLabel)),
    ),
  );
}
