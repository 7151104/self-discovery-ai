/**
 * Чувствительный текст в базе.
 *
 * Значение хранится парой колонок: `*_payload` — строка, `*_enc` — метка того,
 * как она записана. Схема эту пару завела ещё в E3-03, когда решение о
 * шифровании не было принято; E9-08 наполнил её содержанием, не тронув таблицы.
 *
 * Метки две по смыслу:
 *   `none`                     — открытый текст (записи до включения шифрования
 *                                и окружение разработки без ключа);
 *   `aes-256-gcm:<отпечаток>`  — шифротекст, отпечаток называет ключ.
 *
 * Читается и то и другое, пишется всегда активным ключом, если он есть.
 * Незнакомая метка или незнакомый ключ — отказ, а не тихая выдача шифротекста.
 */

import { decrypt, encrypt, type Keyring } from "./crypto.js";

/** Метка того, как записана строка. */
export type EncMarker = string;

export const PLAINTEXT: EncMarker = "none";

export interface StoredText {
  payload: string;
  enc: EncMarker;
}

/** Подготовить строку к записи. Без активного ключа пишется открытым текстом. */
export function seal(keys: Keyring, text: string): StoredText {
  if (!keys.active) return { payload: text, enc: PLAINTEXT };
  return encrypt(keys, text);
}

/** Прочитать строку из базы. */
export function unseal(keys: Keyring, stored: StoredText): string {
  if (stored.enc === PLAINTEXT) return stored.payload;
  return decrypt(keys, stored.payload, stored.enc);
}

/** Строка, которой может не быть (дата рождения не обязательна). */
export function unsealOptional(keys: Keyring, payload: string | null, enc: EncMarker): string | null {
  return payload === null ? null : unseal(keys, { payload, enc });
}
