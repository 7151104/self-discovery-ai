/**
 * Понятная страница, когда профиля нет. Без кодов отказа, стека и «404»:
 * человек видит, что ссылка не открывается, и может сделать свою.
 */

import { h, type Handler, type VNode } from "../src/dom.js";

export interface MissingLabels {
  title: string;
  text: string;
  action: string;
}

export function renderMissing(labels: MissingLabels, onOwn?: Handler): VNode {
  return h(
    "div",
    { class: "missing", "data-screen": "missing", "data-error": "missing" },
    h("h1", { class: "missing__title" }, labels.title),
    h("p", { class: "missing__text" }, labels.text),
    h("button", { class: "missing__action", type: "button", onClick: onOwn }, labels.action),
  );
}
