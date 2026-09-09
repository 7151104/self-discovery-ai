/**
 * Запросы к API личной страницы. Пути — из `route.ts`, формы — из контракта.
 * Серверный код в браузер не импортируется.
 */

import type {
  CreateProfileRequest,
  DisagreementKind,
  ErrorCode,
  GenerationDto,
  PageStateDto,
  PublicPageDto,
  SaveContactRequest,
  ShareDto,
  SubmitPortionRequest,
} from "./contract.js";
import {
  API_CREATE_PROFILE,
  API_DISAGREE,
  API_GENERATION_STATUS,
  API_PAGE_STATE,
  API_PUBLIC_PAGE,
  API_PURCHASE,
  API_SAVE_CONTACT,
  API_SHARE,
  API_SUBMIT_PORTION,
  fillPath,
} from "./route.js";

export interface Transport {
  fetch: typeof fetch;
  /** Пустая строка — тот же источник, что и страница. */
  origin?: string;
}

export type PageResult =
  | { ok: true; page: PageStateDto }
  | { ok: false; missing: true }
  | { ok: false; missing: false; code: ErrorCode };

export type PublicResult =
  | { ok: true; page: PublicPageDto }
  | { ok: false; missing: true }
  | { ok: false; missing: false; code: ErrorCode };

export type ShareResult =
  | { ok: true; page: PageStateDto; share: ShareDto | null }
  | { ok: false; missing: true }
  | { ok: false; missing: false; code: ErrorCode };

export type GenerationResult =
  | { ok: true; generation: GenerationDto }
  | { ok: false; missing: true }
  | { ok: false; missing: false; code: ErrorCode };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const errorCode = (body: unknown): ErrorCode => {
  if (!isRecord(body)) return "internal_error";
  const error = body["error"];
  if (!isRecord(error) || typeof error["code"] !== "string") return "internal_error";
  return error["code"] as ErrorCode;
};

const isPage = (value: unknown): value is PageStateDto =>
  isRecord(value) && typeof value["profileId"] === "string" && typeof value["state"] === "string";

const isPublic = (value: unknown): value is PublicPageDto =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["state"] === "string" &&
  Array.isArray(value["map"]) &&
  Array.isArray(value["blocks"]) &&
  !("profileId" in value);

async function send(
  transport: Transport,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = `${transport.origin ?? ""}${path}`;
  const response = await transport.fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  return { status: response.status, body: parsed };
}

const toResult = (status: number, body: unknown): PageResult => {
  if (status === 404 || errorCode(body) === "profile_not_found") {
    return { ok: false, missing: true };
  }
  if (status >= 400) return { ok: false, missing: false, code: errorCode(body) };
  if (!isPage(body)) return { ok: false, missing: false, code: "internal_error" };
  return { ok: true, page: body };
};

const nestedPage = (body: unknown): unknown => (isRecord(body) && "page" in body ? body["page"] : body);

const isGeneration = (value: unknown): value is GenerationDto =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["blockId"] === "string" &&
  typeof value["status"] === "string";

const shareFrom = (body: unknown): ShareDto | null => {
  if (!isRecord(body)) return null;
  const share = body["share"];
  if (!isRecord(share) || typeof share["url"] !== "string" || typeof share["createdAt"] !== "string") return null;
  return { url: share["url"], createdAt: share["createdAt"] };
};

