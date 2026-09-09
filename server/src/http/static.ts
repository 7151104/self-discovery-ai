/**
 * Отдача файлов клиента из `web/dist` (E7-13).
 *
 * Префикс `/web/` совпадает с раскладкой сборки: `/web/src/app.js` — это
 * `web/dist/src/app.js`, поэтому относительные импорты модулей (`../components/…`)
 * разрешаются тем же деревом. Имена файлов не хешируем: без сборщика нельзя
 * переписать спецификаторы импорта. Свежесть держит ETag по содержимому.
 *
 * Путь нормализуется и сверяется с корнем `web/dist`. Выход за этот каталог
 * невозможен: такой запрос неотличим от отсутствующего файла.
 */

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Публичный префикс. Совпадает с каталогом `web/` в URL витрины, но указывает на `dist`. */
export const STATIC_PREFIX = "/web/";

/** Точка входа живого клиента. */
export const CLIENT_SCRIPT = "/web/src/app.js";

/** Собранная таблица стилей продукта. */
export const CLIENT_STYLE = "/web/app.css";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
};

export interface StaticResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
}

/** Корень `web/dist` от собранного файла, а не от cwd. */
export function webDistRoot(): string {
  return resolve(fileURLToPath(new URL("../../../web/dist", import.meta.url)));
}

/** Запрос к статике клиента, а не к API. */
export function isStaticRequest(pathname: string): boolean {
  return pathname === "/web" || pathname.startsWith(STATIC_PREFIX);
}

/**
 * Нормализует путь внутри `root`. `null` — выход за корень, пустой путь
 * или каталог: такие запросы не читаем.
 */
export function resolvePublicFile(pathname: string, root: string): string | null {
  if (!pathname.startsWith(STATIC_PREFIX)) return null;

  let rest = pathname.slice(STATIC_PREFIX.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }

  if (!rest || rest.includes("\0") || rest.endsWith("/")) return null;

  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, rest);
  if (!inside(rootResolved, candidate)) return null;
  return candidate;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (rel === "") return false;
  if (isAbsolute(rel)) return false;
  if (rel === "..") return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return true;
}

const etagOf = (body: Buffer): string => `"${createHash("sha256").update(body).digest("hex")}"`;

function ifNoneMatch(headers: IncomingHttpHeaders, etag: string): boolean {
  const raw = headers["if-none-match"];
  if (raw === undefined) return false;
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  if (value.trim() === "*") return true;
  return value.split(",").some((part) => part.trim() === etag);
}

const notFound = (): StaticResult => ({
  status: 404,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  body: "",
});

/**
 * Читает файл из `web/dist`. Не статический путь — `null`, чтобы маршрутизатор
 * шёл дальше. Обход и отсутствие файла — одинаковый 404.
 */
export async function serveStatic(
  pathname: string,
  headers: IncomingHttpHeaders,
  root: string = webDistRoot(),
): Promise<StaticResult | null> {
  if (!isStaticRequest(pathname)) return null;

  const target = resolvePublicFile(pathname, root);
  if (target === null) return notFound();

  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await realpath(root);
    const info = await stat(target);
    if (!info.isFile()) return notFound();
    realFile = await realpath(target);
  } catch {
    return notFound();
  }

  if (!inside(realRoot, realFile)) return notFound();

  const body = await readFile(realFile);
  const type = TYPES[extname(realFile)] ?? "application/octet-stream";
  const etag = etagOf(body);
  const headersOut: Record<string, string> = {
    "content-type": type,
    etag,
    "cache-control": "public, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
  };

  if (ifNoneMatch(headers, etag)) {
    return { status: 304, headers: headersOut, body: "" };
  }

  return { status: 200, headers: headersOut, body };
}
