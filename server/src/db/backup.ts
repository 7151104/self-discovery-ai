/**
 * Резервные копии базы и восстановление (E10-05).
 *
 * База — файл, поэтому копия — тоже файл. Но не «cp app.db»: рядом с базой
 * живёт журнал WAL, и копия без него получилась бы на полтакта старше самой
 * себя. Копия снимается запросом `VACUUM INTO`: он отдаёт согласованный снимок
 * вместе с содержимым журнала и не требует остановки сервера.
 *
 * Чувствительные поля в копии зашифрованы, а ключ живёт в переменной окружения
 * и в копию не попадает: без ключа копия — набор шифротекста (открытый вопрос
 * 27 в `docs/14-state.md`). Поэтому рядом с архивом лежит манифест, а в нём —
 * отпечатки ключей, которыми копия читается. Отпечаток не секрет: сам ключ по
 * нему не восстанавливается, зато при восстановлении сразу видно, тот ли ключ
 * в окружении. Восстановление с чужим ключом отказывает, а не выдаёт мусор.
 *
 * Расписание задаёт не сервер, а таймер площадки: `deploy/sdai-backup.timer`.
 * Срок хранения — `SDAI_BACKUP_KEEP_DAYS`, по умолчанию 14 суток; три
 * последние копии остаются всегда.
 *
 * Командная строка:
 *   npm run backup                        — снять копию
 *   npm run backup -- list                — что уже снято
 *   npm run backup -- prune               — удалить копии старше срока
 *   npm run backup -- verify <архив>      — проверить копию, не восстанавливая
 *   npm run backup -- restore <архив> [--to=<файл>] [--force]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { NO_KEYS, type Keyring } from "./crypto.js";
import { checkMigrations, problemLine, schemaVersion } from "./migrate.js";
import { openDatabase } from "./sqlite.js";
import { markerCounts } from "./reencrypt.js";
import { PLAINTEXT, unseal } from "./stored-text.js";

/** Три последние копии не удаляются никогда, даже если старше срока. */
export const ALWAYS_KEEP = 3;

/** Отказ по копии. Код машинный, пояснение для человека — в `HINTS`. */
export class BackupError extends Error {
  constructor(readonly code: string, readonly detail = "") {
    super(`backup-${code}${detail ? `:${detail}` : ""}`);
    this.name = "BackupError";
  }
}

const HINTS: Record<string, string> = {
  "database-missing": "файла базы нет — копировать нечего",
  "archive-missing": "архива по этому пути нет",
  "manifest-missing": "рядом с архивом нет манифеста: без него неизвестно, каким ключом копия читается",
  "manifest-broken": "манифест не разбирается",
  "archive-corrupted": "отпечаток архива не совпал с манифестом: копия повреждена",
  "key-missing": "ключа с таким отпечатком нет в окружении: этой копией без него не воспользоваться",
  "key-mismatch": "запись копии не расшифровалась активной связкой ключей",
  "target-exists": "файл базы на месте — восстановление поверх требует --force и остановленной службы",
  "schema-incompatible": "схема копии не совпадает с миграциями этого выпуска",
};

export const backupHint = (error: BackupError): string =>
  `${HINTS[error.code] ?? error.code}${error.detail ? ` (${error.detail})` : ""}`;

