/**
 * Приёмка E6-11: шеринговая картинка.
 *
 * «Картинка одинакова на любом устройстве и содержит только крючок, карту и
 * домен» — проверяется по документу, а не по внешнему виду: тексты в SVG
 * пересчитываются, внешние ссылки запрещаются, повторный вызов сравнивается
 * побайтно.
 *
 * Отдельно — то, что на картинку не должно попасть: числа, проценты, имя
 * человека, блоки разбора и значение координаты (позиция маркера сведена к
 * зоне, как и на странице).
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOKENS } from "../tokens/tokens.js";
import { webRoot } from "../src/paths.js";
import { ZONES, zoneOf } from "../components/map.js";
import * as mock from "../showcase/mocks.js";
import { pageStates } from "../showcase/page-states.js";
import { DOMAIN_PLACEHOLDER, shareDataFromPage, shareImage, shareImages, type EmbeddedFont } from "./image.js";
import { FORMATS, shareLayout, wrapText, zonePercent } from "./layout.js";

const FONT: EmbeddedFont = { family: "Разбор", format: "woff2", base64: "d09GMgABAAAAAA" };

const data = () => {
  const source = shareDataFromPage(pageStates.paidDone);
  assert.ok(source !== null, "на состоянии с крючком делиться уже есть чем");
  return source;
};

const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1] ?? "");

test("два формата: 1200×630 и 1080×1350", () => {
  const images = shareImages(data(), { font: FONT });
  assert.deepEqual(
    images.map((image) => [image.width, image.height]),
    [
      [1200, 630],
      [1080, 1350],
    ],
  );
  for (const image of images) {
    assert.match(image.svg, new RegExp(`viewBox="0 0 ${image.width} ${image.height}"`));
    assert.equal(image.mediaType, "image/svg+xml");
  }
});

test("на картинке только крючок, карта и домен", () => {
  const image = shareImage(data(), { font: FONT });
  const shown = texts(image.svg);

  const expected = [
    ...shareLayout(data(), "landscape").hook.map((line) => line.text),
    ...data().bars.map((bar) => bar.label),
    DOMAIN_PLACEHOLDER,
  ];
  assert.deepEqual(shown, expected, "на картинке появился текст, которого в макете нет");

  // Блоков разбора, имени и темы периода на картинке нет.
  for (const forbidden of [mock.card.name, mock.block.heading, mock.block.paragraphs[0] as string]) {
    assert.equal(image.svg.includes(forbidden), false, `на картинке «${forbidden.slice(0, 30)}»`);
  }
});

test("ни чисел, ни процентов в тексте картинки", () => {
  const image = shareImage(data(), { font: FONT });
  for (const line of texts(image.svg)) {
    assert.equal(/\d|%/.test(line.replace(DOMAIN_PLACEHOLDER, "")), false, `в тексте картинки число: ${line}`);
  }
});

test("позиция маркера — зона, а не значение координаты", () => {
  const source = data();
  const axis = source.bars.find((bar) => bar.position !== null && bar.fill !== "empty");
  assert.ok(axis !== undefined);

  const withPosition = (position: number) => ({
    ...source,
    bars: source.bars.map((bar) => (bar.id === axis.id ? { ...bar, position } : bar)),
  });
  const svg = (position: number) => shareImage(withPosition(position), { font: FONT }).svg;

  // Две позиции внутри одной зоны дают побайтно одну картинку: по ней значение
  // координаты не восстанавливается даже приблизительно.
  assert.equal(zoneOf(0.72), zoneOf(0.79));
  assert.equal(svg(0.72), svg(0.79), "картинка отличила две позиции внутри одной зоны");

  // Соседняя зона видна: карта всё-таки что-то показывает.
  assert.notEqual(zoneOf(0.72), zoneOf(0.88));
  assert.notEqual(svg(0.72), svg(0.88));

  // Маркер стоит ровно в одном из семи положений шкалы зон.
  const layout = shareLayout(source, "landscape");
  for (const bar of layout.bars) {
    if (bar.marker === null || bar.track === null) continue;
    const centre = bar.marker.x + bar.marker.width / 2 - bar.track.x;
    const places = ZONES.map((zone) => Math.round(bar.track!.width * zonePercent(zone)));
    assert.ok(places.some((place) => Math.abs(place - centre) <= 1), `маркер вне шкалы зон: ${centre}`);
  }
});

test("картинка самодостаточна: ни одной внешней ссылки", () => {
  for (const image of shareImages(data(), { font: FONT })) {
    assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(image.svg), false, "в картинке внешняя ссылка");
    assert.equal(image.svg.includes("<image"), false, "в картинке внешнее изображение");
    assert.equal(image.svg.includes("xlink:href"), false, "в картинке внешняя ссылка");
    assert.match(image.svg, /url\(data:font\//, "шрифт не вшит");
    assert.equal(image.deviceIndependent, true);
  }
});

test("без вшитого шрифта одинаковость не обещается", () => {
  const image = shareImage(data());
  assert.equal(image.deviceIndependent, false);
  assert.match(image.svg, /data-font="system"/);
  assert.equal(image.svg.includes("@font-face"), false);
});

test("одни и те же данные дают побайтно одну и ту же картинку", () => {
  const first = shareImage(data(), { font: FONT });
  const second = shareImage(data(), { font: FONT });
  assert.equal(first.svg, second.svg);
  assert.equal(first.svg.includes("Math.random"), false);
});

test("цвета картинки взяты из шкалы токенов", () => {
  const image = shareImage(data(), { font: FONT });
  const known = new Set(Object.values(TOKENS));
  for (const match of image.svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
    const value = match[1] ?? "";
    if (value === "none") continue;
    assert.ok(known.has(value), `цвет ${value} мимо шкалы токенов`);
  }
});

test("делиться нечем, пока нет крючка", () => {
  assert.equal(shareDataFromPage(pageStates.s0), null);
  assert.ok(shareDataFromPage(pageStates.s1) !== null);
});

test("домен и имя продукта — подстановка, а не выдумка", () => {
  const image = shareImage(data(), { font: FONT });
  assert.ok(image.svg.includes(DOMAIN_PLACEHOLDER), "на картинке должен быть домен из идентичности");

  const sources = [join(webRoot, "share"), join(webRoot, "components"), join(webRoot, "src")].flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => ({ name, source: readFileSync(join(directory, name), "utf8") })),
  );
  for (const file of sources) {
    const withoutComments = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const found = [...withoutComments.matchAll(/["'`][^"'`\s]*\.(?:ru|com|io|app|dev)\b[^"'`\s]*["'`]/g)];
    assert.deepEqual(found.map((match) => match[0]), [], `${file.name}: домен зашит в код, а не взят из идентичности`);
  }
});

test("фраза переносится по словам и обрезается многоточием", () => {
  assert.deepEqual(wrapText("один два три четыре", 9, 3), ["один два", "три", "четыре"]);
  assert.deepEqual(wrapText("один два три четыре", 9, 2), ["один два", "три…"]);
  // Слово длиннее строки не разрывается: переносов по слогам в картинке нет.
  assert.deepEqual(wrapText("длинноесловоцеликом", 5, 2), ["длинноесловоцеликом"]);
});

test("крючок и карта помещаются в поля обоих форматов", () => {
  for (const format of ["landscape", "portrait"] as const) {
    const spec = FORMATS[format];
    const layout = shareLayout(data(), format);

    assert.ok(layout.hook.length > 0 && layout.hook.length <= spec.hookLines);
    const lastHook = layout.hook[layout.hook.length - 1] as { y: number; size: number };
    const firstBar = layout.bars[0] as { label: { x: number; y: number } };

    if (layout.columns === 1) {
      assert.ok(lastHook.y < firstBar.label.y - firstBar.label.y * 0, `${format}: крючок налезает на карту`);
      assert.ok(lastHook.y + lastHook.size < firstBar.label.y, `${format}: крючок налезает на карту`);
    } else {
      // Две колонки: карта начинается правее самой длинной строки крючка.
      const widest = Math.max(...layout.hook.map((line) => line.text.length * line.size * 0.54));
      assert.ok(spec.padding + widest <= firstBar.label.x, `${format}: крючок налезает на карту`);
    }

    for (const bar of layout.bars) {
      const right =
        bar.track === null
          ? Math.max(...(bar.dots ?? []).map((dot) => dot.cx + dot.r))
          : bar.track.x + bar.track.width;
      assert.ok(right <= spec.width - spec.padding, `${format}: полоса вылезает за поле`);
      assert.ok(bar.label.y > spec.padding / 2, `${format}: подпись полосы выше поля`);
      if (bar.marker !== null) {
        assert.ok(bar.marker.x >= spec.padding - bar.marker.width, `${format}: маркер левее поля`);
        assert.ok(bar.marker.x + bar.marker.width <= spec.width - spec.padding + bar.marker.width);
      }
    }

    const lastBar = layout.bars[layout.bars.length - 1] as {
      track: { y: number; height: number } | null;
      dots: { cy: number; r: number }[] | null;
      label: { y: number };
    };
    const bottom =
      lastBar.track === null
        ? Math.max(...(lastBar.dots ?? []).map((dot) => dot.cy + dot.r))
        : lastBar.track.y + lastBar.track.height;
    assert.ok(bottom <= spec.height - spec.padding, `${format}: карта вылезает за нижнее поле`);
    if (layout.columns === 1) {
      assert.ok(bottom < layout.domain.y - spec.domainSize / 2, `${format}: карта налезает на домен`);
    }
    assert.ok(layout.domain.y <= spec.height - spec.padding, `${format}: домен ниже картинки`);
  }
});

test("категориальная полоса на картинке — семь точек, помечена одна", () => {
  const layout = shareLayout(data(), "portrait");
  const categorical = layout.bars.filter((bar) => bar.dots !== null);
  assert.equal(categorical.length, 1, "категориальная полоса на карте одна");
  const dots = categorical[0]?.dots ?? [];
  assert.equal(dots.length, 7);
  assert.equal(dots.filter((dot) => dot.selected).length, 1);
});

test("SVG — разобранный документ, а не строка с надеждой", () => {
  const svg = shareImage(data(), { font: FONT }).svg;
  const open = [...svg.matchAll(/<([a-z]+)(?=[\s>])/g)].map((match) => match[1]);
  const close = [...svg.matchAll(/<\/([a-z]+)>/g)].map((match) => match[1]);
  const selfClosed = [...svg.matchAll(/<([a-z]+)[^>]*\/>/g)].map((match) => match[1]);

  const opened = open.filter((tag) => !selfClosed.includes(tag) || close.includes(tag));
  assert.ok(opened.length > 0);
  for (const tag of new Set(close)) {
    assert.equal(
      open.filter((item) => item === tag).length,
      close.filter((item) => item === tag).length,
      `тег ${tag} не закрыт`,
    );
  }
  assert.equal(svg.trimEnd().endsWith("</svg>"), true);
  assert.equal(/&(?!amp;|lt;|gt;|quot;|#)/.test(svg), false, "неэкранированный амперсанд ломает XML");
});
