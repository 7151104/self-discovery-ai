/**
 * HTML-документ живого клиента для `/p/{profileId}` и `/s/{token}`.
 *
 * Временная оболочка E3-04 снята: она рисовала свой HTML из DTO и расходилась
 * с витриной. Состояние по-прежнему приходит с API; этот документ только
 * подключает модули и стили из `web/dist`. Без сценариев — запасной текст
 * из реестра микрокопии, не дамп блоков.
 */

import { uiCopy } from "../engine.js";
import { CLIENT_SCRIPT, CLIENT_STYLE } from "./static.js";

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

/** Один документ на личную ссылку, публичную ссылку и отказ. */
export function renderClientDocument(): string {
  const title = escape(uiCopy("UI_PAGE_TITLE"));
  const noscript = escape(uiCopy("UI_PAGE_NOSCRIPT"));
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="stylesheet" href="${CLIENT_STYLE}">
</head>
<body>
<div id="app"></div>
<noscript><p>${noscript}</p></noscript>
<script type="module" src="${CLIENT_SCRIPT}"></script>
</body>
</html>
`;
}

/** Профиля нет, токен мёртв или сработал лимит: тот же клиент, статус задаёт транспорт. */
export const renderMissingPage = renderClientDocument;
