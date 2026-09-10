/**
 * Страницы юридических документов (E9-02).
 *
 * Markdown из `content/legal/` — источник правды: страница его читает через
 * движок и не хранит копию. Клиент без сборщика (E6-01) эти файлы в бандл
 * не тянет — HTML собирает сервер. Незаполненные реквизиты остаются видны
 * как `{{ИМЯ}}`: выдумывать лицо и домен нельзя.
 */

import { readFileSync } from "node:fs";
import { LEGAL_PATHS, type LegalDocId } from "./contract/index.js";
import {
  LEGAL_DOCUMENTS,
  legalTitle,
  readLegalFile,
  renderLegalDocument,
  uiCopy,
} from "./engine.js";

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

const repoFile = (relative: string): string => readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

const STYLES = ["web/dist/tokens.css", "web/components/base.css", "web/components/legal-doc.css", "web/components/footer.css"];

const documentStyles = (): string => STYLES.map((file) => repoFile(file)).join("\n");

const footerHtml = (current: LegalDocId): string => {
  const heading = escape(uiCopy("UI_FOOTER_LABEL"));
  const links = LEGAL_DOCUMENTS.map((item) => {
    const title = escape(legalTitle(readLegalFile(item.file)));
    const currentMark = item.id === current ? ` aria-current="page"` : "";
    return `<a class="site-footer__link" href="${escape(item.path)}"${currentMark}>${title}</a>`;
  }).join("");
  return `<footer class="site-footer"><p class="site-footer__heading">${heading}</p><nav class="site-footer__nav">${links}</nav></footer>`;
};

export function renderLegalHtml(id: LegalDocId): string {
  const path = LEGAL_PATHS[id];
  if (path === undefined) throw new Error(`нет юридического адреса ${id}`);

  const page = renderLegalDocument(id, { unfilledLabel: uiCopy("UI_LEGAL_UNFILLED") });
  if (page.path !== path) throw new Error(`путь документа ${id} разошёлся с контрактом`);
  const title = escape(page.title);
  return `<!doctype html>
<html lang="ru" data-legal="${escape(id)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f3e9dc">
<title>${title}</title>
<style>
${documentStyles()}
</style>
<body class="legal-page">
<article class="legal-doc" data-legal="${escape(id)}">
${page.html}
</article>
${footerHtml(id)}
</body>
</html>
`;
}

export function renderLegalMissing(): string {
  return `<!doctype html>
<html lang="ru" data-legal="missing">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<body data-error="not_found"></body>
</html>
`;
}
