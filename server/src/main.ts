/**
 * Точка входа: `npm run dev:server`.
 *
 * Внешних сервисов не поднимает и демонов не требует: база — файл, который
 * создаётся при первом старте, миграции применяются сами.
 */

import { ConfigError, loadConfig, type ServerConfig } from "./config.js";
import type { Db } from "./db/driver.js";
import { openDatabase } from "./db/sqlite.js";
import { checkMigrations, MigrationError, reportProblems, up } from "./db/migrate.js";
import { createHttpServer } from "./http/server.js";
import { log } from "./log.js";

/**
 * Без обязательной переменной сервер не стартует и называет её. Значение
 * переменной в вывод не попадает: в журнале только имя и причина.
 */
function configure(): ServerConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(
        `${JSON.stringify({ event: "config.invalid", reason: error.reason, variables: error.variables })}\n`,
      );
      process.exit(1);
    }
    throw error;
  }
}

const config = configure();
const db = openDatabase({ path: config.databasePath, keys: config.keys });

if (!config.keys.active) {
  // Разработка без ключа: чувствительные поля лягут открытым текстом.
  // В рабочем окружении сюда не попасть — там ключ обязателен.
  log("encryption.disabled", { environment: config.environment });
}

/**
 * Миграции при запуске (E10-04). Несовместимая миграция не даёт стартовать:
 * сервер на схеме, которая не совпадает с репозиторием, хуже остановленного —
 * он тихо пишет данные не туда.
 *
 * Автоматическое применение выключено — проверка всё равно проходит: применять
 * вручную можно, работать на изменённом файле применённой миграции нельзя.
 */
function migrateOrRefuse(database: Db, settings: ServerConfig): void {
  try {
    if (settings.autoMigrate) {
      const applied = up(database);
      if (applied.length) log("migrate.up", { versions: applied.join(",") });
      return;
    }
    const problems = checkMigrations(database);
    if (problems.length) throw new MigrationError(problems);
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    reportProblems(error.problems);
    process.exit(1);
  }
}

migrateOrRefuse(db, config);

const server = createHttpServer({ db, config });

server.listen(config.port, config.host, () => {
  log("server.started", {
    environment: config.environment,
    host: config.host,
    port: config.port,
    database: config.databasePath,
    rateLimit: config.rateLimit.enabled,
    payments: config.payments.provider,
    encryption: config.keys.active?.id ?? "off",
    // Версия сборки в первой же строке журнала: по ней видно, что развёрнуто.
    version: config.build.version,
    commit: config.build.commit,
  });
});

const shutdown = (signal: string): void => {
  log("server.stopping", { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
