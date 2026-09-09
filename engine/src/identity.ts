/**
 * Имя продукта и домен (`content/identity.md`).
 *
 * Один источник для юридки, писем, шеринговой картинки и интерфейса.
 * Пока реквизит не заполнен, картинка и подпись домена не собираются —
 * но имя и домен уже названы, поэтому `shareReady` без внешнего словаря
 * должен быть истинен.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import type { RawIdentity } from "./content-extra-types.js";
import type { ShareIdentity } from "./share.js";

export type { RawIdentity } from "./content-extra-types.js";

export const productIdentity = (): RawIdentity => rawExtraContent.identity;

/** Реквизиты, которыми заполняются `{{НАЗВАНИЕ_ПРОДУКТА}}` и `{{ДОМЕН}}`. */
export function identityRequisites(): ShareIdentity {
  const identity = productIdentity();
  return {
    НАЗВАНИЕ_ПРОДУКТА: identity.nameRu,
    ДОМЕН: identity.domain,
  };
}

export const productOrigin = (): string => productIdentity().origin;

export const productDomain = (): string => productIdentity().domain;
