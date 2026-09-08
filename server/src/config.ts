/**
 * Настройки сервера. Все — из переменных окружения; значений по умолчанию для
 * секретов нет, самих секретов сервер пока не требует.
 *
 * Обязательность зависит от окружения: в разработке достаточно значений по
 * умолчанию, в рабочем окружении сервер отказывается стартовать без переменных,
 * без которых он работает неправильно, и называет их поимённо.
 *
 * Список переменных с описаниями — `.env.example`.
 */

import type { RateRules } from "./http/rate-limit.js";

export type Environment = "development" | "production";

export interface ServerConfig {
  environment: Environment;
  host: string;
  port: number;
  /** Файл базы. Каталог создаётся при старте, если его нет. */
  databasePath: string;
  /** Применять непринятые миграции при старте. В разработке — да. */
  autoMigrate: boolean;
  /**
   * Внешний адрес сервиса для постоянных и публичных ссылок. Пусто — ссылки
   * отдаются относительными; в рабочем окружении переменная обязательна.
   */
  publicOrigin: string;
  /** Предел размера тела запроса в байтах. */
  maxBodyBytes: number;
  /** Брать адрес клиента из заголовка `x-forwarded-for`. Только за своим прокси. */
  trustProxy: boolean;
  rateLimit: { enabled: boolean; rules: RateRules };
}

export const DEFAULTS = {
  environment: "development" as Environment,
  host: "127.0.0.1",
  port: 8787,
  databasePath: "server/.data/app.db",
  autoMigrate: true,
  publicOrigin: "",
  maxBodyBytes: 65_536,
  trustProxy: false,
  rateLimitEnabled: true,
  /** Окна подобраны под живой сценарий: порция — минута, создание профиля — час. */
  rate: {
    createProfile: { limit: 20, windowMs: 60 * 60 * 1000 },
    portion: { limit: 60, windowMs: 60 * 1000 },
    state: { limit: 120, windowMs: 60 * 1000 },
    miss: { limit: 20, windowMs: 60 * 1000 },
  } satisfies RateRules,
} as const;

/**
 * Отказ конфигурации. В сообщении только имя переменной и причина: значений
 * переменных в журнале быть не должно.
 */
export class ConfigError extends Error {
  constructor(readonly variables: string[], readonly reason: string) {
    super(`config:${reason}:${variables.join(",")}`);
    this.name = "ConfigError";
  }
}

function readInteger(env: NodeJS.ProcessEnv, variable: string, fallback: number): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError([variable], "expected-positive-integer");
  return value;
}

function readBoolean(env: NodeJS.ProcessEnv, variable: string, fallback: boolean): boolean {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new ConfigError([variable], "expected-boolean");
}

function readEnvironment(env: NodeJS.ProcessEnv): Environment {
  const raw = env["SDAI_ENV"];
  if (raw === undefined || raw === "") return DEFAULTS.environment;
  if (raw === "development" || raw === "production") return raw;
  throw new ConfigError(["SDAI_ENV"], "expected-development-or-production");
}

/**
 * Переменные, без которых рабочее окружение работает неправильно.
 * Без `SDAI_PUBLIC_ORIGIN` постоянная и публичная ссылки отдаются
 * относительными, то есть непригодными для отправки другому человеку.
 */
const REQUIRED_IN_PRODUCTION = ["SDAI_PUBLIC_ORIGIN"] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const environment = readEnvironment(env);

  if (environment === "production") {
    const missing = REQUIRED_IN_PRODUCTION.filter((variable) => !env[variable]);
    if (missing.length) throw new ConfigError([...missing], "missing-required");
  }

  return {
    environment,
    host: env["SDAI_HOST"] || DEFAULTS.host,
    port: readInteger(env, "SDAI_PORT", DEFAULTS.port),
    databasePath: env["SDAI_DB_PATH"] || DEFAULTS.databasePath,
    autoMigrate: readBoolean(env, "SDAI_DB_AUTO_MIGRATE", DEFAULTS.autoMigrate),
    publicOrigin: (env["SDAI_PUBLIC_ORIGIN"] || DEFAULTS.publicOrigin).replace(/\/+$/, ""),
    maxBodyBytes: readInteger(env, "SDAI_MAX_BODY_BYTES", DEFAULTS.maxBodyBytes),
    trustProxy: readBoolean(env, "SDAI_TRUST_PROXY", DEFAULTS.trustProxy),
    rateLimit: {
      enabled: readBoolean(env, "SDAI_RATE_LIMIT", DEFAULTS.rateLimitEnabled),
      rules: {
        createProfile: {
          limit: readInteger(env, "SDAI_RATE_CREATE_PROFILE", DEFAULTS.rate.createProfile.limit),
          windowMs: DEFAULTS.rate.createProfile.windowMs,
        },
        portion: {
          limit: readInteger(env, "SDAI_RATE_PORTION", DEFAULTS.rate.portion.limit),
          windowMs: DEFAULTS.rate.portion.windowMs,
        },
        state: {
          limit: readInteger(env, "SDAI_RATE_STATE", DEFAULTS.rate.state.limit),
          windowMs: DEFAULTS.rate.state.windowMs,
        },
        miss: {
          limit: readInteger(env, "SDAI_RATE_MISS", DEFAULTS.rate.miss.limit),
          windowMs: DEFAULTS.rate.miss.windowMs,
        },
      },
    },
  };
}
