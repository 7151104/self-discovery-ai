/**
 * Порт базы. Всё хранение ходит только через этот интерфейс, поэтому смена
 * движка базы (например на PostgreSQL при переезде с одной машины) — это новая
 * реализация порта и перевод SQL миграций, а не переделка репозиториев.
 */

/** Значение, которое умеет хранить любая реляционная база из наших кандидатов. */
export type SqlValue = string | number | null;

/** Строка результата: интерфейс с колонками, которые запрошены в SELECT. */
export type Row = object;

export interface Db {
  /** Выполнить один или несколько операторов без параметров (миграции, PRAGMA). */
  exec(sql: string): void;
  /** Запрос без результата. */
  run(sql: string, params?: SqlValue[]): void;
  /** Первая строка результата или null. */
  get<T extends Row>(sql: string, params?: SqlValue[]): T | null;
  /** Все строки результата. */
  all<T extends Row>(sql: string, params?: SqlValue[]): T[];
  /** Транзакция: исключение внутри откатывает всё. */
  transaction<T>(body: () => T): T;
  close(): void;
}
