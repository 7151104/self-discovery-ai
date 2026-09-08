/**
 * Письма (`content/emails.md`).
 *
 * Русских строк здесь нет: тема и тело приходят из контента, код подставляет значения.
 * Забытая подстановка — ошибка, а не письмо с фигурными скобками в теме.
 *
 * Почта не основной носитель: собираем ли мы адрес вообще, ещё не решено (открытый
 * вопрос 6). Поэтому у каждого письма есть `withoutEmail` — место на странице, которое
 * говорит то же самое, и выключение писем ничего не ломает.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import type { RawEmail, RawEmailFooter } from "./content-extra-types.js";

export type { RawEmail, RawEmailFooter } from "./content-extra-types.js";

const BY_ID = new Map<string, RawEmail>(rawExtraContent.emails.emails.map((email) => [email.id, email]));

export type EmailParams = Record<string, string | number>;

export const emailIds = (): string[] => [...BY_ID.keys()];

export const emails = (): RawEmail[] => rawExtraContent.emails.emails;

/** Общий подвал: стоит под телом каждого письма. */
export const emailFooter = (): RawEmailFooter[] => rawExtraContent.emails.footer;

export function email(id: string): RawEmail {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`content/emails.md: нет письма ${id}`);
  return found;
}

const substitute = (text: string, id: string, params: EmailParams): string =>
  text.replace(/\{([а-яё]+)\}/g, (_, name: string) => {
    if (params[name] === undefined) throw new Error(`${id}: не передана подстановка {${name}}`);
    return String(params[name]);
  });

/** Тема и абзацы тела с подставленными значениями. Подвал прибавляет отправитель. */
export function renderEmail(id: string, params: EmailParams = {}): { subject: string; body: string[] } {
  const found = email(id);
  for (const name of Object.keys(params)) {
    if (!found.params.includes(name)) throw new Error(`${id}: подстановки {${name}} в письме нет`);
  }
  return {
    subject: substitute(found.subject, id, params),
    body: found.body.map((paragraph) => substitute(paragraph, id, params)),
  };
}
