/**
 * Адресация живой страницы. Шаблоны совпадают с контрактом
 * (`PAGE_PATH`, `API` в `server/src/contract/api.ts`): клиент не импортирует
 * серверные значения, чтобы они не уехали в браузер. Тест сверяет строки
 * с контрактом.
 */

export const PAGE_PATH = "/p/:profileId";
export const API_PAGE_STATE = "/api/p/:profileId";
export const API_CREATE_PROFILE = "/api/profiles";
export const API_SUBMIT_PORTION = "/api/p/:profileId/portions";

export type Route =
  | { kind: "page"; profileId: string }
  | { kind: "intro" }
  | { kind: "missing" };

const PAGE = /^\/p\/([^/]+)\/?$/;

const INTRO_PATHS = new Set(["/", "/index.html", "/web/page", "/web/page/", "/web/page/index.html"]);

/** Подстановка параметров в шаблон: тот же приём, что `buildPath` контракта. */
export function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`no-path-param:${key}`);
    return encodeURIComponent(value);
  });
}

export function pageHref(profileId: string): string {
  return fillPath(PAGE_PATH, { profileId });
}

export function parseRoute(pathname: string): Route {
  const match = PAGE.exec(pathname);
  const profileId = match?.[1];
  if (profileId !== undefined && profileId.length > 0) {
    return { kind: "page", profileId: decodeURIComponent(profileId) };
  }
  if (INTRO_PATHS.has(pathname)) return { kind: "intro" };
  return { kind: "missing" };
}
