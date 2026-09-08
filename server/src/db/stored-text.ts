/**
 * Чувствительный текст в базе.
 *
 * Открытый вопрос 8 из `docs/14-state.md` — шифровать ли открытые ответы и
 * тексты блоков — пока без ответа основателя. Схема к обоим ответам готова:
 * значение хранится парой «строка + метка записи», и включение шифрования
 * (E9-08) меняет только содержимое пары, а не таблицы.
 */

/**
 * Метка того, как записана строка. Сейчас единственная — 'none'.
 * Будущие значения вида 'aes-256-gcm:<идентификатор ключа>' позволят
 * держать в базе одновременно старые и новые записи во время смены ключа.
 */
export type EncMarker = string;

export const PLAINTEXT: EncMarker = "none";

export interface StoredText {
  payload: string;
  enc: EncMarker;
}

/** Подготовить строку к записи. */
export function seal(text: string): StoredText {
  return { payload: text, enc: PLAINTEXT };
}

/** Прочитать строку из базы. Незнакомая метка — отказ, а не тихая выдача шифротекста. */
export function unseal(stored: StoredText): string {
  if (stored.enc !== PLAINTEXT) throw new Error(`unsupported-encryption:${stored.enc}`);
  return stored.payload;
}

/** Строка, которой может не быть (дата рождения не обязательна). */
export function unsealOptional(payload: string | null, enc: EncMarker): string | null {
  return payload === null ? null : unseal({ payload, enc });
}
