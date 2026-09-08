/**
 * Корень репозитория для тестов качества.
 *
 * Считается от собранного файла `tests/dist/paths.js`, а не от cwd:
 * конвейер и локальный запуск должны видеть одни и те же эталоны.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `tests/dist/paths.js` → корень репозитория. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
