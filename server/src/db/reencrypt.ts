/**
 * Перешифровка базы активным ключом (E9-08).
 *
 * Смена ключа проходит так: новый ключ становится `SDAI_ENCRYPTION_KEY`, старый
 * переезжает в `SDAI_ENCRYPTION_KEYS_RETIRED`. С этого момента новые записи
 * пишутся новым ключом, а старые ещё читаются старым — сервис работает без
 * простоя. Эта команда переписывает всё оставшееся, после чего старый ключ
 * можно убрать из окружения.
 *
 * Команда идемпотентна: запись, уже зашифрованная активным ключом, не трогается.
 *
 * `npm run reencrypt` — перешифровать, `npm run reencrypt -- status` — посмотреть,
 * сколько записей чем зашифровано.
 */

import type { Db, SqlValue } from "./driver.js";
import { seal, unseal } from "./stored-text.js";

/** Таблица, её ключевые колонки и пары «текст + метка», которые в ней лежат. */
interface Target {
  table: string;
  keyColumns: string[];
  fields: { payload: string; enc: string; optional?: boolean }[];
}

const TARGETS: Target[] = [
  {
    table: "profiles",
    keyColumns: ["profile_id"],
    fields: [
      { payload: "name_payload", enc: "name_enc" },
      { payload: "birth_date_payload", enc: "birth_date_enc", optional: true },
    ],
  },
  {
    table: "answers",
    keyColumns: ["profile_id", "question_id"],
    fields: [{ payload: "payload", enc: "payload_enc" }],
  },
  {
    table: "profile_versions",
    keyColumns: ["version_id"],
    fields: [{ payload: "snapshot", enc: "snapshot_enc" }],
  },
  {
    table: "blocks",
    keyColumns: ["block_id"],
    fields: [
      { payload: "heading_payload", enc: "heading_enc" },
      { payload: "body_payload", enc: "body_enc" },
    ],
  },
];

export interface Progress {
  table: string;
  rewritten: number;
  skipped: number;
}

/** Метки, встречающиеся в базе, и число записей у каждой. */
export function markerCounts(db: Db): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const target of TARGETS) {
    for (const field of target.fields) {
      const rows = db.all<{ marker: string; total: number }>(
        `SELECT ${field.enc} AS marker, COUNT(*) AS total FROM ${target.table} GROUP BY ${field.enc}`,
      );
      for (const row of rows) counts[row.marker] = (counts[row.marker] ?? 0) + row.total;
    }
  }
  return counts;
}

/** Переписывает все чувствительные поля активным ключом. */
export function reencrypt(db: Db): Progress[] {
  const active = db.keys.active;
  if (!active) throw new Error("reencrypt:no-active-key");
  const wanted = new Set([`aes-256-gcm:${active.id}`]);

  return db.transaction(() =>
    TARGETS.map((target) => {
      const columns = [...target.keyColumns, ...target.fields.flatMap((field) => [field.payload, field.enc])];
      const rows = db.all<Record<string, string | null>>(`SELECT ${columns.join(", ")} FROM ${target.table}`);

      let rewritten = 0;
      let skipped = 0;

      for (const row of rows) {
        const updates: string[] = [];
        const values: SqlValue[] = [];

        for (const field of target.fields) {
          const payload = row[field.payload];
          const enc = row[field.enc] ?? "none";
          if (payload === null || payload === undefined) continue;
          if (wanted.has(enc)) continue;

          const stored = seal(db.keys, unseal(db.keys, { payload, enc }));
          updates.push(`${field.payload} = ?`, `${field.enc} = ?`);
          values.push(stored.payload, stored.enc);
        }

        if (!updates.length) {
          skipped += 1;
          continue;
        }

        const where = target.keyColumns.map((column) => `${column} = ?`).join(" AND ");
        values.push(...target.keyColumns.map((column) => row[column] ?? null));
        db.run(`UPDATE ${target.table} SET ${updates.join(", ")} WHERE ${where}`, values);
        rewritten += 1;
      }

      return { table: target.table, rewritten, skipped };
    }),
  );
}

async function main(): Promise<void> {
  const [{ loadConfig, ConfigError }, { openDatabase }] = await Promise.all([
    import("../config.js"),
    import("./sqlite.js"),
  ]);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(
        `${JSON.stringify({ event: "config.invalid", reason: error.reason, variables: error.variables })}\n`,
      );
      process.exit(1);
    }
    throw error;
  }

  const db = openDatabase({ path: config.databasePath, keys: config.keys });
  try {
    if (process.argv[2] === "status") {
      process.stdout.write(`${JSON.stringify({ event: "reencrypt.status", markers: markerCounts(db) })}\n`);
      return;
    }
    if (!config.keys.active) {
      process.stderr.write(`${JSON.stringify({ event: "reencrypt.skipped", reason: "no-active-key" })}\n`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify({ event: "reencrypt.done", tables: reencrypt(db) })}\n`);
  } finally {
    db.close();
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("reencrypt.js")) await main();
