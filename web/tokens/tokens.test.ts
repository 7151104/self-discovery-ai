/**
 * Шкалы токенов (E6-02, E6-03, E6-04).
 *
 * Тест сторожит не красоту, а границы, записанные в `docs/12-target-state.md`:
 * не более шести размеров текста и трёх начертаний, кратная шкала отступов
 * не длиннее семи ступеней, не более трёх смысловых цветов, ни одной анимации
 * длиннее 600 мс.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import {
  BORDERS,
  DURATIONS,
  FONT_SIZES,
  FONT_WEIGHTS,
  LEADINGS,
  MARKER_DURATION_RANGE,
  MEASURES,
  MEASURE_RANGE,
  NEUTRALS,
  RADII,
  SEMANTIC_COLORS,
  SEMANTIC_DERIVED,
  SIZES,
  SPACES,
  SPACE_BASE_PX,
  TOKENS,
  tokensCss,
} from "./tokens.js";
import { componentCss, componentFiles } from "../src/test-support.js";

const allCss = (): string => componentFiles().map((name) => componentCss(name)).join("\n");

test("размеров текста не больше шести, все разные и по возрастанию", () => {
  assert.ok(FONT_SIZES.length <= 6, `размеров ${FONT_SIZES.length}`);
  const sizes = FONT_SIZES.map((token) => token.rem);
  assert.deepEqual(sizes, [...sizes].sort((first, second) => first - second));
  assert.equal(new Set(sizes).size, sizes.length);
});

test("у каждого размера есть назначение и он используется в компонентах", () => {
  const css = allCss();
  for (const token of FONT_SIZES) {
    assert.ok(token.purpose.length > 0, `${token.name} без назначения`);
    assert.ok(css.includes(`var(--${token.name})`), `${token.name} объявлен, но не используется`);
  }
});

test("начертаний не больше трёх и все используются", () => {
  assert.ok(FONT_WEIGHTS.length <= 3, `начертаний ${FONT_WEIGHTS.length}`);
  const css = allCss();
  for (const token of FONT_WEIGHTS) assert.ok(css.includes(`var(--${token.name})`), `${token.name} не используется`);
});

test("межстрочных не больше трёх, длина строки блока в диапазоне приёмки", () => {
  assert.ok(LEADINGS.length <= 3);
  const block = MEASURES.find((token) => token.name === "measure-block");
  assert.ok(block !== undefined);
  assert.ok(block.ch >= MEASURE_RANGE.min && block.ch <= MEASURE_RANGE.max, `${block.ch} знаков вне 34–46`);
  const hook = MEASURES.find((token) => token.name === "measure-hook");
  assert.ok(hook !== undefined && hook.ch < block.ch, "крючок обязан быть короче абзаца разбора");
});

test("шкала отступов кратная, не длиннее семи ступеней и возрастает", () => {
  assert.ok(SPACES.length <= 7, `ступеней ${SPACES.length}`);
  const values = SPACES.map((token) => token.px);
  assert.deepEqual(values, [...values].sort((first, second) => first - second));
  for (const value of values) assert.equal(value % SPACE_BASE_PX, 0, `${value} не кратно ${SPACE_BASE_PX}`);
});

test("смысловых цветов не больше трёх", () => {
  assert.ok(SEMANTIC_COLORS.length <= 3, `смысловых цветов ${SEMANTIC_COLORS.length}`);
});

test("акцент не заходит в текст разбора, шапку и общую основу", () => {
  for (const name of ["base.css", "block.css", "page-head.css"]) {
    assert.ok(!componentCss(name).includes("var(--color-accent"), `акцент в ${name}: это не действие и не маркер карты`);
  }
});

test("маркер карты — единственное неинтерактивное место акцента", () => {
  const map = componentCss("map.css");
  const accentLines = map.split("\n").filter((line) => line.includes("var(--color-accent"));
  assert.ok(accentLines.length > 0, "маркер карты обязан быть акцентным");
});

test("ни одна длительность не длиннее 600 мс, маркер едет 400–600 мс", () => {
  for (const token of DURATIONS) assert.ok(token.ms <= 600, `${token.name}: ${token.ms} мс`);
  const marker = DURATIONS.find((token) => token.name === "duration-marker");
  assert.ok(marker !== undefined);
  assert.ok(marker.ms >= MARKER_DURATION_RANGE.min && marker.ms <= MARKER_DURATION_RANGE.max);
});

test("реестр токенов собирается в CSS и покрывает все шкалы", () => {
  const css = tokensCss();
  const groups = [...FONT_SIZES, ...FONT_WEIGHTS, ...LEADINGS, ...MEASURES, ...NEUTRALS, ...SEMANTIC_COLORS,
    ...SEMANTIC_DERIVED, ...SPACES, ...RADII, ...DURATIONS, ...BORDERS, ...SIZES];
  for (const token of groups) {
    assert.ok(TOKENS[token.name] !== undefined, `${token.name} не попал в реестр`);
    assert.ok(css.includes(`--${token.name}:`), `${token.name} не попал в tokens.css`);
  }
});

test("значения токенов уникальны по назначению: одно имя — одно значение", () => {
  const names = Object.keys(TOKENS);
  assert.equal(new Set(names).size, names.length);
});
