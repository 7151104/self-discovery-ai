/**
 * Шифрование чувствительных полей при хранении (E9-08).
 *
 * Решение по открытому вопросу 8: открытые ответы и тексты блоков шифруются.
 * Шифруется и всё остальное, что проходит через `seal`: имя, дата рождения,
 * снимок профиля. Разделять поля на «эти шифруем, эти нет» дороже, чем
 * шифровать всё: разделение придётся помнить при каждой новой колонке.
 *
 * Алгоритм — AES-256-GCM из `node:crypto`: аутентифицированное шифрование,
 * то есть подмена шифротекста обнаруживается при чтении, а не превращается
 * в мусор. Новой зависимости не требует.
 *
 * Ключ живёт в переменной окружения, в репозитории его нет и быть не может.
 * Метка записи содержит отпечаток ключа, поэтому в базе спокойно лежат записи,
 * сделанные разными ключами: чтение выбирает нужный по отпечатку.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Отпечаток ключа: попадает в метку записи и в журналы. Сам ключ по нему не восстанавливается. */
export const keyFingerprint = (key: Buffer): string =>
  createHash("sha256").update(key).digest("base64url").slice(0, 8);

export class KeyError extends Error {
  constructor(reason: string) {
    super(`encryption-key:${reason}`);
    this.name = "KeyError";
  }
}

/** Разбор ключа из переменной окружения: 32 байта в base64 или base64url. */
export function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new KeyError(`expected-${KEY_BYTES}-bytes-base64`);
  return key;
}

/** Новый ключ для `.env`. Печатается командой `npm run keygen`, в файлы не пишется. */
export const generateKey = (): string => randomBytes(KEY_BYTES).toString("base64");

export interface Keyring {
  /** Ключ, которым пишутся новые записи. null — шифрование выключено. */
  readonly active: { key: Buffer; id: string } | null;
  /** Ключи, которыми ещё можно читать: выведенные из обращения, но не стёртые. */
  readonly retired: Map<string, Buffer>;
}

export function buildKeyring(active: string | null, retired: string[]): Keyring {
  const retiredKeys = new Map<string, Buffer>();
  for (const raw of retired) {
    const key = parseKey(raw);
    retiredKeys.set(keyFingerprint(key), key);
  }

  if (active === null) return { active: null, retired: retiredKeys };

  const key = parseKey(active);
  const id = keyFingerprint(key);
  if (retiredKeys.has(id)) throw new KeyError("active-key-is-also-retired");
  return { active: { key, id }, retired: retiredKeys };
}

/** Пустая связка: шифрование выключено, читать зашифрованное нечем. */
export const NO_KEYS: Keyring = { active: null, retired: new Map() };

const keyById = (keyring: Keyring, id: string): Buffer | null => {
  if (keyring.active && keyring.active.id === id) return keyring.active.key;
  return keyring.retired.get(id) ?? null;
};

/**
 * Шифрует строку. Возвращает метку `aes-256-gcm:<отпечаток>` и тело
 * `iv.tag.шифротекст` в base64url: разделитель однозначен, потому что
 * base64url его не использует.
 */
export function encrypt(keyring: Keyring, text: string): { payload: string; enc: string } {
  const active = keyring.active;
  if (!active) throw new KeyError("no-active-key");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, active.key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    payload: [iv, tag, body].map((part) => part.toString("base64url")).join("."),
    enc: `${ALGORITHM}:${active.id}`,
  };
}

export class DecryptError extends Error {
  constructor(reason: string) {
    super(`decrypt:${reason}`);
    this.name = "DecryptError";
  }
}

/** Расшифровывает строку. Незнакомый ключ и подмена шифротекста — отказ, а не мусор. */
export function decrypt(keyring: Keyring, payload: string, enc: string): string {
  const [algorithm, id] = enc.split(":");
  if (algorithm !== ALGORITHM || !id) throw new DecryptError(`unsupported-marker:${enc}`);

  const key = keyById(keyring, id);
  if (!key) throw new DecryptError(`unknown-key:${id}`);

  const parts = payload.split(".");
  if (parts.length !== 3) throw new DecryptError("malformed-payload");

  const [iv, tag, body] = parts.map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body || iv.length !== IV_BYTES) throw new DecryptError("malformed-payload");

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError("authentication-failed");
  }
}

/** Сравнение подписей вебхуков. Вынесено сюда, чтобы `node:crypto` звали из одного места. */
export function equalSignatures(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
