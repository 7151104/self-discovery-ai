/**
 * Панель шеринга: картинка крючка и карты и отдельное включение публичной ссылки.
 *
 * Кнопка «Поделиться» отдаёт картинку, а не ссылку на тест
 * (`docs/11-ui-page-spec.md`, «Виральность»). Публичный доступ — второе
 * действие: страница закрыта, пока человек его не включил.
 */

import { h, type Handler, type VNode } from "../src/dom.js";

export interface SharePanelProps {
  imageReady: string;
  imageOnly: string;
  saveLabel: string;
  /** SVG картинки. null — делиться ещё нечем: нет крючка. */
  svg: string | null;
  privacy: string | null;
  live: string;
  openLabel: string | null;
  publicOn: string | null;
  link: string | null;
  closeLabel: string | null;
  closed: string | null;
  onOpen?: Handler;
  onClose?: Handler;
}

export function renderSharePanel(props: SharePanelProps): VNode {
  const href =
    props.svg === null ? null : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.svg)}`;

  return h(
    "section",
    { class: "share-panel", "data-share": props.svg === null ? "empty" : "image" },
    h("h2", { class: "share-panel__title" }, props.imageReady),
    h("p", { class: "share-panel__note" }, props.imageOnly),
    href
      ? h("a", { class: "share-panel__save", href, download: "share.svg" }, props.saveLabel)
      : null,
    href ? h("img", { class: "share-panel__preview", src: href, alt: props.imageReady }) : null,
    props.privacy ? h("p", { class: "share-panel__privacy" }, props.privacy) : null,
    h("p", { class: "share-panel__live" }, props.live),
    props.openLabel
      ? h("button", { class: "share-panel__open", type: "button", onClick: props.onOpen }, props.openLabel)
      : null,
    props.publicOn ? h("p", { class: "share-panel__on" }, props.publicOn) : null,
    props.link ? h("p", { class: "share-panel__link" }, props.link) : null,
    props.closeLabel
      ? h("button", { class: "share-panel__close", type: "button", onClick: props.onClose }, props.closeLabel)
      : null,
    props.closed ? h("p", { class: "share-panel__closed" }, props.closed) : null,
  );
}