export interface BackupManifest {
  /** Версия формата манифеста: состав полей со временем может вырасти. */
  format: 1;
  createdAt: string;
  /** Имя файла архива рядом с манифестом. */
  archive: string;
  /** Номер миграции, на которой снята копия; null — база пуста. */
  schemaVersion: string | null;
  /** Размер архива в байтах. */
  bytes: number;
  sha256: string;
  /**
   * Метки шифрования, встреченные в копии, и число записей у каждой:
   * `aes-256-gcm:<отпечаток>` или `none` для открытого текста. По этому полю
   * видно и то, каким ключом читать копию, и то, что в ней ничего не осталось
   * открытым.
   */
  encryption: Record<string, number>;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** Отпечатки ключей, которыми связка умеет читать. */
const knownFingerprints = (keys: Keyring): Set<string> =>
  new Set([...(keys.active ? [keys.active.id] : []), ...keys.retired.keys()]);

/** Метка времени для имени файла: `20260908T105100Z`. */
const stampOf = (moment: Date): string => moment.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

const manifestPathOf = (archivePath: string): string => archivePath.replace(/\.db\.gz$/, ".json");

export interface CreateOptions {
  databasePath: string;
  directory: string;
  /** Ключи нужны только для чтения манифестных данных; сама копия побайтовая. */
  keys?: Keyring;
  now?: Date;
}

export interface BackupRecord {
  manifest: BackupManifest;
  /** Полный путь к архиву. */
  archivePath: string;
  manifestPath: string;
}

/** Снимает копию базы. Сервер при этом останавливать не нужно. */
export function createBackup(options: CreateOptions): BackupRecord {
  const { databasePath, directory, keys = NO_KEYS, now = new Date() } = options;
  if (!existsSync(databasePath)) throw new BackupError("database-missing", basename(databasePath));

  mkdirSync(directory, { recursive: true });

  const base = `${basename(databasePath).replace(/\.db$/, "")}-${stampOf(now)}`;
  let name = base;
  for (let attempt = 1; existsSync(join(directory, `${name}.db.gz`)); attempt += 1) name = `${base}-${attempt}`;

  const snapshot = join(directory, `${name}.snapshot`);
  rmSync(snapshot, { force: true });

  const db = openDatabase({ path: databasePath, keys });
  let version: string | null;
  let encryption: Record<string, number>;
  try {
    // Согласованный снимок вместе с журналом WAL, без остановки сервера.
    db.run("VACUUM INTO ?", [snapshot]);
    version = schemaVersion(db);
    encryption = markerCounts(db);
  } finally {
    db.close();
  }

  const archivePath = join(directory, `${name}.db.gz`);
  const archive = gzipSync(readFileSync(snapshot));
  writeFileSync(archivePath, archive);
  rmSync(snapshot, { force: true });

  const manifest: BackupManifest = {
    format: 1,
    createdAt: now.toISOString(),
    archive: `${name}.db.gz`,
    schemaVersion: version,
    bytes: archive.length,
    sha256: sha256(archive),
    encryption,
  };

  const manifestPath = manifestPathOf(archivePath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifest, archivePath, manifestPath };
}

/** Копии в каталоге, новые сначала. Файлы без манифеста не считаются копиями. */
export function listBackups(directory: string): BackupRecord[] {
  if (!existsSync(directory)) return [];

  const records: BackupRecord[] = [];
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    const manifestPath = join(directory, file);
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
    } catch {
      continue;
    }
    if (typeof manifest.archive !== "string" || typeof manifest.createdAt !== "string") continue;
    records.push({ manifest, archivePath: join(directory, manifest.archive), manifestPath });
  }

  return records.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

export interface PruneOptions {
  directory: string;
  keepDays: number;
  now?: Date;
}

/**
 * Удаляет копии старше срока хранения. Три последние остаются всегда: пустой
 * каталог копий — это отсутствие копий, а не выполненная политика хранения.
 */
export function pruneBackups(options: PruneOptions): string[] {
  const { directory, keepDays, now = new Date() } = options;
  const edge = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const record of listBackups(directory).slice(ALWAYS_KEEP)) {
    if (Date.parse(record.manifest.createdAt) >= edge) continue;
    rmSync(record.archivePath, { force: true });
    rmSync(record.manifestPath, { force: true });
    removed.push(record.manifest.archive);
  }

  return removed;
}

/** Копия и её манифест как одна пара. Проверяет отпечаток архива и ключи. */
export function verifyBackup(archivePath: string, keys: Keyring = NO_KEYS): BackupManifest {
  if (!existsSync(archivePath)) throw new BackupError("archive-missing", basename(archivePath));

  const manifestPath = manifestPathOf(archivePath);
  if (!existsSync(manifestPath)) throw new BackupError("manifest-missing", basename(manifestPath));

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  } catch {
    throw new BackupError("manifest-broken", basename(manifestPath));
  }

  const archive = readFileSync(archivePath);
  if (sha256(archive) !== manifest.sha256) throw new BackupError("archive-corrupted", manifest.archive);

  // Копия без ключа бесполезна, и узнать об этом лучше до восстановления.
  const known = knownFingerprints(keys);
  for (const marker of Object.keys(manifest.encryption ?? {})) {
    if (marker === PLAINTEXT) continue;
    const fingerprint = marker.split(":")[1] ?? "";
    if (!known.has(fingerprint)) throw new BackupError("key-missing", fingerprint);
  }

  return manifest;
}

