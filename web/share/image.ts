/**
 * Генератор шеринговой картинки (E6-11).
 *
 * Чистая функция «данные страницы → изображение». Ни сети, ни файлов, ни
 * серверного кода: подключение к маршруту сервера — отдельная задача владельца
 * сервера, генератору для неё достаточно быть функцией.
 *
 * Формат — SVG. Решение и его цена записаны в журнал (`docs/14-state.md`,
 * E6-11): растровая генерация тянет зависимость с бинарями, а критерий выбора
 * из маршрута — работоспособность в целевом окружении без ручной установки
 * шрифтов. SVG получается детерминированным, самодостаточным и проверяемым
 * текстом; растеризация в PNG — E10, вместе с окружением деплоя.
 *
 * Одинаковость на любом устройстве обеспечивается двумя вещами:
 *   1. картинка собирается один раз и отдаётся всем готовой;
 *   2. шрифт вшивается в документ (`font`), внешних ссылок в SVG нет вовсе.
 * Без вшитого шрифта документ собирается, но честно помечается системным —
 * `deviceIndependent` в этом случае false.
 *
 * Наружу не выходит ничего, кроме крючка, карты и домена: ни имени, ни блоков
 * разбора, ни чисел, ни процентов. Позиция маркера — зона, а не значение.
 */

import { escapeHtml } from "../src/dom.js";
import { TOKENS } from "../tokens/tokens.js";
import type { PageStateDto } from "../src/contract.js";
import { FORMATS, shareLayout, type ShareData, type ShareFormat, type ShareLayout } from "./layout.js";

/**
 * Имя продукта и домен основателем не названы (`docs/14-state.md`, вопрос 4).
 * До ответа в картинку идёт подстановка — так же, как в юридических текстах.
 */
export const DOMAIN_PLACEHOLDER = "{{ДОМЕН}}";

/** Шрифт, вшиваемый в документ: имя семейства и данные файла в base64. */
export interface EmbeddedFont {
  family: string;
  /** `woff2`, `woff` или `truetype`. */
  format: string;
  base64: string;
}

export interface ShareOptions {
  format?: ShareFormat;
  /**
   * Вшиваемый шрифт. Без него текст рисуется системным гротеском и картинка
   * перестаёт быть одинаковой на любом устройстве — это и показывает
   * `deviceIndependent`.
   */
  font?: EmbeddedFont | null;
}

export interface ShareImage {
  format: ShareFormat;
  width: number;
  height: number;
  /** Тип содержимого для отдачи с сервера. */
  mediaType: "image/svg+xml";
  svg: string;
  /** Шрифт вшит, внешних ссылок нет: на любом устройстве одно и то же. */
  deviceIndependent: boolean;
}

/** Цвета картинки. Берутся из той же шкалы, что и страница. */
const color = (name: string): string => {
  const value = TOKENS[name];
  if (value === undefined) throw new Error(`нет токена --${name}`);
  return value;
};

/** Системный запасной набор — тот же, что на странице. */
const SYSTEM_FAMILY = color("font-family");
const DISPLAY_FAMILY = color("font-display");

const rect = (
  box: { x: number; y: number; width: number; height: number },
  fill: string,
  extra = "",
): string => `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${fill}"${extra} />`;

const text = (
  line: { text: string; x: number; y: number; size: number },
  fill: string,
  weight: number,
  kind: "hook" | "ui" = "ui",
): string =>
  `<text class="${kind}" x="${line.x}" y="${line.y}" font-size="${line.size}" font-weight="${weight}" fill="${fill}">${escapeHtml(line.text)}</text>`;

function fontFace(font: EmbeddedFont | null | undefined): string {
  if (!font) return "";
  return [
    "@font-face {",
    `  font-family: "${font.family}";`,
    `  src: url(data:font/${font.format};base64,${font.base64}) format("${font.format}");`,
    "  font-display: block;",
    "}",
  ].join("\n    ");
}

function body(layout: ShareLayout): string {
  const parts: string[] = [];

  for (const line of layout.hook) parts.push(text(line, color("color-text-strong"), 640, "hook"));

  for (const bar of layout.bars) {
    parts.push(text(bar.label, color("color-text-soft"), 500));

    if (bar.track !== null) {
      const empty = bar.fill === "empty";
      parts.push(
        rect(
          bar.track,
          empty ? "none" : color("color-surface-inset"),
          ` rx="${Math.round(bar.track.height / 2)}" stroke="${color("color-line-strong")}" stroke-width="2"${empty ? ' stroke-dasharray="10 8"' : ""}`,
        ),
      );
    }

    if (bar.marker !== null) {
      const precise = bar.fill === "precise";
      parts.push(
        rect(
          bar.marker,
          color("color-accent"),
          ` rx="${precise ? 2 : Math.round(bar.marker.height / 2)}"${precise ? "" : ' opacity="0.6"'}`,
        ),
      );
    }

    for (const dot of bar.dots ?? []) {
      parts.push(
        `<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="${dot.selected ? color("color-accent") : "none"}" stroke="${color("color-line-strong")}" stroke-width="2" />`,
      );
    }
  }

  parts.push(text(layout.domain, color("color-text-soft"), 500));
  return parts.join("\n  ");
}

/** Данные картинки из состояния страницы. null — делиться ещё нечем. */
export function shareDataFromPage(page: PageStateDto, domain = DOMAIN_PLACEHOLDER): ShareData | null {
  if (page.hook === null) return null;
  return { hook: page.hook, bars: page.map, domain };
}

export function shareImage(data: ShareData, options: ShareOptions = {}): ShareImage {
  const format = options.format ?? "landscape";
  const spec = FORMATS[format];
  const layout = shareLayout(data, format);
  const font = options.font ?? null;
  const family = font === null ? SYSTEM_FAMILY : `"${font.family}", ${SYSTEM_FAMILY}`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" data-font="${font === null ? "system" : "embedded"}">`,
    "  <style>",
    `    ${fontFace(font)}`,
    `    text { font-family: ${family}; }`,
    `    text.hook { font-family: ${font === null ? DISPLAY_FAMILY : family}; }`,
    "  </style>",
    `  ${rect({ x: 0, y: 0, width: spec.width, height: spec.height }, color("color-surface-page"))}`,
    `  ${body(layout)}`,
    "</svg>",
    "",
  ].join("\n");

  return {
    format,
    width: spec.width,
    height: spec.height,
    mediaType: "image/svg+xml",
    svg,
    deviceIndependent: font !== null,
  };
}

/** Оба формата разом: предпросмотр ссылки и вертикальная карточка. */
export const shareImages = (data: ShareData, options: Omit<ShareOptions, "format"> = {}): ShareImage[] =>
  (Object.keys(FORMATS) as ShareFormat[]).map((format) => shareImage(data, { ...options, format }));
