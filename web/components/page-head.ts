/**
 * Шапка страницы и фраза-крючок.
 *
 * Крючок — отдельный экранный блок с воздухом: он читается без контекста и
 * именно его скриншотят (`docs/11-ui-page-spec.md`, «Виральность»). Поэтому
 * у него собственный размер в шкале и собственная длина строки.
 *
 * Без даты рождения тема периода не приходит — шапка остаётся с одним именем.
 * После первой порции шапка показывает, что страница живёт по ссылке.
 */

import { h, type VNode } from "../src/dom.js";
import type { CardDto } from "../src/contract.js";

export interface HeadExtras {
  /** Подпись постоянной ссылки. Нет — ссылку не показываем. */
  linkHint?: string | null;
  /** Адрес постоянной ссылки. Живёт в href, не в тексте. */
  linkHref?: string | null;
  /** Знак продукта над именем. Нет — шапка только про человека. */
  brand?: { src: string; alt: string } | null;
  laterContact?: { label: string; onSelect: () => void } | null;
}

export function renderHead(card: CardDto, extras: HeadExtras = {}): VNode {
  return h(
    "header",
    { class: "head" },
    extras.brand
      ? h(
          "p",
          { class: "head__brand" },
          h("img", { class: "head__logo", src: extras.brand.src, alt: extras.brand.alt }),
        )
      : null,
    h("h1", { class: "head__name" }, card.name),
    card.theme ? h("p", { class: "head__theme" }, card.theme) : null,
    card.metaphor ? h("p", { class: "head__metaphor" }, card.metaphor) : null,
    extras.linkHint && extras.linkHref
      ? h("a", { class: "head__link", href: extras.linkHref }, extras.linkHint)
      : extras.linkHint
        ? h("p", { class: "head__link" }, extras.linkHint)
        : null,
    extras.laterContact
      ? h(
          "button",
          { class: "head__later", type: "button", onClick: extras.laterContact.onSelect },
          extras.laterContact.label,
        )
      : null,
  );
}

export function renderHook(text: string, options: { empty?: boolean } = {}): VNode {
  return h("p", { class: "hook", "data-empty": options.empty === true ? "true" : "false" }, text);
}
