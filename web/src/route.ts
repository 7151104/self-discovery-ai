/**
 * Адресация живой страницы. Шаблоны совпадают с контрактом
 * (`PAGE_PATH`, `API` в `server/src/contract/api.ts`): клиент не импортирует
 * серверные значения, чтобы они не уехали в браузер. Тест сверяет строки
 * с контрактом.
 */

export const PAGE_PATH = "/p/:profileId";
export const PUBLIC_PAGE_PATH = "/s/:token";
export const API_PAGE_STATE = "/api/p/:profileId";
export const API_CREATE_PROFILE = "/api/profiles";
export const API_SUBMIT_PORTION = "/api/p/:profileId/portions";
export const API_DISAGREE = "/api/p/:profileId/disagreements";
export const API_SAVE_CONTACT = "/api/p/:profileId/contact";
export const API_SHARE = "/api/p/:profileId/share";
export const API_PUBLIC_PAGE = "/api/s/:token";
export const API_PURCHASE = "/api/p/:profileId/orders";
export const API_GENERATION_STATUS = "/api/p/:profileId/generations/:generationId";
export const API_DECLINE_OFFER = "/api/p/:profileId/offer-decline";
export const API_RECORD_CONSENT = "/api/p/:profileId/consent";

/** Постоянные адреса документов: копия `LEGAL_PATHS` контракта. */
export const LEGAL_PATHS = {
  privacy: "/legal/privacy",
  consent: "/legal/consent",
  offer: "/legal/offer",
  disclaimers: "/legal/disclaimers",
} as const;

export type Route =
  | { kind: "page"; profileId: string }
  | { kind: "public"; token: string }
  | { kind: "intro" }
  | { kind: "missing" };

const PAGE = /^\/p\/([^/]+)\/?$/;
const PUBLIC = /^\/s\/([^/]+)\/?$/;

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

export function publicHref(token: string): string {
  return fillPath(PUBLIC_PAGE_PATH, { token });
}

export function parseRoute(pathname: string): Route {
  const match = PAGE.exec(pathname);
  const profileId = match?.[1];
  if (profileId !== undefined && profileId.length > 0) {
    return { kind: "page", profileId: decodeURIComponent(profileId) };
  }
  const shared = PUBLIC.exec(pathname);
  const token = shared?.[1];
  if (token !== undefined && token.length > 0) {
    return { kind: "public", token: decodeURIComponent(token) };
  }
  if (INTRO_PATHS.has(pathname)) return { kind: "intro" };
  return { kind: "missing" };
}
