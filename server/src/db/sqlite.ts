/**
 * Реализация порта базы на встроенном модуле `node:sqlite`.
 *
 * Выбран потому, что не добавляет ни одной зависимости и не требует запуска
 * стороннего демона: база — файл. Обоснование — `docs/14-state.md`.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db, Row, SqlValue } from "./driver.js";

export interface OpenOptions {
  /** Путь к файлу базы или `:memory:` для теста. */
  path: string;
}

export function openDatabase({ path }: OpenOptions): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  let depth = 0;

  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    get<T extends Row>(sql: string, params: SqlValue[] = []): T | null {
      const row = db.prepare(sql).get(...params);
      return (row as T | undefined) ?? null;
    },
    all<T extends Row>(sql: string, params: SqlValue[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    transaction<T>(body: () => T): T {
      // Вложенная транзакция не начинает новую: внешняя решает, коммитить или нет.
      if (depth > 0) return body();
      depth += 1;
      db.exec("BEGIN");
      try {
        const result = body();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close() {
      db.close();
    },
  };
}
