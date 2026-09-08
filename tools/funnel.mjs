#!/usr/bin/env node
/**
 * Служебный экран воронки и метрик (E10-07, E10-08).
 *
 * Дергает GET /api/admin/funnel и /api/admin/metrics за секретом
 * SDAI_ADMIN_SECRET и печатает две таблицы в терминал. Клиентский код
 * не импортирует этот файл.
 *
 * Адрес: аргумент, иначе SDAI_ADMIN_ORIGIN, иначе http://127.0.0.1:$SDAI_PORT.
 * Код возврата: 0 — обе ручки ответили; 1 — отказ, таймаут, нет секрета.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const DEFAULT_TIMEOUT_MS = 5_000;

export function resolveAdminOrigin(env = process.env, argv = process.argv.slice(2)) {
  if (argv[0]) return argv[0].replace(/\/+$/, "");
  if (env.SDAI_ADMIN_ORIGIN) return env.SDAI_ADMIN_ORIGIN.replace(/\/+$/, "");
  const port = env.SDAI_PORT || "8787";
  const host = env.SDAI_HOST || "127.0.0.1";
  return `http://${host}:${port}`;
}

/**
 * @param {unknown} body
 * @returns {string}
 */
export function formatFunnel(body) {
  if (!body || typeof body !== "object") return "воронка: пусто\n";
  const snapshot = /** @type {{ version?: string, stages?: { id: string, event: string, events: number, profiles: number }[] }} */ (
    body
  );
  const lines = [`воронка version=${snapshot.version ?? "unknown"}`, "id\tevent\tevents\tprofiles"];
  for (const stage of snapshot.stages ?? []) {
    lines.push(`${stage.id}\t${stage.event}\t${stage.events}\t${stage.profiles}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @param {unknown} body
 * @returns {string}
 */
export function formatMetrics(body) {
  if (!body || typeof body !== "object") return "метрики: пусто\n";
  const snapshot = /** @type {{
    version?: string,
    generation?: { avgDurationMs: number | null, totalCostKopecks: number, calls: number },
    profileCost?: { avgKopecks: number | null, profiles: number },
    validator?: { rejectionRate: number | null, rejected: number, jobs: number },
  }} */ (body);
  const generation = snapshot.generation ?? {};
  const profileCost = snapshot.profileCost ?? {};
  const validator = snapshot.validator ?? {};
  const rate = validator.rejectionRate == null ? "none" : String(validator.rejectionRate);
  return [
    `метрики version=${snapshot.version ?? "unknown"}`,
    `avgDurationMs=${generation.avgDurationMs ?? "none"} calls=${generation.calls ?? 0} totalCostKopecks=${generation.totalCostKopecks ?? 0}`,
    `profileCost=${profileCost.avgKopecks ?? "none"} profiles=${profileCost.profiles ?? 0}`,
    `rejectionRate=${rate} rejected=${validator.rejected ?? 0} jobs=${validator.jobs ?? 0}`,
    "",
  ].join("\n");
}

/**
 * @param {string} origin
 * @param {string} secret
 * @param {{ timeoutMs?: number }} [options]
 */
export async function fetchAdmin(origin, secret, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = { accept: "application/json", authorization: `Bearer ${secret}` };

  /** @param {string} path */
  const once = async (path) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(`${origin}${path}`, { signal, headers });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      return { ok: false, reason: `${path} ${reason}` };
    }
    if (response.status !== 200) return { ok: false, reason: `${path} HTTP ${response.status}` };
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: false, reason: `${path} not-json` };
    }
  };

  const funnel = await once("/api/admin/funnel");
  if (!funnel.ok) return funnel;
  const metrics = await once("/api/admin/metrics");
  if (!metrics.ok) return metrics;
  return { ok: true, funnel: funnel.body, metrics: metrics.body };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const secret = process.env.SDAI_ADMIN_SECRET || "";
  if (!secret) {
    process.stderr.write("нет SDAI_ADMIN_SECRET\n");
    process.exit(1);
  }
  const origin = resolveAdminOrigin();
  const timeoutMs = Number(process.env.SDAI_ADMIN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const result = await fetchAdmin(origin, secret, { timeoutMs });
  if (!result.ok) {
    process.stderr.write(`отказ: ${result.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(formatFunnel(result.funnel));
  process.stdout.write("\n");
  process.stdout.write(formatMetrics(result.metrics));
  process.exit(0);
}
