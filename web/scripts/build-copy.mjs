/**
 * Реестр микрокопии для клиента.
 *
 * `content/ui-copy.md` → `web/src/generated/ui-copy.ts`. Тот же приём, что у
 * движка (`engine/src/generated/`): markdown разбирается один раз при сборке,
 * в браузер уезжают только данные.
 *
 * Движок в браузер не уезжает вовсе: он тянет за собой контент лестницы,
 * банк вопросов и скоринг — это десятки килобайт, которых клиенту знать
 * нельзя и не нужно. Поэтому клиент получает выжимку: идентификатор, текст,
 * имена подстановок.
 *
 * Группа DEV сюда не попадает: это строки служебной панели прототипа,
 * человеку в продукте они не показываются.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rawExtraContent } from "../../engine/dist/generated/content-extra.js";
import {
  consentShort,
  consentVersion,
  disclaimers,
  LEGAL_DOCUMENTS,
  legalTitle,
  readLegalFile,
} from "../../engine/dist/legal.js";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(webRoot, "src", "generated");

/** Строки, которые видит человек в продукте. Панель прототипа — не продукт. */
const SKIP_GROUPS = new Set(["DEV"]);

const entries = rawExtraContent.uiCopy.filter((entry) => !SKIP_GROUPS.has(entry.group));

const literal = (value) => JSON.stringify(value);

const body = entries
  .map((entry) => `  ${entry.id}: { group: ${literal(entry.group)}, text: ${literal(entry.text)}, params: ${literal(entry.params)} },`)
  .join("\n");

const source = [
  "// СГЕНЕРИРОВАНО из content/ui-copy.md сборкой web (npm run build:web) — не редактировать.",
  "",
  "/** Строка реестра: текст и имена подстановок в нём. */",
  "export interface CopyEntry {",
  "  group: string;",
  "  text: string;",
  "  params: readonly string[];",
  "}",
  "",
  "export const UI_COPY: Record<string, CopyEntry> = {",
  body,
  "};",
  "",
].join("\n");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "ui-copy.ts"), source);

const groups = new Set(entries.map((entry) => entry.group));
console.log(`web/src/generated/ui-copy.ts: ${entries.length} строк в ${groups.size} группах`);

const short = consentShort();
const catalog = LEGAL_DOCUMENTS.map((item) => ({
  id: item.id,
  path: item.path,
  title: legalTitle(readLegalFile(item.file)),
}));
const items = disclaimers();

const legalSource = [
  "// СГЕНЕРИРОВАНО из content/legal/ сборкой web (npm run build:web) — не редактировать.",
  "",
  "/** Фрагмент короткого согласия: обычный текст или ссылка внутри сервиса. */",
  "export interface ConsentPart {",
  "  text: string;",
  "  href?: string;",
  "}",
  "",
  "export interface ConsentShort {",
  "  title: string;",
  "  body: string;",
  "  mark: ConsentPart[];",
  "  button: string;",
  "  refuse: ConsentPart[];",
  "}",
  "",
  "export interface LegalCatalogItem {",
  "  id: string;",
  "  path: string;",
  "  title: string;",
  "}",
  "",
  "export interface DisclaimerItem {",
  "  id: string;",
  "  text: string;",
  "  where: readonly string[];",
  "}",
  "",
  `export const CONSENT_VERSION = ${literal(consentVersion())};`,
  "",
  `export const CONSENT_SHORT: ConsentShort = ${JSON.stringify(short, null, 2)};`,
  "",
  `export const LEGAL_DOCUMENTS: readonly LegalCatalogItem[] = ${JSON.stringify(catalog, null, 2)};`,
  "",
  `export const DISCLAIMERS: readonly DisclaimerItem[] = ${JSON.stringify(items, null, 2)};`,
  "",
].join("\n");

writeFileSync(join(outDir, "legal.ts"), legalSource);
console.log(`web/src/generated/legal.ts: документов ${catalog.length}, дисклеймеров ${items.length}`);
