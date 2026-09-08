/**
 * Дисклеймер продукта: текст параметром, незаполненная подстановка видна.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToString, visibleText } from "../src/dom.js";
import { byClass } from "../src/test-support.js";
import { renderDisclaimerList } from "./disclaimer.js";

test("пустой список не рисуется", () => {
  assert.equal(renderDisclaimerList({ items: [], unfilledLabel: "u" }), null);
});

test("незаполненный реквизит остаётся подстановкой", () => {
  const node = renderDisclaimerList({
    items: [{ id: "d", text: "Help: {{CONTACTS}}" }],
    unfilledLabel: "empty",
  });
  assert.ok(node);
  const html = renderToString(node);
  assert.ok(html.includes("data-unfilled=\"CONTACTS\""));
  assert.ok(html.includes("{{CONTACTS}}"));
  assert.ok(html.includes("title=\"empty\""));
  assert.equal(visibleText(node).includes("Help:"), true);
  assert.equal(byClass(node, "disclaimer").length, 1);
});
