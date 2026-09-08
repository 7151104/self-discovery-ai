/**
 * Оболочка страницы юридического документа. HTML документов собирает сервер
 * из markdown; этот компонент держит пару со стилями и латинский прогон дисциплины.
 */

import { h, type VNode } from "../src/dom.js";

export interface LegalDocProps {
  title: string;
}

export function renderLegalDoc(props: LegalDocProps): VNode {
  return h("article", { class: "legal-doc" }, h("h1", { class: "legal-doc__title" }, props.title));
}
