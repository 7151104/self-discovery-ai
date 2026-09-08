/**
 * Макет шеринговой картинки (E6-11).
 *
 * На картинке три вещи и ни одной больше: фраза-крючок, карта и домен.
 * Блоков разбора нет — скриншотится крючок и карта (`docs/11-ui-page-spec.md`,
 * раздел «Виральность»).
 *
 * Здесь только геометрия: где что лежит и как разбита фраза. Рисование — в
 * `image.ts`. Разделение нужно, чтобы макет можно было проверить числами, а
 * не глазами по картинке.
 *
 * Позиция маркера берётся зоной, а не числом от сервера: точная позиция и есть
 * значение координаты, и на картинке ей тем более не место — картинку человек
 * отдаёт посторонним.
 */

import { zoneOf, type Zone } from "../components/map.js";
import { CHAR_WIDTH_RATIO, TOKENS } from "../tokens/tokens.js";
import type { MapBarDto } from "../src/contract.js";

/** Два формата предпросмотра: горизонтальный и вертикальный. */
export type ShareFormat = "landscape" | "portrait";

export interface FormatSpec {
  width: number;
  height: number;
  padding: number;
  /**
   * Одна колонка или две. Горизонтальный формат низкий: семь полос и крючок
   * друг под другом в него не помещаются, поэтому крючок слева, карта справа.
   */
  columns: 1 | 2;
  hookSize: number;
  /** Больше этого числа строк крючок не занимает: остальное обрезается. */
  hookLines: number;
  labelSize: number;
  domainSize: number;
  trackHeight: number;
  barGap: number;
}

/**
 * Размеры заданы числами, а не долями: картинка — единственное место, где
 * пиксель окончателен. У неё нет ни масштаба текста, ни ширины экрана, ни
 * настроек человека, поэтому «токен в rem» здесь смысла не имеет.
 */
export const FORMATS: Record<ShareFormat, FormatSpec> = {
  landscape: {
    width: 1200,
    height: 630,
    padding: 72,
    columns: 2,
    hookSize: 44,
    hookLines: 5,
    labelSize: 22,
    domainSize: 24,
    trackHeight: 16,
    barGap: 10,
  },
  portrait: {
    width: 1080,
    height: 1350,
    padding: 80,
    columns: 1,
    hookSize: 64,
    hookLines: 4,
    labelSize: 32,
    domainSize: 28,
    trackHeight: 22,
    barGap: 22,
  },
};

/** Доля ширины знака от размера шрифта. Берётся верхняя граница: с запасом. */
const CHAR_WIDTH = CHAR_WIDTH_RATIO.max;

/** Межстрочное крючка. Плотнее обычного: фраза — заголовок, а не абзац. */
const HOOK_LEADING = 1.2;

/** Обрезка длинной фразы. Многоточие — знак, а не сокращение слова. */
const ELLIPSIS = "…";

/**
 * Разбивка фразы на строки по ширине.
 *
 * Настоящие метрики шрифта здесь недоступны, поэтому ширина знака берётся
 * верхней границей диапазона: строка получится не длиннее рассчитанной, а
 * значит не вылезет за поле. Слово длиннее строки не разрывается — переносов
 * по слогам в картинке не будет.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (maxChars <= 0 || maxLines <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let index = 0;

  for (; index < words.length; index += 1) {
    const word = words[index] as string;
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= maxChars || current === "") {
      current = candidate;
      continue;
    }
    // Последняя разрешённая строка уже набрана — дальше не переносим.
    if (lines.length === maxLines - 1) break;
    lines.push(current);
    current = word;
  }
  if (current !== "") lines.push(current);

  if (index < words.length) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}${ELLIPSIS}`;
  }
  return lines;
}

export interface TextLine {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface BarLayout {
  label: TextLine;
  /** Дорожка оси. null — полоса категориальная, у неё точки, а не ось. */
  track: { x: number; y: number; width: number; height: number } | null;
  /** Маркер — только у заполненной полосы. Пустая остаётся контуром. */
  marker: { x: number; y: number; width: number; height: number } | null;
  /** Семь точек категориальной полосы, из них помечена одна. */
  dots: { cx: number; cy: number; r: number; selected: boolean }[] | null;
  fill: MapBarDto["fill"];
}

