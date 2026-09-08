/**
 * Маршрутизатор поверх реестра эндпоинтов из контракта.
 *
 * Списка путей здесь нет: он один и живёт в `contract/api.ts`. Добавить
 * эндпоинт мимо контракта нельзя — маршрут просто неоткуда взять.
 */

import { API, PAGE_PATH, PUBLIC_PAGE_PATH, type OperationName } from "../contract/index.js";

export interface RouteMatch {
  name: OperationName;
  params: Record<string, string>;
}

const segmentsOf = (path: string): string[] => path.split("/").filter(Boolean);

function matchTemplate(template: string, pathname: string): Record<string, string> | null {
  const wanted = segmentsOf(template);
  const actual = segmentsOf(pathname);
  if (wanted.length !== actual.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const expected = wanted[index] ?? "";
    const value = actual[index] ?? "";
    if (expected.startsWith(":")) params[expected.slice(1)] = decodeURIComponent(value);
    else if (expected !== value) return null;
  }
  return params;
}

/**
 * Ищет эндпоинт по методу и пути. `"method_not_allowed"` — путь есть,
 * но метод другой: это отказ, а не «не найдено».
 */
export function matchApi(method: string, pathname: string): RouteMatch | "method_not_allowed" | null {
  let pathExists = false;

  for (const name of Object.keys(API) as OperationName[]) {
    const route = API[name];
    const params = matchTemplate(route.path, pathname);
    if (params === null) continue;
    pathExists = true;
    if (route.method === method) return { name, params };
  }

  return pathExists ? "method_not_allowed" : null;
}

/** Адрес личной страницы `/p/{profileId}`. */
export function matchPage(pathname: string): { profileId: string } | null {
  const params = matchTemplate(PAGE_PATH, pathname);
  const profileId = params?.["profileId"];
  return profileId === undefined ? null : { profileId };
}

/** Адрес публичного вида `/s/{token}`. */
export function matchPublicPage(pathname: string): { token: string } | null {
  const params = matchTemplate(PUBLIC_PAGE_PATH, pathname);
  const token = params?.["token"];
  return token === undefined ? null : { token };
}