/** Состояние страницы по постоянной ссылке. */
export async function loadPage(profileId: string, transport: Transport): Promise<PageResult> {
  try {
    const path = fillPath(API_PAGE_STATE, { profileId });
    const reply = await send(transport, "GET", path);
    return toResult(reply.status, reply.body);
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Ступень 0: профиль и постоянная ссылка. */
export async function createProfile(input: CreateProfileRequest, transport: Transport): Promise<PageResult> {
  try {
    const reply = await send(transport, "POST", API_CREATE_PROFILE, input);
    return toResult(reply.status, reply.body);
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Отправка порции ответов. */
export async function submitPortion(
  profileId: string,
  payload: SubmitPortionRequest,
  transport: Transport,
): Promise<PageResult> {
  try {
    const path = fillPath(API_SUBMIT_PORTION, { profileId });
    const reply = await send(transport, "POST", path, payload);
    return toResult(reply.status, reply.body);
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Несогласие с блоком: данные, а не жалоба. */
export async function disagree(
  profileId: string,
  blockId: string,
  kind: DisagreementKind,
  transport: Transport,
): Promise<PageResult> {
  try {
    const path = fillPath(API_DISAGREE, { profileId });
    const reply = await send(transport, "POST", path, { blockId, kind });
    return toResult(reply.status, nestedPage(reply.body));
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Публичный вид по токену. */
export async function loadPublic(token: string, transport: Transport): Promise<PublicResult> {
  try {
    const path = fillPath(API_PUBLIC_PAGE, { token });
    const reply = await send(transport, "GET", path);
    if (reply.status === 404) return { ok: false, missing: true };
    if (reply.status >= 400) return { ok: false, missing: false, code: errorCode(reply.body) };
    if (!isPublic(reply.body)) return { ok: false, missing: false, code: "internal_error" };
    return { ok: true, page: reply.body };
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Включить публичную ссылку. Повтор отдаёт ту же. */
export async function enableShare(profileId: string, transport: Transport): Promise<ShareResult> {
  try {
    const path = fillPath(API_SHARE, { profileId });
    const reply = await send(transport, "POST", path);
    if (reply.status === 404 || errorCode(reply.body) === "profile_not_found") {
      return { ok: false, missing: true };
    }
    if (reply.status >= 400) return { ok: false, missing: false, code: errorCode(reply.body) };
    const page = nestedPage(reply.body);
    if (!isPage(page)) return { ok: false, missing: false, code: "internal_error" };
    return { ok: true, page, share: shareFrom(reply.body) ?? page.share };
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Отозвать публичную ссылку. */
export async function revokeShare(profileId: string, transport: Transport): Promise<ShareResult> {
  try {
    const path = fillPath(API_SHARE, { profileId });
    const reply = await send(transport, "DELETE", path);
    if (reply.status === 404 || errorCode(reply.body) === "profile_not_found") {
      return { ok: false, missing: true };
    }
    if (reply.status >= 400) return { ok: false, missing: false, code: errorCode(reply.body) };
    const page = nestedPage(reply.body);
    if (!isPage(page)) return { ok: false, missing: false, code: "internal_error" };
    return { ok: true, page, share: null };
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Статус генерации блока: клиент опрашивает его, пока текст пишется. */
export async function loadGeneration(
  profileId: string,
  generationId: string,
  transport: Transport,
): Promise<GenerationResult> {
  try {
    const path = fillPath(API_GENERATION_STATUS, { profileId, generationId });
    const reply = await send(transport, "GET", path);
    if (reply.status === 404 || errorCode(reply.body) === "profile_not_found" || errorCode(reply.body) === "not_found") {
      return { ok: false, missing: true };
    }
    if (reply.status >= 400) return { ok: false, missing: false, code: errorCode(reply.body) };
    const generation = isRecord(reply.body) ? reply.body["generation"] : null;
    if (!isGeneration(generation)) return { ok: false, missing: false, code: "internal_error" };
    return { ok: true, generation };
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Почта или мессенджер после первой порции. Пропуск — skip: true. */
export async function saveContact(
  profileId: string,
  payload: SaveContactRequest,
  transport: Transport,
): Promise<PageResult> {
  try {
    const path = fillPath(API_SAVE_CONTACT, { profileId });
    const reply = await send(transport, "POST", path, payload);
    return toResult(reply.status, nestedPage(reply.body));
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}

/** Создать заказ на срез. Точка оплаты целиком — E7-09; здесь нужен исход попытки. */
export async function purchase(profileId: string, slice: string, requestId: string, transport: Transport): Promise<PageResult> {
  try {
    const path = fillPath(API_PURCHASE, { profileId });
    const reply = await send(transport, "POST", path, { slice, requestId });
    return toResult(reply.status, nestedPage(reply.body));
  } catch {
    return { ok: false, missing: false, code: "internal_error" };
  }
}
