/**
 * Разбор юридического markdown в HTML.
 *
 * Это не общий markdown-движок: хватает того, что реально стоит в
 * `content/legal/` — заголовки, таблицы, списки, жирный, ссылки и подстановки
 * реквизитов. Подстановка без значения не выдумывается и остаётся видна.
 */

/** Имя реквизита в двойных фигурных скобках, как в `content/legal/README.md`. */
export const SUBSTITUTION = /\{\{([А-ЯЁA-Z_]+)\}\}/g;

export interface MarkdownRenderOptions {
  /** Подпись незаполненного реквизита: из микрокопии, не из этого файла. */
  unfilledLabel: string;
  /**
   * Уже известные реквизиты (имя продукта, домен). Остальные остаются
   * видимой подстановкой: выдумывать ИНН нельзя.
   */
  values?: Record<string, string>;
}

const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const unfilled = (name: string, label: string): string => {
  const visible = `{{${name}}}`;
  const title = label.length > 0 ? ` title="${escape(label)}"` : "";
  return `<span class="legal-unfilled" data-unfilled="${escape(name)}"${title}>${escape(visible)}</span>`;
};

const isSubstitutionHref = (href: string): boolean => /\{\{[А-ЯЁA-Z_]+\}\}/.test(href);

const filledOf = (name: string, values: Record<string, string> | undefined): string | null => {
  const value = values?.[name];
  return value && value.length > 0 ? value : null;
};

const hrefOf = (value: string): string => (/^https?:\/\//.test(value) ? value : `https://${value}`);

function inline(text: string, options: MarkdownRenderOptions): string {
  const chunks: string[] = [];
  const pattern = /(\{\{[А-ЯЁA-Z_]+\}\})|(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) chunks.push(escape(text.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith("{{")) {
      const name = token.slice(2, -2);
      const filled = filledOf(name, options.values);
      chunks.push(filled ? escape(filled) : unfilled(name, options.unfilledLabel));
    } else if (token.startsWith("`")) {
      chunks.push(`<code>${escape(token.slice(1, -1))}</code>`);
    } else if (token.startsWith("**")) {
      chunks.push(`<strong>${inline(token.slice(2, -2), options)}</strong>`);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? "";
      const href = link?.[2] ?? "";
      if (isSubstitutionHref(href)) {
        const name = href.replace(/^\{\{/, "").replace(/\}\}$/, "");
        const filled = filledOf(name, options.values);
        if (filled) {
          chunks.push(`<a href="${escape(hrefOf(filled))}">${inline(label, options)}</a>`);
        } else {
          chunks.push(`${inline(label, options)} ${unfilled(name, options.unfilledLabel)}`);
        }
      } else if (/^https?:\/\//.test(href) || href.startsWith("/")) {
        chunks.push(`<a href="${escape(href)}">${inline(label, options)}</a>`);
      } else {
        chunks.push(inline(label, options));
      }
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) chunks.push(escape(text.slice(cursor)));
  return chunks.join("");
}

const heading = (line: string): { tag: string; text: string } | null => {
  const match = /^(#{1,3})\s+(.+)$/.exec(line);
  if (!match) return null;
  const level = match[1]?.length ?? 1;
  return { tag: `h${level}`, text: match[2] ?? "" };
};

const tableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isRuleRow = (cells: string[]): boolean => cells.every((cell) => /^:?-{2,}:?$/.test(cell));

function renderTable(rows: string[][], options: MarkdownRenderOptions): string {
  if (rows.length === 0) return "";
  const head = rows[0] ?? [];
  const body = rows.slice(1);
  const th = head.map((cell) => `<th>${inline(cell, options)}</th>`).join("");
  const tr = body
    .map((cells) => `<tr>${cells.map((cell) => `<td>${inline(cell, options)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/**
 * Юридический markdown → HTML. Подстановки реквизитов остаются подстановками
 * и помечаются классом `legal-unfilled`, чтобы на странице было видно:
 * значение не заполнено.
 */
export function renderLegalMarkdown(source: string, options: MarkdownRenderOptions): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      out.push("<hr>");
      index += 1;
      continue;
    }

    const head = heading(line);
    if (head) {
      out.push(`<${head.tag}>${inline(head.text, options)}</${head.tag}>`);
      index += 1;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const block: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        block.push(lines[index] ?? "");
        index += 1;
      }
      const rows = block.map(tableRow).filter((cells) => !isRuleRow(cells));
      out.push(renderTable(rows, options));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item, options)}</li>`).join("")}</ul>`);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() !== "" &&
      !heading(lines[index] ?? "") &&
      !(lines[index] ?? "").trim().startsWith("|") &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^---+$/.test((lines[index] ?? "").trim())
    ) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(" "), options)}</p>`);
  }

  return out.join("\n");
}
