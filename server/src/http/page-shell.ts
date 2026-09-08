/**
 * Серверная оболочка адреса `/p/{profileId}`.
 *
 * Настоящий интерфейс — этап E7, прототип в `prototype/` не переписывается.
 * Здесь ровно столько, сколько нужно задаче E3-04: ссылка открывается в любом
 * браузере без входа и показывает то же состояние. Своих текстов оболочка не
 * пишет: на страницу попадают только строки, пришедшие из контента через API.
 */

import type { PageStateDto } from "../contract/index.js";

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

const document_ = (state: string, body: string, title: string): string =>
  `<!doctype html>
<html lang="ru" data-state="${escape(state)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(title)}</title>
${body}
</html>
`;

export function renderPage(payload: unknown): string {
  const page = payload as PageStateDto;

  const blocks = page.blocks
    .map((block) => {
      const paragraphs = block.paragraphs.map((text) => `<p>${escape(text)}</p>`).join("\n");
      const highlight = block.highlight ? `<p data-role="highlight">${escape(block.highlight)}</p>` : "";
      const generation = block.generation ? ` data-generation="${escape(block.generation.status)}"` : "";
      return `<section data-block="${escape(block.id)}"${generation}>
<h2>${escape(block.heading)}</h2>
${paragraphs}
${highlight}
</section>`;
    })
    .join("\n");

  const bars = page.map
    .map(
      (bar) =>
        `<li data-bar="${escape(bar.id)}" data-fill="${escape(bar.fill)}"${
          bar.position === null ? "" : ` data-position="${bar.position}"`
        }>${escape(bar.label)}</li>`,
    )
    .join("\n");

  const doors = page.doors
    .map((door) => `<li data-door="${escape(door.id)}" data-door-state="${escape(door.state)}">${escape(door.title)}</li>`)
    .join("\n");

  const hook = page.hook ? `<p data-role="hook">${escape(page.hook)}</p>` : "";
  const theme = page.card.theme ? `<p data-role="theme">${escape(page.card.theme)}</p>` : "";
  const portion = page.nextPortion
    ? `<section data-portion="${escape(page.nextPortion.key)}"><p>${escape(page.nextPortion.lead)}</p></section>`
    : "";

  const body = `<body>
<header><h1 data-role="name">${escape(page.card.name)}</h1>${theme}</header>
${hook}
<ul data-role="map">
${bars}
</ul>
${blocks}
${portion}
<ul data-role="route">
${doors}
</ul>
<script type="application/json" data-role="state">${JSON.stringify(page).replace(/</g, "\\u003c")}</script>
</body>`;

  return document_(page.state, body, page.card.name);
}

/** Профиля нет. Понятная страница вместо кода — задача E7-01. */
export function renderMissingPage(): string {
  return document_("missing", '<body data-error="profile_not_found"></body>', "");
}
