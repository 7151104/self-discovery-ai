/**
 * Контраст по WCAG и перевод цвета в градации серого.
 *
 * Нужен двум проверкам приёмки: контраст текста (E6-03) и различимость
 * состояний без цвета (E6-06, E6-07). Обе — автопроверки, а не утверждения.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`не цвет: ${hex}`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

const channel = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Отношение контраста двух цветов: от 1:1 до 21:1. */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(parseHex(foreground));
  const second = relativeLuminance(parseHex(background));
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/** Округление до сотых: контраст сравнивается как число, а не как строка. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;
