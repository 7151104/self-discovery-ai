/**
 * Конфигурация и секреты (E3-11).
 *
 * Проверяется два свойства: сервер отказывается стартовать без обязательной
 * переменной и называет её, а в репозитории нет ключей. Второе — не замена
 * сканеру в непрерывной сборке (E10-02), а его переносимая часть: она работает
 * там же, где `npm test`, и падает до того, как ключ уедет в историю.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { ConfigError, loadConfig } from "./config.js";
import { TEST_KEY } from "./test-support.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("без обязательной переменной конфигурация не собирается и называет её", () => {
  // В разработке значений по умолчанию хватает.
  assert.equal(loadConfig({}).environment, "development");

  try {
    loadConfig({ SDAI_ENV: "production" });
    assert.fail("рабочее окружение собралось без обязательной переменной");
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.equal(error.reason, "missing-required");
    assert.deepEqual(error.variables, [
      "SDAI_PUBLIC_ORIGIN",
      "SDAI_ENCRYPTION_KEY",
      "SDAI_PAYMENT_WEBHOOK_SECRET",
      "SDAI_DB_PATH",
      "SDAI_BACKUP_DIR",
    ]);
    // В сообщении имена переменных, а не их значения.
    assert.match(error.message, /SDAI_PUBLIC_ORIGIN/);
  }

  const production = loadConfig({
    SDAI_ENV: "production",
    SDAI_PUBLIC_ORIGIN: "https://example.com",
    SDAI_ENCRYPTION_KEY: TEST_KEY,
    SDAI_PAYMENT_WEBHOOK_SECRET: "секрет-из-окружения",
    SDAI_PAYMENT_PROVIDER: "будущий-провайдер",
    SDAI_DB_PATH: "/var/lib/sdai/production.db",
    SDAI_BACKUP_DIR: "/var/backups/sdai/production",
  });
  assert.equal(production.environment, "production");
  assert.equal(production.publicOrigin, "https://example.com");

  assert.throws(
    () => loadConfig({ SDAI_ENV: "предварительное" }),
    /config:expected-development-staging-or-production:SDAI_ENV/,
  );
});

test("предварительное окружение требует того же набора переменных и своих данных (E10-01)", () => {
  // Тот же набор обязательных: предварительное окружение — не облегчённая
  // разработка, у него свои ключи, своя база и свои копии.
  assert.throws(() => loadConfig({ SDAI_ENV: "staging" }), /config:missing-required:SDAI_PUBLIC_ORIGIN/);

  const staging = loadConfig({
    SDAI_ENV: "staging",
    SDAI_PUBLIC_ORIGIN: "https://staging.example.com",
    SDAI_ENCRYPTION_KEY: TEST_KEY,
    SDAI_PAYMENT_WEBHOOK_SECRET: "секрет-из-окружения",
    SDAI_DB_PATH: "/var/lib/sdai/staging.db",
    SDAI_BACKUP_DIR: "/var/backups/sdai/staging",
  });
  assert.equal(staging.environment, "staging");
  // Поддельный провайдер здесь разрешён: платный путь проходится без денег.
  assert.equal(staging.payments.provider, "fake");
  assert.equal(staging.databasePath, "/var/lib/sdai/staging.db");
  assert.equal(staging.backup.directory, "/var/backups/sdai/staging");

  // В рабочем окружении тот же провайдер несовместим с запуском (E8-09).
  assert.throws(
    () =>
      loadConfig({
        SDAI_ENV: "production",
        SDAI_PUBLIC_ORIGIN: "https://example.com",
        SDAI_ENCRYPTION_KEY: TEST_KEY,
        SDAI_PAYMENT_WEBHOOK_SECRET: "секрет-из-окружения",
        SDAI_DB_PATH: "/var/lib/sdai/production.db",
        SDAI_BACKUP_DIR: "/var/backups/sdai/production",
      }),
    /fake-provider-forbidden-in-production/,
  );
});

test("версия сборки читается из окружения, без неё — версия из package.json (E10-03)", () => {
  const local = loadConfig({});
  assert.match(local.build.version, /^\d+\.\d+\.\d+$/);
  assert.equal(local.build.commit, "unknown");
  assert.equal(local.build.builtAt, null);

  const released = loadConfig({
    SDAI_BUILD_VERSION: "2026-09-08-3",
    SDAI_BUILD_COMMIT: "0123456789abcdef",
    SDAI_BUILD_AT: "2026-09-08T10:00:00.000Z",
  });
  assert.equal(released.build.version, "2026-09-08-3");
  assert.equal(released.build.commit, "0123456789abcdef");
  assert.equal(released.build.builtAt, "2026-09-08T10:00:00.000Z");
});

test("пример окружения перечисляет все читаемые переменные и не содержит значений", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");

  const declared = new Set(
    example
      .split("\n")
      .filter((line) => /^SDAI_[A-Z_]+=/.test(line))
      .map((line) => line.split("=")[0] as string),
  );

  const used = new Set(readFileSync(join(root, "server", "src", "config.ts"), "utf8").match(/SDAI_[A-Z_]+/g) ?? []);
  for (const variable of used) assert.ok(declared.has(variable), `${variable} не описан в .env.example`);
  for (const variable of declared) assert.ok(used.has(variable), `${variable} в .env.example лишний`);

  // Значений в примере нет: только имена.
  for (const line of example.split("\n")) {
    if (!line.startsWith("SDAI_")) continue;
    assert.match(line, /^SDAI_[A-Z_]+=$/, `в .env.example попало значение: ${line}`);
  }
});

test("сканер секретов не находит ключей в репозитории", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.endsWith("secrets.test.ts"));

  // Собирается из кусков, чтобы сам сканер не был находкой сканера.
  const patterns: { name: string; probe: RegExp }[] = [
    { name: "приватный ключ", probe: new RegExp(`-----BEGIN [A-Z ]*PRIVATE ${"KEY"}-----`) },
    { name: "ключ провайдера", probe: /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}/ },
    { name: "ключ AWS", probe: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "токен GitHub", probe: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
    {
      name: "присвоенный секрет",
      probe: new RegExp(`\\b(api[_-]?${"key"}|secret|${"password"}|access[_-]?${"token"})\\s*[:=]\\s*["'][^"'\\s]{16,}["']`, "i"),
    },
  ];

  const found: string[] = [];
  for (const path of files) {
    let text: string;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.probe.test(text)) found.push(`${path}: ${pattern.name}`);
    }
  }

  assert.deepEqual(found, []);
});

test("файл окружения не попадает в репозиторий, пример — попадает", () => {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean),
  );
  assert.ok(tracked.has(".env.example"));
  assert.ok(!tracked.has(".env"));
  assert.ok(![...tracked].some((path) => path.endsWith("/.env")));
});
