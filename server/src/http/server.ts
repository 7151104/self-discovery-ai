/**
 * HTTP-транспорт на встроенном `node:http`: маршрут из контракта, разбор тела,
 * JSON наружу. Фреймворк не подключается — обоснование в `docs/14-state.md`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ServerConfig } from "../config.js";
import type { Db } from "../db/driver.js";
import { matchApi } from "./router.js";
import * as handlers from "./handlers.js";
import type { Context, HandlerResult } from "./handlers.js";

export interface CreateOptions {
  db: Db;
  config: ServerConfig;
  version: string;
}

async function readBody(request: IncomingMessage, limit: number): Promise<unknown | "too_large" | "invalid"> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) return "too_large";
    chunks.push(buffer);
  }

  if (!size) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return "invalid";
  }
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

async function dispatch(context: Context, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  const route = matchApi(method, url.pathname);
  if (route === null) {
    sendJson(response, handlers.fail(404, "not_found"));
    return;
  }
  if (route === "method_not_allowed") {
    sendJson(response, handlers.fail(405, "method_not_allowed"));
    return;
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

  const { name, params } = route;
  switch (name) {
    case "health":
      sendJson(response, handlers.health(context));
      return;
    case "createProfile":
      sendJson(response, handlers.createProfile(context, body));
      return;
    case "pageState":
      sendJson(response, handlers.pageState(context, params));
      return;
    case "submitPortion":
      sendJson(response, handlers.submitPortion(context, params, body));
      return;
    case "editAnswer":
      sendJson(response, handlers.editAnswer(context, params, body));
      return;
    case "disagree":
      sendJson(response, handlers.disagree(context, params, body));
      return;
    case "purchase":
      sendJson(response, handlers.purchase(context, params, body));
      return;
    case "generationStatus":
      sendJson(response, handlers.generationStatus(context, params));
      return;
  }
}

export function createHttpServer(options: CreateOptions): Server {
  const context: Context = {
    db: options.db,
    config: options.config,
    version: options.version,
    startedAt: Date.now(),
  };

  return createServer((request, response) => {
    dispatch(context, request, response).catch((error: unknown) => {
      // В журнал уходит только машинный код: ни имён, ни ответов (docs/12, слой 7).
      process.stderr.write(
        `${JSON.stringify({ event: "request.failed", reason: error instanceof Error ? error.name : "unknown" })}\n`,
      );
      if (!response.headersSent) sendJson(response, handlers.fail(500, "internal_error"));
      else response.end();
    });
  });
}
