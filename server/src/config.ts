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

import { buildKeyring, KeyError, type Keyring } from "./db/crypto.js";
import type { RateRules } from "./http/rate-limit.js";

export type Environment = "development" | "production";

/**
 * Настройки оплаты. Провайдер выбирается по имени: реальный адаптер добавится
 * одним модулем, когда основатель назовёт провайдера (`docs/14-state.md`).
 */
export interface PaymentConfig {
  /** Имя провайдера в реестре `server/src/payments/`. */
  provider: string;
  /** Секрет для проверки подписи уведомлений. */
  webhookSecret: string;
}

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
  payments: PaymentConfig;
  /**
   * Ключи шифрования чувствительных полей. Пустая связка означает открытое
   * хранение и в рабочем окружении невозможна.
   */
  keys: Keyring;
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
  /** Поддельный провайдер: единственный, который есть в репозитории. */
  paymentProvider: "fake",
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
 *
 * `SDAI_PUBLIC_ORIGIN` — без него постоянная и публичная ссылки относительные,
 * то есть непригодные для отправки другому человеку.
 * `SDAI_ENCRYPTION_KEY` — без него чувствительные поля лягут открытым текстом.
 * `SDAI_PAYMENT_WEBHOOK_SECRET` — без него подпись уведомлений не проверяется.
 */
const REQUIRED_IN_PRODUCTION = ["SDAI_PUBLIC_ORIGIN", "SDAI_ENCRYPTION_KEY", "SDAI_PAYMENT_WEBHOOK_SECRET"] as const;

/**
 * Поддельный провайдер и рабочее окружение несовместимы (E8-09).
 *
 * Проверка стоит в конфигурации, а не в коде оплаты: включить тестовые платежи
 * на рабочем домене нельзя не потому, что кто-то не забыл проверить флаг, а
 * потому, что с таким сочетанием переменных сервер не стартует.
 */
export const FAKE_PROVIDER = "fake";

function readPayments(env: NodeJS.ProcessEnv, environment: Environment): PaymentConfig {
  const provider = env["SDAI_PAYMENT_PROVIDER"] || DEFAULTS.paymentProvider;

  if (environment === "production" && provider === FAKE_PROVIDER) {
    throw new ConfigError(["SDAI_PAYMENT_PROVIDER"], "fake-provider-forbidden-in-production");
  }

  return { provider, webhookSecret: env["SDAI_PAYMENT_WEBHOOK_SECRET"] ?? "" };
}

function readKeys(env: NodeJS.ProcessEnv): Keyring {
  const active = env["SDAI_ENCRYPTION_KEY"] || null;
  const retired = (env["SDAI_ENCRYPTION_KEYS_RETIRED"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  try {
    return buildKeyring(active, retired);
  } catch (error) {
    if (error instanceof KeyError) {
      const variable = error.message.includes("retired") ? "SDAI_ENCRYPTION_KEYS_RETIRED" : "SDAI_ENCRYPTION_KEY";
      throw new ConfigError([variable], error.message.replace("encryption-key:", ""));
    }
    throw error;
  }
}

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
    payments: readPayments(env, environment),
    keys: readKeys(env),
  };
}
