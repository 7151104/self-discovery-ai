/**
 * Письма (`content/emails.md`).
 *
 * Русских строк здесь нет: тема и тело приходят из контента, код подставляет значения.
 * Забытая подстановка — ошибка, а не письмо с фигурными скобками в теме.
 *
 * Почта не основной носитель: адрес спрашиваем после первой порции, пропуск
 * допустим (вопрос 6 закрыт). Поэтому у каждого письма есть `withoutEmail` — место на
 * странице, которое говорит то же самое, и выключение писем ничего не ломает.
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

/**
 * Письма после события, если профиль не в кризисе. В кризисе — пусто: ни одно
 * письмо не уходит, продающее в том числе (`content/crisis.md`, E9-06).
 */
export function emailsAfterEvent(
  event: "slice_ready" | "page_link" | "receipt" | "refund",
  page: { crisis?: unknown | null },
): string[] {
  if (page.crisis) return [];
  const byEvent: Record<typeof event, string> = {
    slice_ready: "EMAIL_SLICE_READY",
    page_link: "EMAIL_PAGE_LINK",
    receipt: "EMAIL_RECEIPT",
    refund: "EMAIL_REFUND",
  };
  return [byEvent[event]];
}

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
