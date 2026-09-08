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

import { readFileSync } from "node:fs";
import { buildKeyring, KeyError, type Keyring } from "./db/crypto.js";
import type { RateRules } from "./http/rate-limit.js";

/**
 * Окружения (E10-01). Их три, и разница между ними — в требованиях, а не в коде:
 *
 * `development`  — своя машина, значений по умолчанию хватает, ключей нет;
 * `staging`      — предварительное окружение: те же обязательные переменные,
 *                  что в рабочем, но платежи разрешено проводить поддельным
 *                  провайдером;
 * `production`   — рабочее: поддельный провайдер запрещён совсем.
 *
 * Раздельность данных держится обязательным `SDAI_DB_PATH`: и рабочее, и
 * предварительное окружения называют файл базы явно, поэтому «случайно один и
 * тот же файл по умолчанию» невозможно.
 */
export type Environment = "development" | "staging" | "production";

/** Окружения, в которых сервер требует полного набора переменных. */
const DEPLOYED: Environment[] = ["staging", "production"];

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

/**
 * Версия сборки (E10-03). Отдаётся в ответе `GET /api/health`, поэтому по ней
 * видно, что именно сейчас развёрнуто, и есть чему сопоставлять откат.
 * Персональных данных здесь нет и быть не может: три технических поля.
 */
export interface BuildInfo {
  /** Тег или номер выпуска. По умолчанию — версия из `package.json`. */
  version: string;
  /** Коммит, из которого собрано. `unknown` — сборка вне конвейера. */
  commit: string;
  /** Время сборки в ISO-8601 или null, если сборка его не записала. */
  builtAt: string | null;
}

/**
 * Приёмник ошибок (E10-06). Имя выбирается по реестру
 * `server/src/observability/registry.ts`: пока известно одно значение `fake`.
 */
export interface ErrorsConfig {
  /** Имя приёмника в реестре. */
  tracker: string;
  /**
   * Файл JSONL для поддельного приёмника. Пусто — только память процесса.
   * В рабочем окружении не обязателен: поддельный приёмник без файла не теряет
   * процесс, а внешний сервис ещё не назван.
   */
  path: string;
}

/** Резервные копии (E10-05). Расписание задаёт таймер, а не сервер. */
export interface BackupConfig {
  /**
   * Каталог для копий. В рабочем окружении обязателен и должен лежать вне
   * каталога выпуска: выпуск заменяется при деплое, копии — нет.
   */
  directory: string;
  /** Срок хранения копии в сутках. Более старые удаляет `backup prune`. */
  keepDays: number;
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
  build: BuildInfo;
  backup: BackupConfig;
  errors: ErrorsConfig;
  /**
   * Секрет служебных ручек воронки и метрик (E10-07, E10-08).
   * Пустой — ручки отвечают отказом: в разработке сервер поднимается без него.
   */
  adminSecret: string;
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
  /** Поддельный приёмник: единственный, который есть в репозитории. */
  errorTracker: "fake",
  backupDirectory: "server/.backups",
  /**
   * Срок хранения копий. Две недели — столько, чтобы порча данных, замеченная
   * не сразу, ещё имела копию «до»; больше держать на той же машине незачем.
   */
  backupKeepDays: 14,
  /** Окна подобраны под живой сценарий: порция — минута, создание профиля — час. */
  rate: {
    createProfile: { limit: 20, windowMs: 60 * 60 * 1000 },
    portion: { limit: 60, windowMs: 60 * 1000 },
    state: { limit: 120, windowMs: 60 * 1000 },
    miss: { limit: 20, windowMs: 60 * 1000 },
    /** Клиентские ошибки: хватает на падение страницы, не хватает на залив. */
    errors: { limit: 30, windowMs: 60 * 1000 },
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
  if (raw === "development" || raw === "staging" || raw === "production") return raw;
  throw new ConfigError(["SDAI_ENV"], "expected-development-staging-or-production");
}

/**
 * Переменные, без которых развёрнутое окружение работает неправильно.
 *
 * `SDAI_PUBLIC_ORIGIN` — без него постоянная и публичная ссылки относительные,
 * то есть непригодные для отправки другому человеку.
 * `SDAI_ENCRYPTION_KEY` — без него чувствительные поля лягут открытым текстом.
 * `SDAI_PAYMENT_WEBHOOK_SECRET` — без него подпись уведомлений не проверяется.
 * `SDAI_DB_PATH` — путь по умолчанию лежит внутри каталога выпуска: при деплое
 * он заменяется, а два окружения на одной машине делят один файл.
 * `SDAI_BACKUP_DIR` — то же про копии: копия внутри выпуска исчезает с ним.
 */
const REQUIRED_IN_DEPLOYED = [
  "SDAI_PUBLIC_ORIGIN",
  "SDAI_ENCRYPTION_KEY",
  "SDAI_PAYMENT_WEBHOOK_SECRET",
  "SDAI_DB_PATH",
  "SDAI_BACKUP_DIR",
] as const;

/** Версия из `package.json`: она же значение по умолчанию для версии сборки. */
function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readBuild(env: NodeJS.ProcessEnv): BuildInfo {
  return {
    version: env["SDAI_BUILD_VERSION"] || packageVersion(),
    commit: env["SDAI_BUILD_COMMIT"] || "unknown",
    builtAt: env["SDAI_BUILD_AT"] || null,
  };
}

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

  if (DEPLOYED.includes(environment)) {
    const missing = REQUIRED_IN_DEPLOYED.filter((variable) => !env[variable]);
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
        errors: {
          limit: readInteger(env, "SDAI_RATE_ERROR", DEFAULTS.rate.errors.limit),
          windowMs: DEFAULTS.rate.errors.windowMs,
        },
      },
    },
    payments: readPayments(env, environment),
    keys: readKeys(env),
    build: readBuild(env),
    backup: {
      directory: env["SDAI_BACKUP_DIR"] || DEFAULTS.backupDirectory,
      keepDays: readInteger(env, "SDAI_BACKUP_KEEP_DAYS", DEFAULTS.backupKeepDays),
    },
    errors: {
      tracker: env["SDAI_ERROR_TRACKER"] || DEFAULTS.errorTracker,
      path: env["SDAI_ERROR_TRACKER_PATH"] || "",
    },
    adminSecret: env["SDAI_ADMIN_SECRET"] || "",
  };
}