export interface RestoreOptions {
  archivePath: string;
  /** Куда положить восстановленную базу. Обычно рабочий путь из настроек. */
  targetPath: string;
  keys?: Keyring;
  /** Перезаписать существующий файл базы. Служба при этом должна быть остановлена. */
  force?: boolean;
}

export interface RestoreReport {
  archive: string;
  targetPath: string;
  schemaVersion: string | null;
  profiles: number;
  /** Запись копии удалось прочитать активной связкой ключей. */
  readable: boolean;
}

/**
 * Восстановление из копии. Заканчивается не «файл на месте», а «запись
 * прочитана»: копия, которую нечем расшифровать, восстановлением не считается.
 */
export function restoreBackup(options: RestoreOptions): RestoreReport {
  const { archivePath, targetPath, keys = NO_KEYS, force = false } = options;
  const manifest = verifyBackup(archivePath, keys);

  if (existsSync(targetPath) && !force) throw new BackupError("target-exists", basename(targetPath));

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, gunzipSync(readFileSync(archivePath)));
  // Журнал прежней базы к восстановленному файлу не относится и испортил бы его.
  for (const suffix of ["-wal", "-shm"]) rmSync(`${targetPath}${suffix}`, { force: true });

  const db = openDatabase({ path: targetPath, keys });
  try {
    const problems = checkMigrations(db);
    if (problems.length) throw new BackupError("schema-incompatible", problems.map(problemLine).join(","));

    const total = db.get<{ total: number }>("SELECT COUNT(*) AS total FROM profiles")?.total ?? 0;
    const row = db.get<{ name_payload: string; name_enc: string }>(
      "SELECT name_payload, name_enc FROM profiles LIMIT 1",
    );

    let readable = total === 0;
    if (row) {
      try {
        readable = unseal(keys, { payload: row.name_payload, enc: row.name_enc }).length > 0;
      } catch {
        throw new BackupError("key-mismatch", manifest.archive);
      }
    }

    return { archive: manifest.archive, targetPath, schemaVersion: manifest.schemaVersion, profiles: total, readable };
  } finally {
    db.close();
  }
}

// ── Командная строка ──────────────────────────────────────────────────────────

function say(event: string, payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`);
}

async function main(): Promise<void> {
  const { ConfigError, loadConfig } = await import("../config.js");

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

  const command = process.argv[2] ?? "create";
  const positional = process.argv.slice(3).filter((argument) => !argument.startsWith("--"));
  const flag = (name: string): string | null => {
    const found = process.argv.find((argument) => argument.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : null;
  };

  const { directory, keepDays } = config.backup;

  try {
    if (command === "create") {
      const record = createBackup({ databasePath: config.databasePath, directory, keys: config.keys });
      say("backup.created", {
        archive: record.manifest.archive,
        bytes: record.manifest.bytes,
        schemaVersion: record.manifest.schemaVersion,
        keys: Object.keys(record.manifest.encryption),
      });
      return;
    }

    if (command === "list") {
      say("backup.list", {
        directory,
        copies: listBackups(directory).map((record) => ({
          archive: record.manifest.archive,
          createdAt: record.manifest.createdAt,
          bytes: record.manifest.bytes,
        })),
      });
      return;
    }

    if (command === "prune") {
      say("backup.pruned", { keepDays, removed: pruneBackups({ directory, keepDays }) });
      return;
    }

    if (command === "verify") {
      const archive = positional[0];
      if (!archive) throw new BackupError("archive-missing", "путь к архиву не указан");
      const manifest = verifyBackup(archive, config.keys);
      say("backup.verified", { archive: manifest.archive, createdAt: manifest.createdAt, bytes: manifest.bytes });
      return;
    }

    if (command === "restore") {
      const archive = positional[0];
      if (!archive) throw new BackupError("archive-missing", "путь к архиву не указан");
      const report = restoreBackup({
        archivePath: archive,
        targetPath: flag("to") ?? config.databasePath,
        keys: config.keys,
        force: process.argv.includes("--force"),
      });
      say("backup.restored", { ...report });
      return;
    }

    say("backup.error", { code: "unknown-command", command });
    process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof BackupError)) throw error;
    process.stderr.write(`${JSON.stringify({ event: "backup.failed", reason: error.message })}\n`);
    process.stderr.write(`Копия: ${backupHint(error)}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("backup.js")) await main();
