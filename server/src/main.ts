/**
 * Точка входа: `npm run dev:server`.
 *
 * Внешних сервисов не поднимает и демонов не требует: база — файл, который
 * создаётся при первом старте, миграции применяются сами.
 */

import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { up } from "./db/migrate.js";
import { createHttpServer } from "./http/server.js";

const log = (event: string, fields: Record<string, string | number | boolean> = {}): void => {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
};

function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const config = loadConfig();
const db = openDatabase({ path: config.databasePath });

if (config.autoMigrate) {
  const applied = up(db);
  if (applied.length) log("migrate.up", { versions: applied.join(",") });
}

const server = createHttpServer({ db, config, version: packageVersion() });

server.listen(config.port, config.host, () => {
  log("server.started", { host: config.host, port: config.port, database: config.databasePath });
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
