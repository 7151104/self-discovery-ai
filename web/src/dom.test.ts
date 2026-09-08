/**
 * Слой разметки: одно дерево — две формы.
 *
 * Тест сторожит то, на что опираются остальные тесты: строка собирается
 * из того же дерева, что монтируется в браузер, и текст в неё попадает
 * экранированным.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { collectAttributes, escapeHtml, findAll, h, renderToString, visibleText } from "./dom.js";

test("узел собирается в строку с атрибутами и детьми", () => {
  const node = h("p", { class: "a", "data-state": "rest" }, "текст");
  assert.equal(renderToString(node), '<p class="a" data-state="rest">текст</p>');
});

test("пустые атрибуты не печатаются, логические печатаются без значения", () => {
  const node = h("input", { type: "radio", checked: true, disabled: false, value: null });
  assert.equal(renderToString(node), '<input type="radio" checked>');
});

test("одиночные теги не закрываются", () => {
  assert.equal(renderToString(h("input", {})), "<input>");
});

test("текст экранируется: чужая строка не станет разметкой", () => {
  assert.equal(escapeHtml('<b>&"'), "&lt;b&gt;&amp;&quot;");
  assert.equal(renderToString(h("p", {}, "<script>")), "<p>&lt;script&gt;</p>");
});

test("обработчики в строку не попадают", () => {
  const markup = renderToString(h("button", { onClick: () => undefined, class: "b" }, "x"));
  assert.equal(markup, '<button class="b">x</button>');
});

test("пустые дети выпадают, а не печатаются словом", () => {
  assert.equal(renderToString(h("p", {}, null, false, undefined, "текст")), "<p>текст</p>");
});

test("видимый текст собирается без атрибутов", () => {
  const node = h("p", { class: "нет-такого-класса" }, "раз", h("span", { title: "два" }, "три"));
  const text = visibleText(node);
  assert.ok(text.includes("раз") && text.includes("три"));
  assert.equal(text.includes("два"), false);
});

test("атрибуты и узлы находятся по дереву", () => {
  const node = h("div", {}, h("input", { name: "a" }), h("div", {}, h("input", { name: "b" })));
  assert.equal(findAll(node, "input").length, 2);
  assert.deepEqual(
    collectAttributes(node).map((item) => `${item.name}=${item.value}`),
    ["name=a", "name=b"],
  );
});
