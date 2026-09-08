/**
 * Ступень 0: имя обязательно, дату можно пропустить, о характере — ни слова.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, renderToString, visibleText } from "../src/dom.js";
import { introTexts } from "../src/page-copy.js";
import { byClass, focusable } from "../src/test-support.js";
import { introPayload, renderIntro } from "./intro.js";

const labels = () => ({
  title: introTexts.title(),
  about: introTexts.about(),
  nameLabel: introTexts.nameLabel(),
  namePlaceholder: introTexts.namePlaceholder(),
  nameRequired: introTexts.nameRequired(),
  dateLabel: introTexts.dateLabel(),
  dateHint: introTexts.dateHint(),
  submit: introTexts.submit(),
});

const card = () => renderIntro({ labels: labels() });

test("дата не обязательна, имя — да", () => {
  assert.deepEqual(introPayload("  Кирилл  ", ""), { ok: true, name: "Кирилл", birthDate: null });
  assert.deepEqual(introPayload("Кирилл", "1990-05-05"), { ok: true, name: "Кирилл", birthDate: "1990-05-05" });
  assert.deepEqual(introPayload("   ", "1990-05-05"), { ok: false });
});

test("на карточке видно, что дату можно пропустить", () => {
  const text = visibleText(card());
  assert.ok(text.includes(introTexts.dateHint()));
  assert.ok(text.includes(introTexts.dateLabel()));
  const date = findAll(card(), "input").find((item) => item.attrs["name"] === "birth");
  const name = findAll(card(), "input").find((item) => item.attrs["name"] === "name");
  assert.equal(date?.attrs["required"], undefined);
  assert.equal(name?.attrs["required"], true);
});

test("в карточке нет утверждения о характере — только отказ это делать", () => {
  const text = visibleText(card());
  assert.ok(text.includes(introTexts.about()));
  assert.ok(text.includes("не делается ни одного вывода о характере"));
  assert.equal(/интроверт|экстраверт|овен|гороскоп|диагноз/i.test(text), false);
});

test("клавиатурный путь: имя, дата, отправка", () => {
  const path = focusable(card());
  assert.deepEqual(
    path.map((node) => node.attrs["name"] ?? node.attrs["type"]),
    ["name", "birth", "submit"],
  );
  assert.ok(byClass(card(), "intro__submit").length === 1);
  assert.equal(renderToString(card()).includes("404"), false);
});
