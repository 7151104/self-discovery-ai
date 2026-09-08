/**
 * Миграции вперёд и назад.
 *
 * Каждая миграция — пара файлов `NNNN_имя.up.sql` и `NNNN_имя.down.sql` в
 * `server/migrations/`. Пара обязательна: миграция без отката не применяется.
 * Применённые записываются в `schema_migrations`, там же остаётся отпечаток
 * файла — правка уже применённой миграции обнаруживается, а не проходит молча.
 *
 * Совместимость проверяется до применения (E10-04): несовместимую миграцию
 * останавливает `migrate -- check` в конвейере и она же не даёт серверу
 * стартовать. Что считается несовместимым — перечислено в `MigrationProblem`.
 *
 * Командная строка: `npm run migrate -- up | down | status | reset | check`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/**
 * Чем миграция бывает несовместима. Код машинный: он уходит в журнал и в
 * сообщение об отказе. Пояснение для человека — в `problemHint`.
 */
export type MigrationProblemCode =
  /** Нет файла `.up.sql`: применять нечего. */
  | "without-up"
  /** Нет файла `.down.sql`: без отката миграция не применяется. */
  | "without-down"
  /** Файл пустой. */
  | "empty-sql"
  /** Имя файла не по образцу: такой файл молча не применится. */
  | "bad-file-name"
  /** Один номер у двух разных миграций: порядок неоднозначен. */
  | "duplicate-version"
  /** Номера идут не подряд: пропуск или сдвиг. */
  | "version-gap"
  /** Файл уже применённой миграции изменён. */
  | "changed"
  /** Миграция применена, а её файлов в репозитории нет. */
  | "file-missing"
  /** Применена миграция с номером старше непринятой. */
  | "applied-out-of-order";

export interface MigrationProblem {
  code: MigrationProblemCode;
  /** Номер миграции; пусто, когда проблема относится к отдельному файлу. */
  version: string;
  /** Имя файла или список имён; пусто, когда проблема относится к номеру. */
  file: string;
}

const HINTS: Record<MigrationProblemCode, string> = {
  "without-up": "нет файла .up.sql — применять нечего",
  "without-down": "нет файла .down.sql — миграция без отката не применяется",
  "empty-sql": "файл пустой — миграция должна что-то менять",
  "bad-file-name": "имя не по образцу NNNN_имя.up.sql — такой файл молча не применится",
  "duplicate-version": "номер занят двумя миграциями — порядок применения неоднозначен",
  "version-gap": "номера идут не подряд — пропуск или сдвиг ломает порядок",
  changed: "файл уже применённой миграции изменён — схема в базе не совпадает с репозиторием",
  "file-missing": "миграция применена, а её файлов нет — откатить её нечем",
  "applied-out-of-order": "применена раньше более ранней миграции — порядок нарушен",
};

/** Короткая машинная запись проблемы: она же попадает в сообщение об отказе. */
export const problemLine = (problem: MigrationProblem): string =>
  `${problem.code}:${problem.version || problem.file}`;

/** Пояснение для того, кто читает вывод команды. */
export const problemHint = (problem: MigrationProblem): string =>
  `${problem.version || problem.file}: ${HINTS[problem.code]}`;

/** Отказ по несовместимой миграции. Сообщение называет первую проблему. */
export class MigrationError extends Error {
  constructor(readonly problems: MigrationProblem[]) {
    const first = problems[0];
    super(`migration-${first ? problemLine(first) : "unknown:"}`);
    this.name = "MigrationError";
  }
}

export interface MigrationScan {
  /** Миграции, у которых есть обе половины пары: их можно применять. */
  migrations: Migration[];
  /** Всё, что не сошлось в самих файлах. База здесь ещё не участвует. */
  problems: MigrationProblem[];
}

/**
 * Читает каталог миграций и одновременно проверяет его. В отличие от
 * `readMigrations`, не бросает: вызывающий решает, отказать или показать список.
 */
