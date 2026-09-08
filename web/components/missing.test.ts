/**
 * Несуществующий профиль: понятная страница без технических подробностей.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToString, visibleText } from "../src/dom.js";
import { missingTexts } from "../src/page-copy.js";
import { focusable } from "../src/test-support.js";
import { renderMissing } from "./missing.js";

const TECHNICAL = ["404", "profile_not_found", "internal_error", "stack", "TypeError", "ECONN", "status"];

const page = () =>
  renderMissing({ title: missingTexts.title(), text: missingTexts.text(), action: missingTexts.action() });

test("человек видит, что ссылка не открывается, и может сделать свою", () => {
  const text = visibleText(page());
  assert.ok(text.includes(missingTexts.title()));
  assert.ok(text.includes(missingTexts.text()));
  assert.ok(text.includes(missingTexts.action()));
});

test("на странице нет технических подробностей отказа", () => {
  const text = visibleText(page());
  const markup = renderToString(page());
  for (const leak of TECHNICAL) {
    assert.equal(text.toLowerCase().includes(leak.toLowerCase()), false, `в тексте «${leak}»`);
  }
  assert.equal(markup.includes("profile_not_found"), false);
  assert.ok(markup.includes('data-error="missing"'));
});

test("клавиатурный путь — действие «сделать свою»", () => {
  const path = focusable(page());
  assert.equal(path.length, 1);
  assert.equal(path[0]?.tag, "button");
});
