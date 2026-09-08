/**
 * Загрузка собранных модулей клиента и сервера.
 *
 * Тесты качества живут вне `web/` и `server/`, поэтому относительный импорт
 * после компиляции в `tests/dist/` разъехался бы. Путь — от корня репозитория,
 * тот же приём, что в `web/src/app.test.ts` для сервера.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./paths.js";

export const load = async <T>(rel: string): Promise<T> =>
  (await import(pathToFileURL(join(repoRoot, rel)).href)) as T;

export const web = <T>(rel: string): Promise<T> => load<T>(join("web/dist", rel));

export const server = <T>(rel: string): Promise<T> => load<T>(join("server/dist", rel));
