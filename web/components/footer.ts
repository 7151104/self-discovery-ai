/**
 * Подвал со ссылками на юридические документы (E9-02).
 *
 * Адреса и названия приходят параметрами: страницы читают markdown,
 * компонент его не копирует.
 */

import { h, type VNode } from "../src/dom.js";

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterProps {
  heading: string;
  links: FooterLink[];
}

export function renderFooter(props: FooterProps): VNode {
  return h(
    "footer",
    { class: "site-footer" },
    h("p", { class: "site-footer__heading" }, props.heading),
    h(
      "nav",
      { class: "site-footer__nav" },
      ...props.links.map((link) => h("a", { class: "site-footer__link", href: link.href }, link.label)),
    ),
  );
}
