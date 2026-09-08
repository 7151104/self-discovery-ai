/**
 * Доступ к реестру микрокопии на клиенте.
 *
 * Правило то же, что в движке: обращение к несуществующему идентификатору и
 * забытая подстановка — ошибка, а не пустое место на экране. Пустоту в
 * интерфейсе не видно до продакшена.
 *
 * Почему не импортируется `engine/src/ui-copy.ts`: движок в браузер не
 * уезжает (`web/src/budget.test.ts` это и проверяет). Данные приходят из
 * общего источника — `content/ui-copy.md` через `web/scripts/build-copy.mjs`,
 * а тест `copy.test.ts` требует, чтобы обе функции чтения отвечали одинаково
 * на каждый идентификатор реестра. Разъехаться молча они не могут.
 */

import { UI_COPY, type CopyEntry } from "./generated/ui-copy.js";

export type { CopyEntry } from "./generated/ui-copy.js";

export type CopyParams = Record<string, string | number>;

/** Все идентификаторы реестра. */
export const copyIds = (): string[] => Object.keys(UI_COPY);

/** Строки одной группы в порядке файла. */
export const copyGroup = (group: string): { id: string; entry: CopyEntry }[] =>
  Object.entries(UI_COPY)
    .filter(([, entry]) => entry.group === group)
    .map(([id, entry]) => ({ id, entry }));

export function copy(id: string, params: CopyParams = {}): string {
  const entry = UI_COPY[id];
  if (entry === undefined) throw new Error(`content/ui-copy.md: нет строки ${id}`);

  for (const name of entry.params) {
    if (params[name] === undefined) throw new Error(`${id}: не передана подстановка {${name}}`);
  }
  for (const name of Object.keys(params)) {
    if (!entry.params.includes(name)) throw new Error(`${id}: подстановки {${name}} в тексте нет`);
  }

  return entry.text.replace(/\{([а-яё]+)\}/g, (_, name: string) => String(params[name]));
}

/** Строка есть в реестре: нужно там, где идентификатор собирается из данных. */
export const hasCopy = (id: string): boolean => UI_COPY[id] !== undefined;
