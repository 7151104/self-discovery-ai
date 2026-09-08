/**
 * Блок разбора (E6-06).
 *
 * Приёмка: сшивка визуально сильнее абзацев и различима в градациях серого;
 * блок читается при 200% масштабе текста.
 *
 * «Сильнее» здесь не мнение, а три измеримых различия, ни одно из которых
 * не цвет: размер, начертание и линейка слева.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { blockFromDto, blockState, renderBlock } from "./block.js";
import { contrastRatio } from "../src/color.js";
import { declared, declaredPx } from "../src/css.js";
import { componentLookup, tokenPixels } from "../src/test-support.js";
import { findAll, visibleText } from "../src/dom.js";
import { TOKENS } from "../tokens/tokens.js";
import * as mock from "../showcase/mocks.js";

const lookup = componentLookup();
const full = () => renderBlock(blockFromDto(mock.block, { actions: mock.blockActions }));

test("блок собран по анатомии: заголовок, абзацы, сшивка, два действия", () => {
  const node = full();
  assert.equal(findAll(node, "h2").length, 1);
  assert.equal(findAll(node, "p").filter((item) => item.attrs["class"] === "block__paragraph").length, mock.block.paragraphs.length);
  assert.equal(findAll(node, "p").filter((item) => item.attrs["class"] === "block__highlight").length, 1);
  assert.equal(findAll(node, "button").length, 2);
});

test("действия названы машинными ключами, а текст приходит параметром", () => {
  const actions = findAll(full(), "button");
  assert.deepEqual(actions.map((item) => item.attrs["data-action"]), ["disagree", "share"]);
  assert.ok(visibleText(full()).includes("Не согласен с этим"));
});

test("сшивка крупнее и плотнее абзаца", () => {
  const paragraphSize = declaredPx(lookup, ".block__paragraph", "font-size");
  const highlightSize = declaredPx(lookup, ".block__highlight", "font-size");
  assert.ok(paragraphSize !== null && highlightSize !== null);
  assert.ok(highlightSize > paragraphSize, `${highlightSize} против ${paragraphSize}`);

  const paragraphWeight = Number(declared(lookup, ".block__paragraph", "font-weight"));
  const highlightWeight = Number(declared(lookup, ".block__highlight", "font-weight"));
  assert.ok(highlightWeight > paragraphWeight, `${highlightWeight} против ${paragraphWeight}`);
});

test("сшивка различима в градациях серого: тяжёлая линейка и другая светлота подложки", () => {
  const border = declared(lookup, ".block__highlight", "border-left");
  assert.ok(border !== null, "у сшивки нет линейки слева");
  const width = Number.parseFloat(border);
  assert.ok(width >= tokenPixels("border-heavy"), `линейка ${width} px слабее самой тяжёлой в шкале`);

  const card = TOKENS["color-surface-card"];
  const muted = TOKENS["color-surface-muted"];
  assert.ok(card !== undefined && muted !== undefined);
  const ratio = contrastRatio(card, muted);
  assert.ok(ratio > 1.02, `подложка сшивки не отличается по светлоте: ${ratio.toFixed(3)}:1`);
});

test("сила сшивки не держится на цвете: абзац и сшивка используют один цвет текста семейства", () => {
  const paragraph = declared(lookup, ".block__paragraph", "color");
  const highlight = declared(lookup, ".block__highlight", "color");
  assert.ok(paragraph !== null && highlight !== null);
  const withoutColor = contrastRatio(paragraph, highlight);
  assert.ok(withoutColor < 1.5, "разница между абзацем и сшивкой не должна сводиться к цвету текста");
});

test("длина строки ограничена в знаках, а не в пикселях", () => {
  for (const selector of [".block__paragraph", ".block__highlight", ".block__heading"]) {
    const measure = declared(lookup, selector, "max-width");
    assert.ok(measure !== null && measure.endsWith("ch"), `${selector}: ${measure}`);
  }
});

test("действия мельче основного текста: они мелкие по спецификации", () => {
  const action = declaredPx(lookup, ".block__action", "font-size");
  const paragraph = declaredPx(lookup, ".block__paragraph", "font-size");
  assert.ok(action !== null && paragraph !== null && action < paragraph);
});

test("состояния блока: покой, куплено, обновилось, несогласие, ожидание", () => {
  assert.equal(blockState({ id: "step1", heading: "з", paragraphs: [] }), "rest");
  assert.equal(blockState({ id: "step1", heading: "з", paragraphs: [], purchased: true }), "purchased");
  assert.equal(blockState({ id: "step1", heading: "з", paragraphs: [], stale: true }), "stale");
  assert.equal(blockState({ id: "step1", heading: "з", paragraphs: [], disagreed: true }), "disagreed");
  assert.equal(blockState({ id: "step1", heading: "з", paragraphs: [], pending: true }), "pending");
});

test("пометка «обновилось» появляется только у изменённого блока и приходит текстом снаружи", () => {
  const fresh = renderBlock(blockFromDto(mock.block, { actions: mock.blockActions, note: mock.staleNote }));
  assert.equal(visibleText(fresh).includes(mock.staleNote), false);

  const stale = renderBlock(blockFromDto({ ...mock.block, stale: true }, { actions: mock.blockActions, note: mock.staleNote }));
  assert.ok(visibleText(stale).includes(mock.staleNote));
});

test("блок без сшивки собирается: пары могли не сработать", () => {
  const node = renderBlock(blockFromDto({ ...mock.block, highlight: null }, { actions: mock.blockActions }));
  assert.equal(findAll(node, "p").filter((item) => item.attrs["class"] === "block__highlight").length, 0);
});
