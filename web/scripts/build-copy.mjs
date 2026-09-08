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
