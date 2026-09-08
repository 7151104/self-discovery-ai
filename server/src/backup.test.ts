/**
 * Резервные копии и восстановление (E10-05).
 *
 * Главный тест здесь не «копия создалась», а «восстановление выполнено»: база
 * с зашифрованной записью копируется, файл базы удаляется, копия
 * восстанавливается и запись читается тем же ключом. Копия, которую нечем
 * расшифровать, восстановлением не считается — это проверяется отдельно.
 *
 * Тот же путь описан командами в `SETUP.md`, раздел «Резервные копии».
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALWAYS_KEEP,
  BackupError,
  createBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  verifyBackup,
} from "./db/backup.js";
import { buildKeyring, generateKey } from "./db/crypto.js";
import { up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import { findProfile, insertProfile, saveAnswers } from "./store.js";
import { TEST_KEY, latestMigration } from "./test-support.js";

const keys = buildKeyring(TEST_KEY, []);

interface Sandbox {
  root: string;
  databasePath: string;
  backups: string;
}

function sandbox(t: { after(fn: () => void): void }): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "sdai-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, databasePath: join(root, "data", "app.db"), backups: join(root, "backups") };
}

/** База с одним человеком: имя и ответ зашифрованы активным ключом. */
function populate(databasePath: string): void {
  const db = openDatabase({ path: databasePath, keys });
  try {
    up(db);
    insertProfile(db, { profileId: "p1", name: "Аня", birthDate: "1990-05-05" });
    saveAnswers(db, "p1", [{ questionId: "L1", kind: "выбор", portion: "step:1", value: "A" }]);
  } finally {
    db.close();
  }
}

const drop = (databasePath: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
};

test("копия снимается с живой базы и знает, каким ключом её читать", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);

  const record = createBackup({ databasePath: box.databasePath, directory: box.backups, keys });

  assert.ok(existsSync(record.archivePath), "архива нет");
  assert.ok(existsSync(record.manifestPath), "манифеста нет");
  assert.match(record.manifest.archive, /^app-\d{8}T\d{6}Z\.db\.gz$/);
  assert.equal(record.manifest.schemaVersion, latestMigration());

  // В копии не осталось ничего открытого, и ключ назван отпечатком, а не сам.
  assert.deepEqual(Object.keys(record.manifest.encryption), [`aes-256-gcm:${keys.active?.id ?? ""}`]);
  assert.ok(!readFileSync(record.archivePath).includes(Buffer.from("Аня", "utf8")));

  // Копия остаётся копией: исходная база на месте и читается.
  const db = openDatabase({ path: box.databasePath, keys });
  t.after(() => db.close());
  assert.equal(findProfile(db, "p1")?.name, "Аня");
});

test("восстановление возвращает базу и расшифровывает запись тем же ключом", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);
  const record = createBackup({ databasePath: box.databasePath, directory: box.backups, keys });

  // Потеря базы: файла нет вовсе.
  drop(box.databasePath);
  assert.ok(!existsSync(box.databasePath));

  const report = restoreBackup({ archivePath: record.archivePath, targetPath: box.databasePath, keys });
  assert.equal(report.profiles, 1);
  assert.equal(report.readable, true);
  assert.equal(report.schemaVersion, latestMigration());

  const db = openDatabase({ path: box.databasePath, keys });
  t.after(() => db.close());
  const profile = findProfile(db, "p1");
  assert.equal(profile?.name, "Аня");
  assert.equal(profile?.birthDate, "1990-05-05");
});

test("восстановление поверх живой базы требует явного согласия", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);
  const record = createBackup({ databasePath: box.databasePath, directory: box.backups, keys });

  assert.throws(
    () => restoreBackup({ archivePath: record.archivePath, targetPath: box.databasePath, keys }),
    /backup-target-exists/,
  );

  const report = restoreBackup({
    archivePath: record.archivePath,
    targetPath: box.databasePath,
    keys,
    force: true,
  });
  assert.equal(report.profiles, 1);
});

test("копия без своего ключа не восстанавливается и говорит, какого ключа нет", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);
  const record = createBackup({ databasePath: box.databasePath, directory: box.backups, keys });
  drop(box.databasePath);

  const stranger = buildKeyring(generateKey(), []);
  try {
    restoreBackup({ archivePath: record.archivePath, targetPath: box.databasePath, keys: stranger });
    assert.fail("копия восстановилась чужим ключом");
  } catch (error) {
    assert.ok(error instanceof BackupError);
    assert.equal(error.code, "key-missing");
    // В отказе отпечаток нужного ключа, а не сам ключ.
    assert.equal(error.detail, keys.active?.id);
  }

  // Файл базы при отказе не создаётся: неудачное восстановление ничего не портит.
  assert.ok(!existsSync(box.databasePath));

  // Выведенный из обращения ключ копию ещё читает: смена ключа копии не ломает.
  const rotated = buildKeyring(generateKey(), [TEST_KEY]);
  const report = restoreBackup({ archivePath: record.archivePath, targetPath: box.databasePath, keys: rotated });
  assert.equal(report.readable, true);
});

test("повреждённая копия отклоняется по отпечатку, а не при чтении данных", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);
  const record = createBackup({ databasePath: box.databasePath, directory: box.backups, keys });

  const archive = readFileSync(record.archivePath);
  const middle = Math.floor(archive.length / 2);
  archive.writeUInt8(archive.readUInt8(middle) ^ 0xff, middle);
  writeFileSync(record.archivePath, archive);

  assert.throws(() => verifyBackup(record.archivePath, keys), /backup-archive-corrupted/);
  drop(box.databasePath);
  assert.throws(
    () => restoreBackup({ archivePath: record.archivePath, targetPath: box.databasePath, keys }),
    /backup-archive-corrupted/,
  );
});

test("архив без манифеста копией не считается", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);
  const record = createBackup({ databasePath: box.databasePath, directory: box.backups, keys });

  rmSync(record.manifestPath);
  assert.throws(() => verifyBackup(record.archivePath, keys), /backup-manifest-missing/);
  assert.deepEqual(listBackups(box.backups), []);
});

test("срок хранения удаляет старые копии, но три последние остаются всегда", (t) => {
  const box = sandbox(t);
  populate(box.databasePath);

  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-09-08T03:00:00.000Z");
  // Пять копий старше двух недель и одна свежая.
  const ages = [40, 30, 20, 18, 16, 0];
  for (const age of ages) {
    createBackup({
      databasePath: box.databasePath,
      directory: box.backups,
      keys,
      now: new Date(now.getTime() - age * day),
    });
  }
  assert.equal(listBackups(box.backups).length, ages.length);

  const removed = pruneBackups({ directory: box.backups, keepDays: 14, now });
  const left = listBackups(box.backups);

  // Удалены три самые старые; три последние остались, хотя две из них старше срока.
  assert.equal(removed.length, 3);
  assert.equal(left.length, ALWAYS_KEEP);
  assert.deepEqual(
    left.map((copy) => copy.manifest.createdAt),
    [0, 16, 18].map((age) => new Date(now.getTime() - age * day).toISOString()),
  );

  // Свежая копия не удаляется повторным прогоном: команда идемпотентна.
  assert.deepEqual(pruneBackups({ directory: box.backups, keepDays: 14, now }), []);
  // Удалённый архив уходит вместе с манифестом, мусора не остаётся.
  for (const archive of removed) assert.ok(!existsSync(join(box.backups, archive)));
});

test("копии базы, которой нет, не бывает", (t) => {
  const box = sandbox(t);
  assert.throws(
    () => createBackup({ databasePath: box.databasePath, directory: box.backups, keys }),
    /backup-database-missing/,
  );
});
