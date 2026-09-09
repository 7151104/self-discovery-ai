/**
 * Шеринговая картинка (`content/share.md`).
 *
 * Подписи картинки лежат вне реестра микрокопии: в них нужны имя продукта и домен
 * из `content/identity.md`. Пока хотя бы одна подстановка не заполнена,
 * `shareCaption` бросает исключение — вместо картинки с мёртвым адресом в чужом чате.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import type { RawShare, RawShareCaption, RawShareFormat, RawShareLayer } from "./content-extra-types.js";

export type { RawShare, RawShareCaption, RawShareFormat, RawShareLayer } from "./content-extra-types.js";

const BY_ID = new Map<string, RawShareCaption>(rawExtraContent.share.captions.map((caption) => [caption.id, caption]));

/** Реквизиты основателя: имя подстановки → значение. Список имён — `content/legal/README.md`. */
export type ShareIdentity = Record<string, string>;

export const share = (): RawShare => rawExtraContent.share;

export const shareLayers = (): RawShareLayer[] => rawExtraContent.share.layers;

export const shareFormats = (): RawShareFormat[] => rawExtraContent.share.formats;

export const shareCaptionIds = (): string[] => [...BY_ID.keys()];

export function shareCaptionRaw(id: string): RawShareCaption {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`content/share.md: нет подписи ${id}`);
  return found;
}

/** Подпись с подставленными реквизитами. Незаполненный реквизит — ошибка сборки картинки. */
export function shareCaption(id: string, identity: ShareIdentity = {}): string {
  const found = shareCaptionRaw(id);
  return found.text.replace(/\{\{([^}]+)\}\}/g, (_, name: string) => {
    const value = identity[name];
    if (!value) throw new Error(`${id}: реквизит {{${name}}} не заполнен — картинка не собирается`);
    return value;
  });
}

/** Готова ли картинка к сборке: все реквизиты во всех подписях заполнены. */
export const shareReady = (identity: ShareIdentity): boolean =>
  rawExtraContent.share.captions.every((caption) => caption.placeholders.every((name) => Boolean(identity[name])));
