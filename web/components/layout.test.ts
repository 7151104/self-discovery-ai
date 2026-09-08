/**
 * Сквозные требования вёрстки: цели нажатия, длина строки, вертикальный ритм,
 * масштаб текста 200%.
 *
 * Проверяется по объявленным стилям и по дереву разметки витрины — то есть по
 * тому же, что видит человек, а не по отдельному списку «правильных»
 * селекторов, который легко забыть пополнить.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { CHAR_WIDTH_RATIO, FONT_SIZES, MEASURE_RANGE, ROOT_FONT_SIZE_PX, BASE_VIEWPORT_PX, TOKENS } from "../tokens/tokens.js";
import { declared, declaredPx } from "../src/css.js";
import {
  boxOf,
  classesOf,
  componentCss,
  componentFiles,
  componentLookup,
  INTERACTIVE_TAGS,
  lineHeightPx,
  tokenPixels,
  walk,
} from "../src/test-support.js";
import { renderShowcase } from "../showcase/showcase.js";

const MIN_TARGET = 44;

test("все интерактивные цели не меньше 44×44 px", () => {
  const lookup = componentLookup();
  const failures: string[] = [];

  walk(renderShowcase(), ({ node, ancestors }) => {
    if (!INTERACTIVE_TAGS.has(node.tag)) return;
    const chain = [classesOf(node), ...ancestors];
    const boxes = chain.flatMap((classes) => classes.map((name) => boxOf(lookup, name)));

    const tallEnough = boxes.some((box) => box.height !== null && box.height >= MIN_TARGET);
    const wideEnough = boxes.some((box) => box.wide || (box.width !== null && box.width >= MIN_TARGET));
    const hidden = classesOf(node).some((name) => {
      const height = declaredPx(lookup, `.${name}`, "height");
      return height !== null && height <= tokenPixels("border-hair");
    });

    if (hidden) return;
    if (!tallEnough || !wideEnough) failures.push(`${node.tag}.${classesOf(node).join(".")}`);
  });

  assert.deepEqual(failures, [], "цели меньше 44 px");
});

test("скрытые радиокнопки остаются в разметке, а целью служит их подпись", () => {
  const lookup = componentLookup();
  for (const name of ["option__input", "scale__input"]) {
    const height = declaredPx(lookup, `.${name}`, "height");
    assert.ok(height !== null && height <= tokenPixels("border-hair"), `${name} обязан быть скрыт, а не удалён`);
  }
  for (const name of ["option", "scale__mark"]) {
    const box = boxOf(lookup, name);
    assert.ok((box.height ?? 0) >= MIN_TARGET, `${name}: ${box.height} px`);
  }
});

test("длина строки блока разбора на экране 360 px укладывается в 34–46 знаков", () => {
  const lookup = componentLookup();
  const pagePadding = declaredPx(lookup, ".page", "padding");
  const blockPadding = declaredPx(lookup, ".block", "padding");
  assert.ok(pagePadding !== null && blockPadding !== null);

  const border = tokenPixels("border-hair");
  const usable = BASE_VIEWPORT_PX - 2 * pagePadding - 2 * blockPadding - 2 * border;
  const fontSize = tokenPixels("text-md");

  for (const ratio of [CHAR_WIDTH_RATIO.min, CHAR_WIDTH_RATIO.max]) {
    const characters = usable / (fontSize * ratio);
    assert.ok(
      characters >= MEASURE_RANGE.min && characters <= MEASURE_RANGE.max,
      `при ширине знака ${ratio} em строка ${characters.toFixed(1)} знаков вне ${MEASURE_RANGE.min}–${MEASURE_RANGE.max}`,
    );
  }
});

test("на базовом экране длину строки задаёт ширина экрана, а не --measure-block", () => {
  const lookup = componentLookup();
  const pagePadding = declaredPx(lookup, ".page", "padding") ?? 0;
  const blockPadding = declaredPx(lookup, ".block", "padding") ?? 0;
  const usable = BASE_VIEWPORT_PX - 2 * pagePadding - 2 * blockPadding - 2 * tokenPixels("border-hair");

  const measure = TOKENS["measure-block"];
  assert.ok(measure !== undefined && measure.endsWith("ch"));
  // 1ch — ширина знака «0»; в системных гротесках это примерно 0.55 em.
  const measurePx = Number.parseFloat(measure) * 0.55 * tokenPixels("text-md");
  assert.ok(measurePx > usable, `--measure-block (${measurePx.toFixed(0)} px) уже экрана (${usable} px)`);
});

test("вертикальный ритм блока един во всех состояниях", () => {
  const lookup = componentLookup();
  const rhythmProperties = ["padding", "gap", "margin", "row-gap", "font-size", "line-height"];
  const states = ["rest", "purchased", "stale", "disagreed", "pending"];

  for (const state of states) {
    for (const property of rhythmProperties) {
      const value = declared(lookup, `.block[data-state="${state}"]`, property);
      assert.equal(value, null, `состояние ${state} меняет ${property}: ритм поедет`);
    }
  }
});

test("размеры текста заданы в rem: масштаб 200% не ломает вёрстку", () => {
  for (const token of FONT_SIZES) {
    const value = TOKENS[token.name];
    assert.ok(value !== undefined && value.endsWith("rem"), `${token.name}: ${value}`);
  }
  assert.equal(ROOT_FONT_SIZE_PX, 16);
});

test("текстовые блоки не заперты в фиксированную высоту", () => {
  const lookup = componentLookup();
  for (const selector of [".block", ".block__paragraph", ".block__highlight", ".map", ".offer"]) {
    assert.equal(declared(lookup, selector, "height"), null, `${selector}: фиксированная высота`);
    assert.equal(declared(lookup, selector, "max-height"), null, `${selector}: потолок высоты`);
    const overflow = declared(lookup, selector, "overflow");
    assert.notEqual(overflow, "hidden", `${selector}: текст обрежется при 200%`);
  }
});

test("высота строки считается из токенов, а не из подобранных пикселей", () => {
  assert.ok(lineHeightPx("text-md", "leading-normal") > tokenPixels("text-md"));
});

test("кольцо фокуса объявлено на всю страницу и нигде не выключено", () => {
  const base = componentCss("base.css");
  assert.ok(/:focus-visible\s*\{[^}]*outline:/.test(base), "нет общего кольца фокуса");

  for (const name of componentFiles()) {
    const css = componentCss(name);
    assert.equal(/outline:\s*none/.test(css), false, `${name} выключает кольцо фокуса`);
  }
});

test("компоненты со скрытой радиокнопкой рисуют фокус на подписи", () => {
  for (const [file, selector] of [["option.css", "option__input"], ["scale.css", "scale__input"]] as const) {
    const css = componentCss(file);
    const rule = new RegExp(`:has\\(\\.${selector}:focus-visible\\)\\s*\\{[^}]*outline:`);
    assert.ok(rule.test(css), `${file}: фокус скрытой радиокнопки негде показать`);
  }
});

test("у каждого нажимаемого элемента есть состояние наведения", () => {
  const css = componentFiles().map((name) => componentCss(name)).join("\n");
  for (const name of ["option", "scale__mark", "field__submit", "block__action", "door__face", "offer__buy", "offer__decline", "portion__back", "portion__number-input", "summary", "intro__submit", "intro__input", "missing__action"]) {
    const rule = new RegExp(`\\.?${name}[^{]*:hover`);
    assert.ok(rule.test(css), `${name}: нет состояния наведения`);
  }
});
