/**
 * Доступ к реестру микрокопии (`content/ui-copy.md`).
 *
 * Русских строк в коде нет: интерфейс просит текст по идентификатору. Обращение к
 * несуществующему идентификатору или забытая подстановка — ошибка, а не пустая
 * строка на экране: пустоту в интерфейсе не видно до продакшена.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import type { RawUiCopy } from "./content-extra-types.js";

export type { RawUiCopy } from "./content-extra-types.js";

const BY_ID = new Map<string, RawUiCopy>(rawExtraContent.uiCopy.map((entry) => [entry.id, entry]));

/** Все идентификаторы реестра: нужен тестам и витрине компонентов. */
export const uiCopyIds = (): string[] => [...BY_ID.keys()];

/** Строки одной группы в порядке файла. */
export const uiCopyGroup = (group: string): RawUiCopy[] =>
  rawExtraContent.uiCopy.filter((entry) => entry.group === group);

export type UiCopyParams = Record<string, string | number>;

export function uiCopy(id: string, params: UiCopyParams = {}): string {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`content/ui-copy.md: нет строки ${id}`);

  for (const name of entry.params) {
    if (params[name] === undefined) throw new Error(`${id}: не передана подстановка {${name}}`);
  }
  for (const name of Object.keys(params)) {
    if (!entry.params.includes(name)) throw new Error(`${id}: подстановки {${name}} в тексте нет`);
  }

  return entry.text.replace(/\{([а-яё]+)\}/g, (_, name: string) => String(params[name]));
}

/** Подписи одной полосы карты по номеру её координаты. */
export function barCopy(coordinate: number): {
  label: string;
  poles: { low: string; high: string } | null;
  empty: string;
} {
  const label = uiCopy(`UI_MAP_BAR_${coordinate}_LABEL`);
  const empty = uiCopy(`UI_MAP_BAR_${coordinate}_EMPTY`);
  const hasPoles = BY_ID.has(`UI_MAP_BAR_${coordinate}_LOW`);
  return {
    label,
    poles: hasPoles
      ? { low: uiCopy(`UI_MAP_BAR_${coordinate}_LOW`), high: uiCopy(`UI_MAP_BAR_${coordinate}_HIGH`) }
      : null,
    empty,
  };
}
