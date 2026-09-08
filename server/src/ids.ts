/**
 * Идентификаторы. Профиль адресуется идентификатором, а не логином, поэтому
 * идентификатор обязан быть неперебираемым: 128 бит из системного генератора
 * случайных чисел, запись base64url без выравнивающих знаков — 22 символа.
 *
 * Перебор соседних значений бессмыслен: соседних значений у случайного ключа нет.
 */

import { randomBytes } from "node:crypto";

const ENTROPY_BYTES = 16;

/** Длина идентификатора в символах: 16 байт в base64url. */
export const ID_LENGTH = 22;

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function generate(): string {
  return randomBytes(ENTROPY_BYTES).toString("base64url");
}

/** Идентификатор профиля: он же адрес страницы `/p/{profileId}`. */
export const newProfileId = generate;

/** Идентификатор внутренней записи: заказа, блока, версии, события. */
export const newRecordId = generate;

/**
 * Форма идентификатора. Проверяется до обращения к базе, чтобы перебор
 * не доходил до запроса.
 */
export function isValidId(candidate: string): boolean {
  return ID_PATTERN.test(candidate);
}
