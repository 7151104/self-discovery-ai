/**
 * Шапка страницы и фраза-крючок.
 *
 * Крючок — отдельный экранный блок с воздухом: он читается без контекста и
 * именно его скриншотят (`docs/11-ui-page-spec.md`, «Виральность»). Поэтому
 * у него собственный размер в шкале и собственная длина строки.
 *
 * Без даты рождения тема периода не приходит — шапка остаётся с одним именем.
 */

import { h, type VNode } from "../src/dom.js";
import type { CardDto } from "../src/contract.js";

export function renderHead(card: CardDto): VNode {
  return h(
    "header",
    { class: "head" },
    h("h1", { class: "head__name" }, card.name),
    card.theme ? h("p", { class: "head__theme" }, card.theme) : null,
    card.metaphor ? h("p", { class: "head__metaphor" }, card.metaphor) : null,
  );
}

export function renderHook(text: string): VNode {
  return h("p", { class: "hook" }, text);
}