export function scanMigrations(directory: string = MIGRATIONS_DIR): MigrationScan {
  const problems: MigrationProblem[] = [];
  const found = new Map<string, { names: Set<string>; up?: string; down?: string }>();

  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      problems.push({ code: "bad-file-name", version: "", file });
      continue;
    }
    const [, version = "", name = "", side = ""] = match;
    const entry = found.get(version) ?? { names: new Set<string>() };
    entry.names.add(name);
    const sql = readFileSync(join(directory, file), "utf8");
    if (side === "up") entry.up = sql;
    else entry.down = sql;
    found.set(version, entry);
  }

  const migrations: Migration[] = [];
  const versions = [...found.keys()].sort((left, right) => left.localeCompare(right));

  for (const [index, version] of versions.entries()) {
    const entry = found.get(version);
    if (!entry) continue;
    const names = [...entry.names].sort();
    const name = names[0] ?? "";

    if (names.length > 1) problems.push({ code: "duplicate-version", version, file: names.join(",") });
    if (Number(version) !== index + 1) problems.push({ code: "version-gap", version, file: "" });

    for (const side of ["up", "down"] as const) {
      const sql = entry[side];
      if (sql === undefined) problems.push({ code: `without-${side}`, version, file: "" });
      else if (!sql.trim()) problems.push({ code: "empty-sql", version, file: `${version}_${name}.${side}.sql` });
    }

    if (entry.up !== undefined && entry.down !== undefined) {
      migrations.push({
        version,
        name,
        up: entry.up,
        down: entry.down,
        checksum: createHash("sha256").update(entry.up).digest("hex").slice(0, 16),
      });
    }
  }

  return { migrations, problems };
}

export function readMigrations(directory: string = MIGRATIONS_DIR): Migration[] {
  const scan = scanMigrations(directory);
  if (scan.problems.length) throw new MigrationError(scan.problems);
  return scan.migrations;
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

/**
 * Полная проверка совместимости: файлы плюс то, что уже применено в базе.
 *
 * `db` равен null, когда базы ещё нет — в конвейере проверяются только файлы.
 * Непринятая миграция проблемой не считается: её и надо применить.
 */
export function checkMigrations(db: Db | null, scan: MigrationScan = scanMigrations()): MigrationProblem[] {
  const problems = [...scan.problems];
  if (db === null) return problems;

  const rows = applied(db);
  const byVersion = new Map(scan.migrations.map((migration) => [migration.version, migration]));

  for (const row of rows) {
    const migration = byVersion.get(row.version);
    if (!migration) problems.push({ code: "file-missing", version: row.version, file: "" });
    else if (migration.checksum !== row.checksum) problems.push({ code: "changed", version: row.version, file: "" });
  }

  const appliedVersions = new Set(rows.map((row) => row.version));
  const firstPending = scan.migrations.find((migration) => !appliedVersions.has(migration.version));
  if (firstPending) {
    for (const version of appliedVersions) {
      if (version.localeCompare(firstPending.version) > 0) {
        problems.push({ code: "applied-out-of-order", version, file: "" });
      }
    }
  }

  return problems;
}

/** Номер последней применённой миграции или null. */
export function schemaVersion(db: Db): string | null {
  const rows = applied(db);
  return rows.length ? (rows[rows.length - 1]?.version ?? null) : null;
}

/**
 * Применяет непринятые миграции. Возвращает применённые номера.
 *
 * Первым делом — проверка совместимости: несовместимая миграция не применяется
 * частично, отказ приходит до первой строки SQL.
 */
export function up(db: Db, migrations: Migration[] = readMigrations()): string[] {
  const problems = checkMigrations(db, { migrations, problems: [] });
  if (problems.length) throw new MigrationError(problems);

  const rows = new Map(applied(db).map((row) => [row.version, row]));
  const done: string[] = [];

  for (const migration of migrations) {
    if (rows.has(migration.version)) continue;
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

/**
 * Отказ по несовместимой миграции в поток ошибок: сначала машинная строка для
 * журнала, потом по строке на проблему для того, кто это читает.
 *
 * Одна функция на команду и на старт сервера: сообщение об отказе не должно
 * зависеть от того, где его получили.
 */
export function reportProblems(problems: MigrationProblem[]): void {
  process.stderr.write(
    `${JSON.stringify({ event: "migrate.invalid", problems: problems.map(problemLine) })}\n`,
  );
  for (const problem of problems) process.stderr.write(`Миграция ${problemHint(problem)}\n`);
}

async function main(): Promise<void> {
  const { loadConfig } = await import("../config.js");
  const { openDatabase } = await import("./sqlite.js");

  const command = process.argv[2] ?? "up";
  const stepsArg = process.argv.find((argument) => argument.startsWith("--steps="));
  const steps = stepsArg ? Number(stepsArg.slice("--steps=".length)) : 1;

  const config = loadConfig();

  // Проверка не создаёт базу: в конвейере её ещё нет, а файлы проверить надо.
  if (command === "check") {
    const scan = scanMigrations();
    const db = existsSync(config.databasePath) ? openDatabase({ path: config.databasePath }) : null;
    try {
      const problems = checkMigrations(db, scan);
      if (problems.length) {
        reportProblems(problems);
        process.exitCode = 1;
        return;
      }
      const checked = { event: "migrate.check", result: "ok", migrations: scan.migrations.length, database: db !== null };
      process.stdout.write(`${JSON.stringify(checked)}\n`);
    } finally {
      db?.close();
    }
    return;
  }

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
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    reportProblems(error.problems);
    process.exitCode = 1;
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
