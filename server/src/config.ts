/**
 * Настройки сервера. Все — из переменных окружения, значений по умолчанию для
 * секретов нет и самих секретов пока нет: сервер их не требует.
 *
 * Список переменных с описаниями — `.env.example`.
 */

export interface ServerConfig {
  host: string;
  port: number;
  /** Файл базы. Каталог создаётся при старте, если его нет. */
  databasePath: string;
  /** Применять непринятые миграции при старте. В разработке — да. */
  autoMigrate: boolean;
  /**
   * Внешний адрес сервиса для постоянных ссылок. Пусто — ссылка отдаётся
   * относительной: домен ещё не выбран (открытый вопрос 4).
   */
  publicOrigin: string;
  /** Предел размера тела запроса в байтах. */
  maxBodyBytes: number;
}

export const DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  databasePath: "server/.data/app.db",
  autoMigrate: true,
  publicOrigin: "",
  maxBodyBytes: 65_536,
} as const;

class ConfigError extends Error {
  constructor(variable: string, reason: string) {
    super(`config:${variable}:${reason}`);
    this.name = "ConfigError";
  }
}

function readInteger(env: NodeJS.ProcessEnv, variable: string, fallback: number): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(variable, "expected-positive-integer");
  return value;
}

function readBoolean(env: NodeJS.ProcessEnv, variable: string, fallback: boolean): boolean {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new ConfigError(variable, "expected-boolean");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env["SDAI_HOST"] || DEFAULTS.host,
    port: readInteger(env, "SDAI_PORT", DEFAULTS.port),
    databasePath: env["SDAI_DB_PATH"] || DEFAULTS.databasePath,
    autoMigrate: readBoolean(env, "SDAI_DB_AUTO_MIGRATE", DEFAULTS.autoMigrate),
    publicOrigin: (env["SDAI_PUBLIC_ORIGIN"] || DEFAULTS.publicOrigin).replace(/\/+$/, ""),
    maxBodyBytes: readInteger(env, "SDAI_MAX_BODY_BYTES", DEFAULTS.maxBodyBytes),
  };
}
