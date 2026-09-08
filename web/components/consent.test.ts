/**
 * Отметка согласия: не предзажата, без модального окна, ссылки на постоянные адреса.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, visibleText } from "../src/dom.js";
import { byClass, boxOf, componentLookup, focusable } from "../src/test-support.js";
import { renderConsent } from "./consent.js";

const node = () =>
  renderConsent({
    title: "T",
    body: "B",
    mark: [{ text: "M " }, { text: "policy", href: "/legal/privacy" }],
    refuse: [{ text: "R " }, { text: "home", href: "/" }],
    checked: false,
  });

test("чекбокс не стоит заранее", () => {
  const input = findAll(node(), "input").find((item) => item.attrs["type"] === "checkbox");
  assert.ok(input);
  assert.equal(input.attrs["checked"], false);
  assert.equal(input.attrs["required"], true);
  assert.equal(findAll(node(), "dialog").length, 0);
});

test("ссылки ведут на постоянные адреса, не на подстановку домена", () => {
  const hrefs = findAll(node(), "a").map((item) => String(item.attrs["href"]));
  assert.deepEqual(hrefs, ["/legal/privacy", "/"]);
  assert.equal(visibleText(node()).includes("{{"), false);
});

test("цель отметки не меньше 44 px", () => {
  const lookup = componentLookup();
  const box = boxOf(lookup, "consent__mark");
  assert.ok((box.height ?? 0) >= 44, `consent__mark: ${box.height}`);
  const input = boxOf(lookup, "consent__input");
  assert.ok((input.height ?? 0) >= 44, `consent__input: ${input.height}`);
  assert.ok(byClass(node(), "consent").length === 1);
  assert.ok(focusable(node()).some((item) => item.attrs["type"] === "checkbox"));
});
