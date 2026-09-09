/**
 * Схема хранения и миграции (E3-03).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { down, readMigrations, reset, schemaVersion, status, up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import type { Db } from "./db/driver.js";

const fresh = (): Db => openDatabase({ path: ":memory:" });

const versions = (): string[] => readMigrations().map((migration) => migration.version);

const latest = (): string => versions()[versions().length - 1] ?? "";

const tables = (db: Db): string[] =>
  db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => row.name)
    .filter((name) => !name.startsWith("sqlite_"));

const columns = (db: Db, table: string): string[] =>
  db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).map((row) => row.name);

test("у каждой миграции есть откат", () => {
  const migrations = readMigrations();
  assert.ok(migrations.length > 0);
  for (const migration of migrations) {
    assert.ok(migration.up.trim().length, `${migration.version}: пустой up`);
    assert.ok(migration.down.trim().length, `${migration.version}: пустой down`);
  }
});

test("чистая база поднимается одной командой", () => {
  const db = fresh();
  try {
    const applied = up(db);
    assert.deepEqual(applied, readMigrations().map((migration) => migration.version));

    assert.deepEqual(tables(db).sort(), [
      "answers",
      "blocks",
      "consents",
      "disagreements",
      "events",
      "generation_cache",
      "generation_calls",
      "generation_jobs",
      "order_events",
      "orders",
      "portion_submissions",
      "profile_contacts",
      "profile_versions",
      "profiles",
      "schema_migrations",
      "share_tokens",
      "webhook_deliveries",
    ]);
    assert.equal(schemaVersion(db), latest());
  } finally {
    db.close();
  }
});

test("схема покрывает профиль, ответы, версии, блоки, заказы, несогласия и события", () => {
  const db = fresh();
  try {
    up(db);
    const expected: Record<string, string[]> = {
      profiles: ["profile_id", "name_payload", "birth_date_payload", "version"],
      answers: ["profile_id", "question_id", "question_kind", "portion", "payload", "revision"],
      profile_versions: ["profile_id", "version", "reason", "snapshot"],
      blocks: ["profile_id", "slot", "status", "origin", "purchased", "stale", "body_payload"],
      orders: ["profile_id", "slice", "amount", "status", "request_id", "provider_mode", "active_slice"],
      order_events: ["order_id", "profile_id", "from_status", "to_status", "reason"],
      webhook_deliveries: ["provider", "event_id", "kind", "order_id", "result"],
      generation_jobs: [
        "generation_id",
        "profile_id",
        "slot",
        "status",
        "active_slot",
        "input_hash",
        "content_version",
        "regenerated",
        "result_payload",
      ],
      generation_calls: [
        "call_id",
        "profile_id",
        "model",
        "input_tokens",
        "output_tokens",
        "cost_kopecks",
        "duration_ms",
        "outcome",
      ],
      generation_cache: ["profile_id", "input_hash", "content_version", "result_payload", "result_enc"],
      disagreements: ["profile_id", "slot", "kind"],
      events: ["profile_id", "type", "payload"],
      portion_submissions: ["profile_id", "request_id", "portion", "answer_count", "profile_version"],
      share_tokens: ["token", "profile_id", "created_at", "revoked_at"],
      consents: ["profile_id", "version", "consented_at"],
      profile_contacts: [
        "profile_id",
        "email_payload",
        "email_enc",
        "channel_payload",
        "channel_enc",
        "status",
      ],
    };
    for (const [table, wanted] of Object.entries(expected)) {
      const actual = columns(db, table);
      for (const column of wanted) assert.ok(actual.includes(column), `${table}.${column} нет в схеме`);
    }
  } finally {
    db.close();
  }
});

test("почта и канал живут только в profile_contacts и шифруются", () => {
  const db = fresh();
  try {
    up(db);
    for (const table of tables(db)) {
      for (const column of columns(db, table)) {
        if (!/mail|phone|telegram|channel/i.test(column)) continue;
        assert.equal(table, "profile_contacts", `${table}.${column} — контакт вне таблицы контактов`);
        assert.match(column, /_(payload|enc)$/, `${table}.${column} должна быть парой шифрования`);
      }
    }
  } finally {
    db.close();
  }
});

test("чувствительные поля хранятся парой «строка + метка записи»", () => {
  const db = fresh();
  try {
    up(db);
    const pairs: [string, string][] = [
      ["profiles", "name"],
      ["profiles", "birth_date"],
      ["answers", "payload"],
      ["profile_versions", "snapshot"],
      ["blocks", "heading"],
      ["blocks", "body"],
      ["generation_jobs", "result"],
      ["generation_cache", "result"],
      ["profile_contacts", "email"],
      ["profile_contacts", "channel"],
    ];
    for (const [table, field] of pairs) {
      const actual = columns(db, table);
      const payload = field === "payload" || field === "snapshot" ? field : `${field}_payload`;
      const marker = field === "payload" ? "payload_enc" : field === "snapshot" ? "snapshot_enc" : `${field}_enc`;
      assert.ok(actual.includes(payload), `${table}.${payload}`);
      assert.ok(actual.includes(marker), `${table}.${marker}: без метки шифрование потребует правки схемы`);
    }
  } finally {
    db.close();
  }
});

test("миграции откатываются по одной, в обратном порядке, и накатываются заново", () => {
  const db = fresh();
  try {
    up(db);

    // Шаг назад снимает только последнюю миграцию.
    assert.deepEqual(down(db), [latest()]);
    assert.ok(tables(db).includes("profiles"));
    // Последняя миграция — таблица согласий; ответы остаются.
    assert.ok(tables(db).includes("answers"));

    assert.deepEqual(up(db), [latest()]);

    const rolled = down(db, readMigrations().length);
    assert.deepEqual(rolled, [...versions()].reverse());
    assert.deepEqual(tables(db), ["schema_migrations"]);
    assert.equal(schemaVersion(db), null);

    up(db);
    assert.ok(tables(db).includes("profiles"));

    reset(db);
    assert.ok(tables(db).includes("profiles"));
    assert.equal(schemaVersion(db), latest());
  } finally {
    db.close();
  }
});

test("статус различает применённое, непринятое и изменённое", () => {
  const db = fresh();
  try {
    assert.deepEqual(
      status(db).map((row) => row.state),
      readMigrations().map(() => "pending"),
    );

    up(db);
    assert.deepEqual(
      status(db).map((row) => row.state),
      readMigrations().map(() => "applied"),
    );

    const tampered = readMigrations().map((migration) => ({ ...migration, checksum: "0000000000000000" }));
    assert.deepEqual(
      status(db, tampered).map((row) => row.state),
      tampered.map(() => "changed"),
    );
    assert.throws(() => up(db, tampered), /migration-changed/);
  } finally {
    db.close();
  }
});

test("ответы и блоки уходят вместе с профилем", () => {
  const db = fresh();
  try {
    up(db);
    const timestamp = new Date().toISOString();
    db.run(
      `INSERT INTO profiles (profile_id, name_payload, name_enc, version, created_at, updated_at)
       VALUES ('p1', 'Аня', 'none', 0, ?, ?)`,
      [timestamp, timestamp],
    );
    db.run(
      `INSERT INTO answers (profile_id, question_id, question_kind, portion, payload, payload_enc, revision, created_at, updated_at)
       VALUES ('p1', 'L1', 'выбор', 'step:1', 'A', 'none', 1, ?, ?)`,
      [timestamp, timestamp],
    );
    db.run("DELETE FROM profiles WHERE profile_id = 'p1'");

    const left = db.get<{ total: number }>("SELECT COUNT(*) AS total FROM answers");
    assert.equal(left?.total, 0);
  } finally {
    db.close();
  }
});
