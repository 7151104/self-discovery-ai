/**
 * Экраны оплаты платных срезов (`content/slices/*.md`, раздел «Экран оплаты»).
 *
 * На экране одна цена и одна дверь: цена приходит полем `price` предложенного среза, а
 * состав — списком частей. Русских строк здесь нет, как и в остальном интерфейсе: рамка
 * экрана берётся из `content/ui-copy.md`, состав — отсюда.
 */

import { rawExtraContent } from "./generated/content-extra.js";
import type { RawPayScreen } from "./content-extra-types.js";

export type { RawPayScreen } from "./content-extra-types.js";

const BY_SLICE = new Map<string, RawPayScreen>(
  rawExtraContent.payScreens.map((screen) => [screen.slice, screen]),
);

/** Все экраны в порядке файла: нужен тестам и витрине компонентов. */
export const payScreens = (): RawPayScreen[] => rawExtraContent.payScreens;

export function payScreen(slice: string): RawPayScreen {
  const screen = BY_SLICE.get(slice);
  if (!screen) throw new Error(`content/slices: у среза ${slice} нет экрана оплаты`);
  return screen;
}

/** Состав одной строкой — так он стоит на экране под кнопкой. */
export const payContents = (slice: string, separator = " · "): string =>
  payScreen(slice).contents.join(separator);
