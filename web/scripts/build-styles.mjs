/**
 * Сборка стилей клиента.
 *
 * Читает токены из собранного `web/dist/tokens/tokens.js` (источник —
 * `web/tokens/tokens.ts`) и складывает одну таблицу стилей:
 * переменные плюс CSS компонентов в фиксированном порядке.
 *
 * Собранное не хранится в репозитории: оно производная от токенов и
 * компонентов, как `engine/src/generated/`.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokensCss } from "../dist/tokens/tokens.js";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(webRoot, "dist");

/** База идёт первой: на ней держатся сброс и кольцо фокуса. */
const ORDER = ["base.css"];

const componentStyles = () => {
  const directory = join(webRoot, "components");
  const files = readdirSync(directory).filter((name) => name.endsWith(".css"));
  const rest = files.filter((name) => !ORDER.includes(name)).sort();
  return [...ORDER, ...rest].map((name) => ({ name, source: readFileSync(join(directory, name), "utf8") }));
};

const showcaseStyles = () => {
  const directory = join(webRoot, "showcase");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".css"))
    .sort()
    .map((name) => ({ name, source: readFileSync(join(directory, name), "utf8") }));
};

mkdirSync(distRoot, { recursive: true });

const tokens = tokensCss();
writeFileSync(join(distRoot, "tokens.css"), tokens);

const parts = [tokens, ...componentStyles().map((file) => `/* ${file.name} */\n${file.source}`)];
const app = parts.join("\n");
writeFileSync(join(distRoot, "app.css"), app);

const showcase = showcaseStyles().map((file) => `/* ${file.name} */\n${file.source}`).join("\n");
writeFileSync(join(distRoot, "showcase.css"), showcase);

const kb = (text) => (gzipSync(Buffer.from(text, "utf8")).length / 1024).toFixed(1);
console.log(`web/dist/app.css: ${kb(app)} КБ после сжатия`);
