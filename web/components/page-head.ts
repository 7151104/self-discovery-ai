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
}

export function renderHead(card: CardDto, extras: HeadExtras = {}): VNode {
  return h(
    "header",
    { class: "head" },
    h("h1", { class: "head__name" }, card.name),
    card.theme ? h("p", { class: "head__theme" }, card.theme) : null,
    card.metaphor ? h("p", { class: "head__metaphor" }, card.metaphor) : null,
    extras.linkHint ? h("p", { class: "head__link" }, extras.linkHint) : null,
  );
}

export function renderHook(text: string, options: { empty?: boolean } = {}): VNode {
  return h("p", { class: "hook", "data-empty": options.empty === true ? "true" : "false" }, text);
}