export interface ShareLayout {
  format: ShareFormat;
  width: number;
  height: number;
  columns: 1 | 2;
  hook: TextLine[];
  bars: BarLayout[];
  domain: TextLine;
}

/** Доля дорожки для зоны. Читается из токенов: второго списка чисел нет. */
export function zonePercent(zone: Zone): number {
  const value = TOKENS[`zone-${zone}`];
  if (value === undefined) throw new Error(`нет токена --zone-${zone}`);
  return Number.parseFloat(value) / 100;
}

export interface ShareData {
  hook: string;
  bars: MapBarDto[];
  /** Домен строкой. До ответа основателя — подстановка (открытый вопрос 4). */
  domain: string;
}

/** Ширина маркера точной полосы: засечка, как на странице. */
const MARKER_WIDTH = { precise: 6, approximate: 18 } as const;

export function shareLayout(data: ShareData, format: ShareFormat): ShareLayout {
  const spec = FORMATS[format];
  const content = spec.width - spec.padding * 2;
  const gap = spec.padding;

  // В две колонки: крючок слева, карта справа. В одну — крючок сверху.
  const hookWidth = spec.columns === 2 ? Math.round((content - gap) * 0.45) : content;
  const mapX = spec.columns === 2 ? spec.padding + hookWidth + gap : spec.padding;
  const mapWidth = spec.columns === 2 ? content - hookWidth - gap : content;

  const maxChars = Math.floor(hookWidth / (spec.hookSize * CHAR_WIDTH));
  const hookStep = Math.round(spec.hookSize * HOOK_LEADING);
  const hookLines = wrapText(data.hook, maxChars, spec.hookLines);
  const hook = hookLines.map((text, index) => ({
    text,
    x: spec.padding,
    y: spec.padding + spec.hookSize + index * hookStep,
    size: spec.hookSize,
  }));

  const domain = {
    text: data.domain,
    x: spec.padding,
    y: spec.height - spec.padding,
    size: spec.domainSize,
  };

  const barStep = spec.labelSize + spec.trackHeight + spec.barGap * 2;
  const mapHeight = data.bars.length * barStep;
  // В две колонки карта стоит по центру своей колонки, в одну — прижата к домену.
  const mapTop =
    spec.columns === 2
      ? Math.round((spec.height - mapHeight) / 2)
      : domain.y - spec.domainSize - spec.padding / 2 - mapHeight;

  const bars = data.bars.map((bar, index) => {
    const top = mapTop + index * barStep;
    const rowY = top + spec.labelSize + spec.barGap;
    const label = { text: bar.label, x: mapX, y: top + spec.labelSize, size: spec.labelSize };

    if (bar.category !== null) {
      const radius = Math.round(spec.trackHeight / 2);
      const step = bar.category.options.length <= 1 ? 0 : (mapWidth - radius * 2) / (bar.category.options.length - 1);
      const dots = bar.category.options.map((option, place) => ({
        cx: Math.round(mapX + radius + step * place),
        cy: rowY + radius,
        r: radius,
        selected: option === bar.category?.selected,
      }));
      return { label, track: null, marker: null, dots, fill: bar.fill };
    }

    const track = { x: mapX, y: rowY, width: mapWidth, height: spec.trackHeight };
    const width = bar.fill === "precise" ? MARKER_WIDTH.precise : MARKER_WIDTH.approximate;
    const marker =
      bar.fill === "empty" || bar.position === null
        ? null
        : {
            x: track.x + Math.round(track.width * zonePercent(zoneOf(bar.position))) - Math.round(width / 2),
            y: track.y,
            width,
            height: track.height,
          };

    return { label, track, marker, dots: null, fill: bar.fill };
  });

  return { format, width: spec.width, height: spec.height, columns: spec.columns, hook, bars, domain };
}
