/**
 * Шифрование чувствительных полей при хранении (E9-08).
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import {
  buildKeyring,
  decrypt,
  DecryptError,
  encrypt,
  generateKey,
  KeyError,
  keyFingerprint,
  NO_KEYS,
  parseKey,
} from "./db/crypto.js";
import { markerCounts, reencrypt } from "./db/reencrypt.js";
import { openDatabase } from "./db/sqlite.js";
import { up } from "./db/migrate.js";
import { ConfigError, loadConfig } from "./config.js";
import { insertProfile, listAnswers, listBlocks, saveAnswers, saveBlockContent, findProfile } from "./store.js";
import { answersForStep, call, portionKey, startTestServer, TEST_KEY } from "./test-support.js";
import type { Db } from "./db/driver.js";
import type { PageStateDto } from "./contract/index.js";

const OTHER_KEY = "cHJvZmlsZS1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyE=";

test("ключ читается из базы64, чужой длины не принимается", () => {
  const key = parseKey(TEST_KEY);
  assert.equal(key.length, 32);
  assert.equal(keyFingerprint(key).length, 8);
  assert.notEqual(keyFingerprint(key), keyFingerprint(parseKey(OTHER_KEY)));

  assert.throws(() => parseKey("короткий"), KeyError);
  assert.equal(parseKey(generateKey()).length, 32);
});

test("шифротекст не содержит исходной строки и читается обратно", () => {
  const keys = buildKeyring(TEST_KEY, []);
  const text = "Я останавливаюсь, когда дело почти готово, и начинаю переделывать.";

  const first = encrypt(keys, text);
  const second = encrypt(keys, text);

  assert.ok(!first.payload.includes("останавливаюсь"));
  assert.match(first.enc, /^aes-256-gcm:[A-Za-z0-9_-]{8}$/);
  // Один и тот же текст даёт разный шифротекст: вектор инициализации новый.
  assert.notEqual(first.payload, second.payload);

  assert.equal(decrypt(keys, first.payload, first.enc), text);
  assert.equal(decrypt(keys, second.payload, second.enc), text);
});

test("подмена шифротекста и чужой ключ — отказ, а не мусор", () => {
  const keys = buildKeyring(TEST_KEY, []);
  const sealed = encrypt(keys, "текст");

  const [iv, tag, body] = sealed.payload.split(".");
  const tampered = [iv, tag, Buffer.from("подмена").toString("base64url")].join(".");
  assert.throws(() => decrypt(keys, tampered, sealed.enc), DecryptError);
  assert.ok(body);

  const stranger = buildKeyring(OTHER_KEY, []);
  assert.throws(() => decrypt(stranger, sealed.payload, sealed.enc), /unknown-key/);
  assert.throws(() => decrypt(keys, sealed.payload, "rot13:abc"), /unsupported-marker/);
});

test("выведенный из обращения ключ ещё читает, но не пишет", () => {
  const old = buildKeyring(OTHER_KEY, []);
  const sealed = encrypt(old, "старая запись");

  const rotated = buildKeyring(TEST_KEY, [OTHER_KEY]);
  assert.equal(decrypt(rotated, sealed.payload, sealed.enc), "старая запись");

  // Новые записи пишутся активным ключом.
  const fresh = encrypt(rotated, "новая запись");
  assert.equal(fresh.enc, `aes-256-gcm:${keyFingerprint(parseKey(TEST_KEY))}`);

  assert.throws(() => buildKeyring(TEST_KEY, [TEST_KEY]), /active-key-is-also-retired/);
  assert.throws(() => encrypt(NO_KEYS, "нечем"), /no-active-key/);
});

const seeded = (db: Db): string => {
  up(db);
  const profile = insertProfile(db, { profileId: "p1", name: "Аня", birthDate: "1990-05-01" });
  saveAnswers(db, profile.profileId, [
    { questionId: "L12", kind: "открытый", portion: "step:4", value: "Я бросаю на девяноста процентах." },
  ]);
  saveBlockContent(db, profile.profileId, {
    slot: "step4",
    profileVersion: 1,
    purchased: false,
    heading: "Как это складывается",
    paragraphs: ["Ты доводишь до предпоказа и там останавливаешься."],
    highlight: null,
  });
  return profile.profileId;
};

test("в файле базы нет ни имени, ни открытого ответа, ни текста блока", () => {
  const db = openDatabase({ path: ":memory:", keys: buildKeyring(TEST_KEY, []) });
  try {
    const profileId = seeded(db);

    // Смотрим на то, что физически лежит в колонках, минуя расшифровку.
    const raw = [
      ...db.all<{ v: string }>("SELECT name_payload AS v FROM profiles"),
      ...db.all<{ v: string }>("SELECT birth_date_payload AS v FROM profiles"),
      ...db.all<{ v: string }>("SELECT payload AS v FROM answers"),
      ...db.all<{ v: string }>("SELECT heading_payload AS v FROM blocks"),
      ...db.all<{ v: string }>("SELECT body_payload AS v FROM blocks"),
      ...db.all<{ v: string }>("SELECT snapshot AS v FROM profile_versions"),
      ...db.all<{ v: string | null }>("SELECT result_payload AS v FROM generation_jobs"),
      ...db.all<{ v: string | null }>("SELECT result_payload AS v FROM generation_cache"),
    ]
      .map((row) => row.v ?? "")
      .join(" ");

    for (const secret of ["Аня", "1990-05-01", "девяноста", "предпоказа"]) {
      assert.ok(!raw.includes(secret), `в базе открытым текстом: ${secret}`);
    }

    // Через хранилище всё читается обратно.
    assert.equal(findProfile(db, profileId)?.name, "Аня");
    assert.equal(listAnswers(db, profileId)[0]?.value, "Я бросаю на девяноста процентах.");
    assert.equal(listBlocks(db, profileId)[0]?.paragraphs[0], "Ты доводишь до предпоказа и там останавливаешься.");
  } finally {
    db.close();
  }
});

test("база без ключа читается, новые записи шифруются: смена ключа не требует простоя", () => {
  const path = `/tmp/sdai-reencrypt-${process.pid}-${Date.now()}.db`;

  // Было: сервис работал без шифрования.
  const plain = openDatabase({ path });
  const profileId = seeded(plain);
  // Пять пар «строка + метка»: имя, дата рождения, ответ, заголовок и тело блока.
  assert.deepEqual(markerCounts(plain), { none: 5 });
  plain.close();

  // Стало: ключ появился. Старые записи читаются, новые пишутся шифром.
  const encrypted = openDatabase({ path, keys: buildKeyring(TEST_KEY, []) });
  try {
    assert.equal(findProfile(encrypted, profileId)?.name, "Аня");

    saveAnswers(encrypted, profileId, [
      { questionId: "L1", kind: "выбор", portion: "step:1", value: "A" },
    ]);
    assert.equal(markerCounts(encrypted)["none"], 5);

    // Переписываются три строки: профиль, старый ответ и блок.
    const progress = reencrypt(encrypted);
    assert.equal(
      progress.reduce((sum, row) => sum + row.rewritten, 0),
      3,
    );
    assert.deepEqual(Object.keys(markerCounts(encrypted)), [`aes-256-gcm:${keyFingerprint(parseKey(TEST_KEY))}`]);

    // Повторный прогон ничего не переписывает.
    assert.equal(
      reencrypt(encrypted).reduce((sum, row) => sum + row.rewritten, 0),
      0,
    );
    assert.equal(findProfile(encrypted, profileId)?.name, "Аня");
  } finally {
    encrypted.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
});

test("рабочее окружение не стартует без ключа шифрования", () => {
  try {
    loadConfig({
      SDAI_ENV: "production",
      SDAI_PUBLIC_ORIGIN: "https://example.com",
      SDAI_PAYMENT_WEBHOOK_SECRET: "s",
      SDAI_DB_PATH: "/var/lib/sdai/production.db",
      SDAI_BACKUP_DIR: "/var/backups/sdai/production",
    });
    assert.fail("собралось без ключа");
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.deepEqual(error.variables, ["SDAI_ENCRYPTION_KEY"]);
  }

  assert.throws(
    () => loadConfig({ SDAI_ENCRYPTION_KEY: "не-ключ" }),
    /config:expected-32-bytes-base64:SDAI_ENCRYPTION_KEY/,
  );
  assert.equal(loadConfig({}).keys.active, null);
  assert.equal(loadConfig({ SDAI_ENCRYPTION_KEY: TEST_KEY }).keys.active?.id.length, 8);
});

test("сквозной путь работает на зашифрованной базе", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await call<PageStateDto>(server.origin, "POST", "/api/profiles", {
    name: "Аня",
    birthDate: "1990-05-01",
  });
  const profileId = created.body.profileId;

  await call(server.origin, "POST", `/api/p/${profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "one",
  });

  const page = await call<PageStateDto>(server.origin, "GET", `/api/p/${profileId}`);
  assert.equal(page.body.card.name, "Аня");
  assert.equal(page.body.state, "s1");

  // Тестовый сервер поднят с ключом: в колонках шифротекст.
  assert.ok(server.db.keys.active);
  const rows = server.db.all<{ v: string }>("SELECT name_payload AS v FROM profiles");
  assert.ok(!rows.some((row) => row.v.includes("Аня")));
});
