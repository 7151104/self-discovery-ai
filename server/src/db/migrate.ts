/**
 * Миграции вперёд и назад.
 *
 * Каждая миграция — пара файлов `NNNN_имя.up.sql` и `NNNN_имя.down.sql` в
 * `server/migrations/`. Пара обязательна: миграция без отката не применяется.
 * Применённые записываются в `schema_migrations`, там же остаётся отпечаток
 * файла — правка уже применённой миграции обнаруживается, а не проходит молча.
 *
 * Командная строка: `npm run migrate -- up | down | status | reset`.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Db } from "./driver.js";

/** Каталог с миграциями. Путь одинаков и из `src`, и из собранного `dist`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export interface Migration {
  /** Номер строкой, как в имени файла: '0001'. */
  version: string;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

const FILE_PATTERN = /^(\d{4})_([a-z0-9-]+)\.(up|down)\.sql$/;

export function readMigrations(directory: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(directory).filter((file) => FILE_PATTERN.test(file)).sort();
  const found = new Map<string, { name: string; up?: string; down?: string }>();

  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    const [, version = "", name = "", side = ""] = match;
    const entry = found.get(version) ?? { name };
    const sql = readFileSync(join(directory, file), "utf8");
    if (side === "up") entry.up = sql;
    else entry.down = sql;
    found.set(version, entry);
  }

  return [...found.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, entry]) => {
      if (entry.up === undefined) throw new Error(`migration-without-up:${version}`);
      if (entry.down === undefined) throw new Error(`migration-without-down:${version}`);
      return {
        version,
        name: entry.name,
        up: entry.up,
        down: entry.down,
        checksum: createHash("sha256").update(entry.up).digest("hex").slice(0, 16),
      };
    });
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: string;
}

function applied(db: Db): AppliedRow[] {
  db.exec(LEDGER);
  return db.all<AppliedRow>("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version");
}

export interface MigrationStatus {
  version: string;
  name: string;
  state: "applied" | "pending" | "changed";
}

export function status(db: Db, migrations: Migration[] = readMigrations()): MigrationStatus[] {
  const rows = new Map(applied(db).map((row) => [row.version, row]));
  return migrations.map((migration) => {
    const row = rows.get(migration.version);
    const state: MigrationStatus["state"] =
      row === undefined ? "pending" : row.checksum === migration.checksum ? "applied" : "changed";
    return { version: migration.version, name: migration.name, state };
  });
}

/** Номер последней применённой миграции или null. */
export function schemaVersion(db: Db): string | null {
  const rows = applied(db);
  return rows.length ? (rows[rows.length - 1]?.version ?? null) : null;
}

/** Применяет непринятые миграции. Возвращает применённые номера. */
export function up(db: Db, migrations: Migration[] = readMigrations()): string[] {
  const rows = new Map(applied(db).map((row) => [row.version, row]));
  const done: string[] = [];

  for (const migration of migrations) {
    const row = rows.get(migration.version);
    if (row) {
      if (row.checksum !== migration.checksum) throw new Error(`migration-changed:${migration.version}`);
      continue;
    }
    db.transaction(() => {
      db.exec(migration.up);
      db.run("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)", [
        migration.version,
        migration.name,
        migration.checksum,
        new Date().toISOString(),
      ]);
    });
    done.push(migration.version);
  }

  return done;
}

/** Откатывает последние `steps` миграций. Возвращает откаченные номера. */
export function down(db: Db, steps = 1, migrations: Migration[] = readMigrations()): string[] {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const rows = applied(db).reverse().slice(0, steps);
  const done: string[] = [];

  for (const row of rows) {
    const migration = byVersion.get(row.version);
    if (!migration) throw new Error(`migration-file-missing:${row.version}`);
    db.transaction(() => {
      db.exec(migration.down);
      db.run("DELETE FROM schema_migrations WHERE version = ?", [migration.version]);
    });
    done.push(migration.version);
  }

  return done;
}

/** Пустая база с нуля: откатить всё и применить заново. */
export function reset(db: Db, migrations: Migration[] = readMigrations()): void {
  down(db, migrations.length, migrations);
  up(db, migrations);
}

async function main(): Promise<void> {
  const { loadConfig } = await import("../config.js");
  const { openDatabase } = await import("./sqlite.js");

  const command = process.argv[2] ?? "up";
  const stepsArg = process.argv.find((argument) => argument.startsWith("--steps="));
  const steps = stepsArg ? Number(stepsArg.slice("--steps=".length)) : 1;

  const config = loadConfig();
  const db = openDatabase({ path: config.databasePath });

  try {
    if (command === "up") report("migrate.up", up(db));
    else if (command === "down") report("migrate.down", down(db, steps));
    else if (command === "reset") {
      reset(db);
      report("migrate.reset", [schemaVersion(db) ?? ""]);
    } else if (command === "status") {
      process.stdout.write(`${JSON.stringify({ event: "migrate.status", migrations: status(db) })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ event: "migrate.error", code: "unknown-command", command })}\n`);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

function report(event: string, versions: string[]): void {
  process.stdout.write(`${JSON.stringify({ event, versions })}\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
