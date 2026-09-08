/** Пути внутри репозитория. Считаются от собранного файла, а не от cwd. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `web/dist/src/paths.js` → корень репозитория. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const webRoot = resolve(repoRoot, "web");
