/**
 * Юридические тексты (`content/legal/`).
 *
 * Markdown остаётся источником правды: этот модуль читает файлы, а не хранит
 * копию. Версия согласия — отпечаток полного текста, а не номер, который
 * нужно помнить поднять: правка документа сама меняет то, что запишется
 * в базу при следующей отметке.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rawExtraContent } from "./generated/content-extra.js";
import type { RawDisclaimer } from "./content-extra-types.js";
import { identityRequisites } from "./identity.js";
import { renderLegalMarkdown, SUBSTITUTION } from "./legal-markdown.js";

export type { RawDisclaimer } from "./content-extra-types.js";

/** Идентификатор публичного документа. Совпадает с ключом адреса. */
export type LegalDocId = "privacy" | "consent" | "offer" | "disclaimers";

export interface LegalDocument {
  id: LegalDocId;
  /** Имя файла в `content/legal/`. */
  file: string;
  /** Постоянный адрес страницы. */
  path: string;
}

/**
 * Каталог документов и их постоянных адресов. Пути те же, что в контракте
 * (`LEGAL_PATHS`): клиент их копирует, сервер читает отсюда.
 */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { id: "privacy", file: "privacy-policy.md", path: "/legal/privacy" },
  { id: "consent", file: "consent.md", path: "/legal/consent" },
  { id: "offer", file: "offer.md", path: "/legal/offer" },
  { id: "disclaimers", file: "disclaimers.md", path: "/legal/disclaimers" },
] as const;

const byId = new Map(LEGAL_DOCUMENTS.map((item) => [item.id, item]));
const byPath = new Map(LEGAL_DOCUMENTS.map((item) => [item.path, item]));

/** Каталог `content/legal/` относительно собранного файла. */
const legalDir = (): URL => new URL("../../content/legal/", import.meta.url);

export const legalFilePath = (file: string): string => fileURLToPath(new URL(file, legalDir()));

export function readLegalFile(file: string): string {
  return readFileSync(legalFilePath(file), "utf8");
}

export function legalDocument(id: LegalDocId): LegalDocument {
  const found = byId.get(id);
  if (!found) throw new Error(`нет юридического документа ${id}`);
  return found;
}

export function legalDocumentByPath(path: string): LegalDocument | null {
  return byPath.get(path) ?? null;
}

/** Первый заголовок файла — название страницы. */
export function legalTitle(source: string): string {
  const line = source.split(/\r?\n/).find((candidate) => candidate.startsWith("# "));
  if (!line) throw new Error("в юридическом файле нет заголовка");
  return line.replace(/^#\s+/, "").trim();
}

/**
 * Нормализация перед отпечатком: перевод строки один, хвостовые пробелы
 * строк снимаются. Иначе правка перевода строки на Windows меняла бы версию
 * согласия, хотя человеку текст тот же.
 */
export function normalizeLegalSource(source: string): string {
  return `${source.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").trim()}\n`;
}

/**
 * Фрагмент файла от заголовка `## …` до следующего такого же уровня.
 * Нужен, чтобы версия согласия считалась по юридически обязывающему тексту,
 * а не по пояснениям «как собирается» над ним.
 */
export function markdownSection(source: string, heading: string): string {
  const lines = normalizeLegalSource(source).split("\n");
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) throw new Error(`нет раздела «${heading}»`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/**
 * Версия согласия: SHA-256 полного текста раздела «Полный текст согласия».
 *
 * Подстановки (`{{ОПЕРАТОР_ИНН}}` и остальные) входят в отпечаток как есть:
 * заполнение реквизита — это новая редакция, и согласие должно быть новым.
 * Номера `{{ВЕРСИЯ_ДОКУМЕНТА}}` в файле нет смысла ждать: его некому поднять.
 */
export function consentVersion(source: string = readLegalFile("consent.md")): string {
  const body = markdownSection(source, "Полный текст согласия");
  if (body.length < 200) throw new Error("полный текст согласия пустой или обрывочный");
  return createHash("sha256").update(normalizeLegalSource(body), "utf8").digest("hex");
}

export interface ConsentMarkPart {
  text: string;
  /** Постоянный адрес, если это ссылка внутри сервиса. */
  href?: string;
}

export interface ConsentShort {
  title: string;
  body: string;
  mark: ConsentMarkPart[];
  button: string;
  refuse: ConsentMarkPart[];
}

const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();

const labeled = (section: string, label: string, continued: boolean): string => {
  const lines = section.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`**${label}:**`));
  if (start < 0) throw new Error(`в коротком согласии нет поля «${label}»`);
  const first = lines[start]!.replace(`**${label}:**`, "").trim();
  if (!continued) return first;
  const rest: string[] = first ? [first] : [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("**") && line.includes(":**")) break;
    if (line.startsWith("## ")) break;
    rest.push(line);
  }
  return rest.join("\n").trim();
};

