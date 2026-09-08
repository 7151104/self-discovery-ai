#!/usr/bin/env node
/**
 * Внешняя проверка доступности (E10-09).
 *
 * Дергает GET /api/health. Код возврата — единственный сигнал:
 *   0 — сервис отвечает, status=ok, база ok, версия сборки на месте;
 *   1 — отказ, таймаут, не-ok или база недоступна.
 *
 * Адрес: аргумент, иначе SDAI_HEALTH_URL, иначе http://127.0.0.1:$SDAI_PORT/api/health.
 * Таймер systemd и конвейер вызывают эту же команду.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const DEFAULT_TIMEOUT_MS = 5_000;

export function resolveHealthUrl(env = process.env, argv = process.argv.slice(2)) {
  if (argv[0]) return argv[0];
  if (env.SDAI_HEALTH_URL) return env.SDAI_HEALTH_URL;
  const port = env.SDAI_PORT || "8787";
  const host = env.SDAI_HOST || "127.0.0.1";
  return `http://${host}:${port}/api/health`;
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, version: string, commit: string } | { ok: false, reason: string }>}
 */
export async function checkHealth(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    return { ok: false, reason: `${url} ${reason}` };
  }

  if (response.status !== 200) return { ok: false, reason: `${url} HTTP ${response.status}` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: `${url} тело не JSON` };
  }

  if (!body || typeof body !== "object") return { ok: false, reason: `${url} тело пустое` };
  if (body.status !== "ok") return { ok: false, reason: `${url} status=${String(body.status)}` };
  if (body.database !== "ok") return { ok: false, reason: `${url} database=${String(body.database)}` };
  if (typeof body.version !== "string" || !body.version) return { ok: false, reason: `${url} нет версии сборки` };

  return { ok: true, version: body.version, commit: body.build?.commit ?? "unknown" };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const url = resolveHealthUrl();
  const timeoutMs = Number(process.env.SDAI_HEALTH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const result = await checkHealth(url, { timeoutMs });
  if (!result.ok) {
    process.stderr.write(`недоступно: ${result.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`доступно version=${result.version} commit=${result.commit}\n`);
  process.exit(0);
}
