/**
 * HTTP-транспорт на встроенном `node:http`: маршрут из контракта, ограничение
 * частоты до обработчика, разбор тела, проверка ответа на выходе, JSON наружу.
 * Фреймворк не подключается — обоснование в `docs/14-state.md`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ServerConfig } from "../config.js";
import type { Db } from "../db/driver.js";
import { assertNoCoordinates, assertNoPrivateBlocks } from "./guard.js";
import { log } from "../log.js";
import { createProvider } from "../payments/registry.js";
import { renderPage, renderMissingPage, renderPublicPage } from "./page-shell.js";
import { matchApi, matchPage, matchPublicPage } from "./router.js";
import { RateLimiter, type Bucket } from "./rate-limit.js";
import * as handlers from "./handlers.js";
import type { Context, HandlerResult } from "./handlers.js";
import type { OperationName } from "../contract/index.js";

export interface CreateOptions {
  db: Db;
  config: ServerConfig;
}

/** Какой корзиной лимита считается операция. Остальные попадают в общую. */
const BUCKETS: Partial<Record<OperationName, Bucket>> = {
  createProfile: "createProfile",
  submitPortion: "portion",
  editAnswer: "portion",
  pageState: "state",
  publicPage: "state",
};

/**
 * Тело запроса разобранным и дословно. Дословная строка нужна уведомлениям
 * провайдера: подпись считается по байтам тела, а не по разобранному объекту.
 */
interface Body {
  raw: string;
  value: unknown;
}

async function readBody(request: IncomingMessage, limit: number): Promise<Body | "too_large" | "invalid"> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) return "too_large";
    chunks.push(buffer);
  }

  if (!size) return { raw: "", value: null };
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    return "invalid";
  }
}

/**
 * Адрес клиента для счётчиков. Заголовку доверяем только когда об этом сказано
 * явно: иначе лимит обходится подделкой заголовка.
 */
function clientOf(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const address = first?.split(",")[0]?.trim();
    if (address) return address;
  }
  return request.socket.remoteAddress ?? "unknown";
}

function sendJson(response: ServerResponse, result: HandlerResult): void {
  const payload = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // Страница закрыта для поисковых систем: ссылка личная (docs/12, слой 3).
    "x-robots-tag": "noindex, nofollow",
  });
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  });
  response.end(html);
}

interface Runtime {
  context: Context;
  limiter: RateLimiter;
}

async function dispatch(runtime: Runtime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const { context, limiter } = runtime;
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  const client = clientOf(request, context.config.trustProxy);

  /** Отказ по лимиту не доходит до обработчика, поэтому записей не создаёт. */
  const overLimit = (bucket: Bucket): HandlerResult | null => {
    const decision = limiter.take(bucket, client);
    if (decision.allowed) return null;
    return { status: 429, body: { error: { code: "rate_limited" } } };
  };

  /** Ненайденный профиль или токен — попытка перебора, у неё свой счётчик. */
  const countMiss = (result: HandlerResult): HandlerResult => {
    if (result.status !== 404) return result;
    return overLimit("miss") ?? result;
  };

  const pageRoute = matchPage(url.pathname);
  if (pageRoute && method === "GET") {
    const limited = overLimit("state");
    if (limited) {
      sendHtml(response, limited.status, renderMissingPage());
      return;
    }
    const state = countMiss(handlers.pageState(context, pageRoute));
    if (state.status !== 200) {
      sendHtml(response, state.status, renderMissingPage());
      return;
    }
    assertNoCoordinates(state.body);
    sendHtml(response, 200, renderPage(state.body));
    return;
  }

  const publicRoute = matchPublicPage(url.pathname);
  if (publicRoute && method === "GET") {
    const limited = overLimit("state");
    if (limited) {
      sendHtml(response, limited.status, renderMissingPage());
      return;
    }
    const state = countMiss(handlers.publicPage(context, publicRoute));
    if (state.status !== 200) {
      sendHtml(response, state.status, renderMissingPage());
      return;
    }
    assertNoCoordinates(state.body);
    assertNoPrivateBlocks(state.body);
    sendHtml(response, 200, renderPublicPage(state.body));
    return;
  }

  const route = matchApi(method, url.pathname);
  if (route === null) {
    sendJson(response, handlers.fail(404, "not_found"));
    return;
  }
  if (route === "method_not_allowed") {
    sendJson(response, handlers.fail(405, "method_not_allowed"));
    return;
  }

  const { name, params } = route;
  const bucket = BUCKETS[name];
  if (bucket) {
    const limited = overLimit(bucket);
    if (limited) {
      sendJson(response, limited);
      return;
    }
  }

  const body = await readBody(request, context.config.maxBodyBytes);
  if (body === "too_large") {
    sendJson(response, handlers.fail(413, "payload_too_large"));
    return;
  }
  if (body === "invalid") {
    sendJson(response, handlers.fail(400, "bad_request"));
    return;
  }

  const result = countMiss(run(context, name, params, body, request.headers));

  // Проверка на выходе: типы уже не дают собрать протёкший ответ, а это —
  // вторая линия на случай формы, собранной обходом типов (E3-06).
  if (result.status < 400) {
    assertNoCoordinates(result.body);
    if (name === "publicPage") assertNoPrivateBlocks(result.body);
  }

  sendJson(response, result);
}

function run(
  context: Context,
  name: OperationName,
  params: Record<string, string>,
  body: Body,
  headers: IncomingMessage["headers"],
): HandlerResult {
  switch (name) {
    case "health":
      return handlers.health(context);
    case "createProfile":
      return handlers.createProfile(context, body.value);
    case "pageState":
      return handlers.pageState(context, params);
    case "submitPortion":
      return handlers.submitPortion(context, params, body.value);
    case "editAnswer":
      return handlers.editAnswer(context, params, body.value);
    case "disagree":
      return handlers.disagree(context, params, body.value);
    case "purchase":
      return handlers.purchase(context, params, body.value);
    case "refund":
      return handlers.refund(context, params);
    case "webhook":
      return handlers.webhook(context, params, { raw: body.raw, headers });
    case "blockText":
      return handlers.blockText(context, params);
    case "exportProfile":
      return handlers.exportProfile(context, params);
    case "deleteProfile":
      return handlers.deleteProfileHandler(context, params);
    case "generationStatus":
      return handlers.generationStatus(context, params);
    case "share":
      return handlers.share(context, params);
    case "revokeShare":
      return handlers.revokeShare(context, params);
    case "publicPage":
      return handlers.publicPage(context, params);
  }
}

export function createHttpServer(options: CreateOptions): Server {
  const context: Context = {
    db: options.db,
    config: options.config,
    // Незнакомое имя провайдера — отказ при запуске, а не при первой оплате.
    payments: createProvider({ payments: options.config.payments, publicOrigin: options.config.publicOrigin }),
    startedAt: Date.now(),
  };
  const limiter = new RateLimiter(options.config.rateLimit.rules, options.config.rateLimit.enabled);
  const runtime: Runtime = { context, limiter };

  return createServer((request, response) => {
    dispatch(runtime, request, response).catch((error: unknown) => {
      // Имя ошибки, а не её сообщение: в сообщении бывает содержимое запроса.
      log("request.failed", { reason: error instanceof Error ? error.name : "unknown" });
      if (!response.headersSent) sendJson(response, handlers.fail(500, "internal_error"));
      else response.end();
    });
  });
}
