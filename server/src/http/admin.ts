/**
 * Служебные ручки воронки и метрик (E10-07, E10-08).
 *
 * Это не контракт клиента и не админка в браузере: продукт её не имеет, и
 * заводить не нужно. Доступ — общий секрет из окружения, ответ — JSON,
 * который печатает `tools/funnel.mjs`. Клиентский бандл отсюда ничего не
 * импортирует.
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { buildFunnel, buildMetrics } from "../funnel.js";
import type { Context, HandlerResult } from "./handlers.js";

export type AdminRoute = "funnel" | "metrics";

const BEARER = "Bearer ";

const headerValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
};

/** Сравнение секрета за постоянное время. Пустой секрет никому не подходит. */
export function secretsEqual(provided: string, expected: string): boolean {
  if (!expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function adminSecretFrom(headers: IncomingHttpHeaders): string {
  const authorization = headerValue(headers["authorization"]);
  if (authorization.startsWith(BEARER)) return authorization.slice(BEARER.length);
  return headerValue(headers["x-sdai-admin-secret"]);
}

export function adminAuthorized(headers: IncomingHttpHeaders, secret: string): boolean {
  return secretsEqual(adminSecretFrom(headers), secret);
}

export function matchAdmin(method: string, pathname: string): AdminRoute | "method_not_allowed" | null {
  if (pathname === "/api/admin/funnel" || pathname === "/api/admin/metrics") {
    if (method !== "GET") return "method_not_allowed";
    return pathname.endsWith("/funnel") ? "funnel" : "metrics";
  }
  return null;
}

const unauthorized = (): HandlerResult => ({ status: 401, body: { error: { reason: "unauthorized" } } });

export function admin(context: Context, route: AdminRoute, headers: IncomingHttpHeaders): HandlerResult {
  if (!adminAuthorized(headers, context.config.adminSecret)) return unauthorized();
  const version = context.config.build.version;
  if (route === "funnel") return { status: 200, body: buildFunnel(context.db, version) };
  return { status: 200, body: buildMetrics(context.db, version) };
}