/**
 * Ссылки с подстановкой домена в коротком тексте ведут на постоянные адреса
 * сервиса: домен живёт в идентичности, а в потоке ссылки остаются постоянными
 * путями `/legal/…`, чтобы смена хоста не ломала клики.
 */
const IN_FLOW_HREF: Record<string, string> = {
  политике: "/legal/privacy",
  "странице о сервисе": "/",
};

const startAfter = (lines: string[], labeledLine: number): number => {
  let index = labeledLine + 1;
  while (index < lines.length && lines[index]!.trim() === "") index += 1;
  return index;
};

function parseMark(raw: string): ConsentMarkPart[] {
  const parts: ConsentMarkPart[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: raw.slice(cursor, index) });
    const label = match[1] ?? "";
    const href = IN_FLOW_HREF[label] ?? "/legal/privacy";
    parts.push({ text: label, href });
    cursor = index + match[0].length;
  }
  if (cursor < raw.length) parts.push({ text: raw.slice(cursor) });
  return parts.filter((part) => part.text.length > 0);
}

/** Короткий текст в потоке: заголовок, пояснение, отметка, отказ. */
export function consentShort(source: string = readLegalFile("consent.md")): ConsentShort {
  const section = markdownSection(source, "Короткий текст в потоке");
  const lines = section.split("\n");
  const afterTitle = lines.findIndex((line) => line.startsWith("**Заголовок:**"));
  const beforeMark = lines.findIndex((line) => line.startsWith("**Отметка:**"));
  const body = squeeze(
    lines.slice(afterTitle < 0 ? 0 : startAfter(lines, afterTitle), beforeMark < 0 ? undefined : beforeMark).join("\n"),
  );
  return {
    title: labeled(section, "Заголовок", false),
    body,
    mark: parseMark(squeeze(labeled(section, "Отметка", true))),
    button: labeled(section, "Кнопка", false),
    refuse: parseMark(squeeze(labeled(section, "Отказ", true))),
  };
}

export const disclaimers = (): RawDisclaimer[] => rawExtraContent.disclaimers;

/** Дисклеймеры одного места показа. Совпадение точное: «вместо блока» само по себе место. */
export function disclaimersAt(place: string): RawDisclaimer[] {
  return disclaimers().filter((item) => item.where.includes(place));
}

export interface RenderedLegalPage {
  id: LegalDocId;
  path: string;
  title: string;
  html: string;
  /** Имена подстановок, которые так и остались пустыми. */
  unfilled: string[];
}

export function renderLegalDocument(
  id: LegalDocId,
  options: { unfilledLabel: string } = { unfilledLabel: "" },
): RenderedLegalPage {
  const document = legalDocument(id);
  const source = readLegalFile(document.file);
  const values = identityRequisites();
  const unfilled = [
    ...new Set(
      [...source.matchAll(SUBSTITUTION)]
        .map((match) => match[1] ?? "")
        .filter((name) => !values[name]),
    ),
  ];
  return {
    id,
    path: document.path,
    title: legalTitle(source),
    html: renderLegalMarkdown(source, { unfilledLabel: options.unfilledLabel, values }),
    unfilled,
  };
}
