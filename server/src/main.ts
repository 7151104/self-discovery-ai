/**
 * Точка входа: `npm run dev:server`.
 *
 * Внешних сервисов не поднимает и демонов не требует: база — файл, который
 * создаётся при первом старте, миграции применяются сами.
 */

import { readFileSync } from "node:fs";
import { ConfigError, loadConfig, type ServerConfig } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { up } from "./db/migrate.js";
import { createHttpServer } from "./http/server.js";
import { log } from "./log.js";

function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

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

if (config.autoMigrate) {
  const applied = up(db);
  if (applied.length) log("migrate.up", { versions: applied.join(",") });
}

const server = createHttpServer({ db, config, version: packageVersion() });

server.listen(config.port, config.host, () => {
  log("server.started", {
    environment: config.environment,
    host: config.host,
    port: config.port,
    database: config.databasePath,
    rateLimit: config.rateLimit.enabled,
    payments: config.payments.provider,
    encryption: config.keys.active?.id ?? "off",
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
