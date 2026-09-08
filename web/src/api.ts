/**
 * Запросы к API личной страницы. Пути — из `route.ts`, формы — из контракта.
 * Серверный код в браузер не импортируется.
 */

import type { CreateProfileRequest, ErrorCode, PageStateDto, SubmitPortionRequest } from "./contract.js";
import { API_CREATE_PROFILE, API_PAGE_STATE, API_SUBMIT_PORTION, fillPath } from "./route.js";

export interface Transport {
  fetch: typeof fetch;
  /** Пустая строка — тот же источник, что и страница. */
  origin?: string;
}

export type PageResult =
  | { ok: true; page: PageStateDto }
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
