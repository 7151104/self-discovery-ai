/**
 * Совместимость миграций (E10-04).
 *
 * Миграции применяются при запуске сервера и при выпуске, поэтому проверка их
 * совместимости — часть конвейера, а не забота того, кто вспомнит посмотреть.
 * Здесь перечислены все случаи, в которых миграция считается несовместимой:
 * каждый проверяется на своём каталоге-фикстуре с намеренным нарушением.
 *
 * Что этот тест не проверяет: осмысленность SQL внутри файлов. Схему после
 * применения проверяет `schema.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkMigrations,
  MIGRATIONS_DIR,
  MigrationError,
  problemHint,
  problemLine,
  readMigrations,
  scanMigrations,
  up,
  type MigrationProblemCode,
} from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import type { Db } from "./db/driver.js";

/** Каталог миграций из перечисленных файлов. Уносится вместе с временным. */
function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "sdai-migrations-"));
  mkdirSync(directory, { recursive: true });
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(directory, name), sql);
  return directory;
}

const codes = (directory: string): MigrationProblemCode[] =>
  scanMigrations(directory).problems.map((problem) => problem.code);

const PAIR = {
  "0001_init.up.sql": "CREATE TABLE t (x TEXT)",
  "0001_init.down.sql": "DROP TABLE t",
};

const fresh = (): Db => openDatabase({ path: ":memory:" });

test("миграции репозитория совместимы: проверка на них не находит ничего", () => {
  assert.deepEqual(scanMigrations().problems, []);
  assert.deepEqual(checkMigrations(null), []);
  assert.ok(readMigrations().length > 0);

  const db = fresh();
  try {
    up(db);
    assert.deepEqual(checkMigrations(db), []);
  } finally {
    db.close();
  }
});

test("миграция без отката не применяется, и об этом говорят до применения", (t) => {
  const directory = fixture({ "0001_init.up.sql": "CREATE TABLE t (x TEXT)" });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(codes(directory), ["without-down"]);
  // Пары нет — миграции нет вовсе: применять половину нельзя.
  assert.deepEqual(scanMigrations(directory).migrations, []);
  assert.throws(() => readMigrations(directory), /migration-without-down:0001/);
});

test("пустой файл миграции — тоже отказ", (t) => {
  const directory = fixture({ ...PAIR, "0001_init.down.sql": "   \n" });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(codes(directory), ["empty-sql"]);
});

test("пропуск в номерах ломает порядок применения", (t) => {
  const directory = fixture({
    ...PAIR,
    "0003_orders.up.sql": "CREATE TABLE o (x TEXT)",
    "0003_orders.down.sql": "DROP TABLE o",
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(codes(directory), ["version-gap"]);
  assert.throws(() => readMigrations(directory), /migration-version-gap:0003/);
});

test("повторный номер у двух миграций отклоняется: порядок неоднозначен", (t) => {
  const directory = fixture({
    ...PAIR,
    "0001_orders.up.sql": "CREATE TABLE o (x TEXT)",
    "0001_orders.down.sql": "DROP TABLE o",
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(codes(directory), ["duplicate-version"]);
  const problem = scanMigrations(directory).problems[0];
  // В сообщении оба имени: иначе непонятно, какие файлы спорят.
  assert.equal(problem?.file, "init,orders");
});

test("файл не по образцу не пропускается молча", (t) => {
  const directory = fixture({ ...PAIR, "0002_Заказы.up.sql": "CREATE TABLE o (x TEXT)" });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  // Раньше такой файл просто не попадал в список и не применялся никогда.
  assert.deepEqual(codes(directory), ["bad-file-name"]);
});

test("изменённый файл уже применённой миграции останавливает применение", () => {
  const db = fresh();
  try {
    up(db);
    const tampered = readMigrations().map((migration) => ({ ...migration, checksum: "0000000000000000" }));

    const problems = checkMigrations(db, { migrations: tampered, problems: [] });
    assert.deepEqual(new Set(problems.map((problem) => problem.code)), new Set(["changed"]));

    // Отказ приходит до первой строки SQL и называет номер миграции.
    assert.throws(() => up(db, tampered), MigrationError);
    assert.throws(() => up(db, tampered), /migration-changed:0001/);
  } finally {
    db.close();
  }
});

test("применённая миграция без файлов в репозитории — несовместимость", () => {
  const db = fresh();
  try {
    up(db);
    const [, ...withoutFirst] = readMigrations();

    const problems = checkMigrations(db, { migrations: withoutFirst, problems: [] });
    assert.deepEqual(problems.map(problemLine), ["file-missing:0001"]);
  } finally {
    db.close();
  }
});

test("миграция, применённая раньше более ранней, видна как нарушение порядка", () => {
  const db = fresh();
  try {
    const migrations = readMigrations();
    const skipped = migrations[migrations.length - 1];
    assert.ok(skipped);

    // Первую применяем как положено, последнюю записываем в журнал руками:
    // так выглядит база, в которую миграции попадали не по порядку.
    up(db, migrations.slice(0, 1));
    db.run("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)", [
      skipped.version,
      skipped.name,
      skipped.checksum,
      new Date().toISOString(),
    ]);

    assert.deepEqual(checkMigrations(db).map(problemLine), [`applied-out-of-order:${skipped.version}`]);
  } finally {
    db.close();
  }
});

test("у каждой несовместимости есть пояснение для человека", () => {
  const all: MigrationProblemCode[] = [
    "without-up",
    "without-down",
    "empty-sql",
    "bad-file-name",
    "duplicate-version",
    "version-gap",
    "changed",
    "file-missing",
    "applied-out-of-order",
  ];

  for (const code of all) {
    const hint = problemHint({ code, version: "0007", file: "" });
    assert.match(hint, /^0007: \S/, `${code}: пояснения нет`);
    assert.ok(hint.length > 20, `${code}: пояснение слишком короткое, чтобы что-то объяснить`);
  }
});

test("каталог миграций один и тот же из исходников и из сборки", () => {
  assert.ok(MIGRATIONS_DIR.endsWith(`server${"/"}migrations${"/"}`));
  assert.ok(scanMigrations(MIGRATIONS_DIR).migrations.length > 0);
});
