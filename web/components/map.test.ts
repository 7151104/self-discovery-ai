/**
 * Визуальная карта (E6-07).
 *
 * Приёмка: карта помещается в 360×640 без скролла; три состояния полосы
 * различимы без цвета; ни чисел, ни процентов, ни названий координат в
 * разметке; маркер анимируется один раз за 400–600 мс.
 *
 * Состав полос сверяется с таблицей в `docs/11-ui-page-spec.md`, а не с
 * копией списка в коде: документ остаётся источником правды.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderMap, zoneOf, ZONES, barDescription } from "./map.js";
import { allDeclarations, declared, declaredPx } from "../src/css.js";
import { componentLookup, tokenPixels } from "../src/test-support.js";
import { renderToString, visibleText } from "../src/dom.js";
import { BASE_VIEWPORT_HEIGHT_PX, MARKER_DURATION_RANGE } from "../tokens/tokens.js";
import { repoRoot } from "../src/paths.js";
import * as mock from "../showcase/mocks.js";

const lookup = componentLookup();

const map = (bars = mock.mapBars, animated?: ReadonlySet<string>) =>
  renderMap({
    bars,
    label: mock.mapLabel,
    zoneLabel: mock.zoneLabel,
    fillLabels: mock.fillLabels,
    ...(animated === undefined ? {} : { animated }),
  });

const html = (bars = mock.mapBars) => renderToString(map(bars));

const doc = (name: string): string => readFileSync(join(repoRoot, "docs", name), "utf8");

// ── Состав полос ──────────────────────────────────────────────────────────────

test("полос ровно семь, состав и подписи совпадают с docs/11-ui-page-spec.md", () => {
  const rows = doc("11-ui-page-spec.md")
    .split("\n")
    .filter((line) => /^\|/.test(line) && /\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

  assert.equal(rows.length, 7, `в документе ${rows.length} полос`);
  assert.equal(mock.mapBars.length, 7);

  for (const [index, row] of rows.entries()) {
    const bar = mock.mapBars[index];
    assert.ok(bar !== undefined);
    assert.equal(bar.label, row[0], `полоса ${index + 1}`);
    if (bar.poles !== null) {
      assert.equal(bar.poles.low, row[2]);
      assert.equal(bar.poles.high, row[3]);
    }
  }
});

// ── Наружу не выходят координаты ──────────────────────────────────────────────

test("у карты видимый заголовок, не только подпись скринридера", () => {
  const node = map();
  assert.equal(node.tag, "section");
  assert.ok(visibleText(node).includes(mock.mapLabel));
});

test("в разметке карты нет ни одной цифры и ни одного процента", () => {
  const markup = html();
  assert.equal(/\d/.test(markup), false, `цифра в разметке: ${/.{0,40}\d.{0,40}/.exec(markup)?.[0]}`);
  assert.equal(markup.includes("%"), false, "процент в разметке");
});

test("в разметке карты нет названий координат из docs/02-coordinates.md", () => {
  const names = [...doc("02-coordinates.md").matchAll(/^### \d+\.\s*(.+)$/gm)].map((match) => (match[1] as string).trim());
  assert.equal(names.length, 16, `координат в документе ${names.length}`);
  const markup = html().toLowerCase();
  for (const name of names) assert.equal(markup.includes(name.toLowerCase()), false, `имя координаты «${name}» в разметке`);
});

test("в разметке карты нет названий методик", () => {
  const methods = ["mbti", "big five", "human design", "эннеаграм", "астролог", "disc", "соционик", "гороскоп"];
  const markup = html().toLowerCase();
  for (const method of methods) assert.equal(markup.includes(method), false, `методика «${method}» в разметке`);
});

test("позиция маркера сведена к именованной зоне и обратно не разворачивается", () => {
  assert.equal(zoneOf(0.5), "center");
  assert.equal(zoneOf(0), ZONES[0]);
  assert.equal(zoneOf(1), ZONES[ZONES.length - 1]);
  assert.equal(new Set(ZONES.map((zone) => zone)).size, 7);
  for (const zone of ZONES) assert.equal(/\d|%/.test(zone), false, `в имени зоны число: ${zone}`);

  // Разные значения попадают в одну зону: точное значение координаты не восстановить.
  assert.equal(zoneOf(0.44), zoneOf(0.56));
});

test("текстовая альтернатива описывает полосу словами, без чисел", () => {
  for (const bar of mock.mapBars) {
    const description = barDescription(bar, { bars: mock.mapBars, label: mock.mapLabel, zoneLabel: mock.zoneLabel, fillLabels: mock.fillLabels });
    assert.ok(description !== null, `${bar.id} без описания`);
    assert.equal(/\d|%/.test(description), false, `в описании число: ${description}`);
  }
});

// ── Три состояния без цвета ───────────────────────────────────────────────────

const COLOR_PROPERTIES = /color|background|shadow|fill|stroke/;

const shapeOf = (selector: string): Record<string, string> => {
  const shape: Record<string, string> = {};
  for (const declaration of allDeclarations(lookup, selector)) {
    if (COLOR_PROPERTIES.test(declaration.property)) continue;
    shape[declaration.property] = declaration.value;
  }
  return shape;
};

test("три состояния полосы различаются формой, а не цветом", () => {
  const states = ["empty", "approximate", "precise"];
  const tracks = states.map((state) => shapeOf(`.bar[data-fill="${state}"] .bar__track`));

  for (let first = 0; first < states.length; first += 1) {
    for (let second = first + 1; second < states.length; second += 1) {
      assert.notDeepEqual(
        tracks[first],
        tracks[second],
        `дорожка в состояниях ${states[first]} и ${states[second]} не отличается без цвета`,
      );
    }
  }
});

test("маркер предположительной полосы размыт и мельче, маркер точной — чёткая засечка", () => {
  const approximate = shapeOf('.bar[data-fill="approximate"] .bar__marker');
  const precise = shapeOf('.bar[data-fill="precise"] .bar__marker');

  assert.ok(approximate["filter"]?.startsWith("blur"), "предположительный маркер обязан быть размытым");
  assert.equal(precise["filter"], "none", "точный маркер обязан быть чётким");
  assert.ok(Number(approximate["opacity"]) < Number(precise["opacity"]), "точный маркер плотнее");
  assert.notEqual(approximate["border-radius"], precise["border-radius"], "формы маркеров обязаны различаться");
  assert.notEqual(approximate["width"], precise["width"]);
});

test("у пустой полосы маркера нет вовсе, а не подкрашенный", () => {
  const empty = mock.mapBars.filter((bar) => bar.fill === "empty");
  assert.ok(empty.length > 0);
  assert.equal(html(empty).includes("bar__marker"), false);
});

test("пустая полоса кликабельна и объясняет, чем откроется", () => {
  const empty = mock.mapBars.filter((bar) => bar.fill === "empty");
  const markup = html(empty);
  assert.ok(markup.includes("<summary"), "пустая полоса обязана быть кликабельной");
  for (const bar of empty) assert.ok(visibleText(map(empty)).includes(bar.hint), `нет объяснения для ${bar.id}`);
});

// ── Категориальная полоса ─────────────────────────────────────────────────────

test("категориальная полоса показывает семь вариантов и подсвечивает один", () => {
  const trigger = mock.mapBars.find((bar) => bar.category !== null);
  assert.ok(trigger !== undefined && trigger.category !== null);
  assert.equal(trigger.category.options.length, 7);

  const markup = html([trigger]);
  assert.equal([...markup.matchAll(/class="bar__dot"/g)].length + [...markup.matchAll(/data-selected/g)].length, 7 + 7);
  assert.equal([...markup.matchAll(/data-selected="true"/g)].length, 1);
});

// ── Анимация ──────────────────────────────────────────────────────────────────

test("маркер едет один раз за 400–600 мс", () => {
  const duration = declared(lookup, '.bar[data-animate="on"] .bar__marker', "animation-duration");
  assert.ok(duration !== null, "длительность приезда маркера не объявлена");
  const ms = Number.parseFloat(duration);
  assert.ok(ms >= MARKER_DURATION_RANGE.min && ms <= MARKER_DURATION_RANGE.max, `${ms} мс вне 400–600`);

  const iterations = declared(lookup, '.bar[data-animate="on"] .bar__marker', "animation-iteration-count");
  assert.equal(iterations, "1", "маркер обязан ехать ровно один раз");
});

test("маркер приезжает из центра", () => {
  const css = readFileSync(join(repoRoot, "web", "components", "map.css"), "utf8");
  assert.ok(/@keyframes\s+marker-arrive[\s\S]*?from\s*\{\s*left:\s*50%/.test(css), "маркер обязан стартовать из центра");
});

test("уже показанная полоса при повторной отрисовке не анимируется", () => {
  const first = html();
  assert.ok(first.includes('data-animate="on"'));

  const again = renderToString(map(mock.mapBars, new Set(mock.mapBars.map((bar) => bar.id))));
  assert.equal(again.includes('data-animate="on"'), false, "повторный показ запускает анимацию заново");
  assert.ok(again.includes('data-animate="off"'));
});

test("при снижении движения анимация выключена", () => {
  const css = readFileSync(join(repoRoot, "web", "components", "map.css"), "utf8");
  assert.ok(/prefers-reduced-motion:\s*reduce[\s\S]*?animation-name:\s*none/.test(css));
});

// ── Карта помещается в экран ──────────────────────────────────────────────────

const line = (selector: string): number => {
  const size = declaredPx(lookup, selector, "font-size");
  const leading = declared(lookup, selector, "line-height");
  assert.ok(size !== null && leading !== null, `${selector}: нет размера или межстрочного`);
  return size * Number(leading);
};

test("карта помещается в 360×640 без скролла", () => {
  const padding = declaredPx(lookup, ".map__bars", "padding") ?? 0;
  const mapGap = declaredPx(lookup, ".map__bars", "gap") ?? 0;
  const barGap = declaredPx(lookup, ".bar", "gap") ?? 0;
  const rowGap = declaredPx(lookup, ".bar__row", "gap") ?? 0;
  const rowMin = declaredPx(lookup, ".bar__row", "min-height") ?? 0;
  const track = declaredPx(lookup, ".bar__track", "height") ?? 0;
  const dot = declaredPx(lookup, ".bar__dot", "height") ?? 0;
  const border = tokenPixels("border-hair");

  const label = line(".bar__label");
  const poles = line(".bar__poles");
  const selected = line(".bar__selected");

  const axisRow = Math.max(rowMin, label + rowGap + track);
  const axisBar = axisRow + barGap + poles;
  const categoryBar = Math.max(rowMin, label) + barGap + dot + barGap + selected;

  const axisCount = mock.mapBars.filter((bar) => bar.category === null).length;
  const categoryCount = mock.mapBars.length - axisCount;

  const height =
    2 * padding + 2 * border + axisCount * axisBar + categoryCount * categoryBar + (mock.mapBars.length - 1) * mapGap;

  assert.ok(height <= BASE_VIEWPORT_HEIGHT_PX, `карта ${height.toFixed(0)} px выше экрана ${BASE_VIEWPORT_HEIGHT_PX} px`);
});

test("карта не шире базового экрана: горизонтального скролла нет", () => {
  const padding = declaredPx(lookup, ".map__bars", "padding") ?? 0;
  assert.ok(2 * padding < 360, "поля карты съедают экран");
  assert.equal(declared(lookup, ".map__bars", "width"), null, "ширина карты обязана идти от контейнера");
});
