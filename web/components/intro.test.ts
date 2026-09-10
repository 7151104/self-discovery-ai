/**
 * Ступень 0: сначала идея страницы, поля — второй блок.
 * Имя обязательно, дату можно пропустить, о характере — ни слова.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, renderToString, visibleText } from "../src/dom.js";
import { introLabels, introTexts } from "../src/page-copy.js";
import { byClass, focusable } from "../src/test-support.js";
import { introPayload, renderIntro } from "./intro.js";

const card = () => renderIntro({ labels: introLabels() });

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
  assert.ok(text.includes(introTexts.legal()));
  assert.ok(text.includes("не делается ни одного вывода о характере"));
  assert.equal(/интроверт|экстраверт|овен|гороскоп|диагноз/i.test(text), false);
});

test("сначала идея страницы, поля — во втором блоке", () => {
  const node = card();
  const classes = node.children
    .filter((child) => typeof child === "object" && child !== null && "attrs" in child)
    .map((child) => String((child as { attrs: Record<string, unknown> }).attrs["class"] ?? ""));
  assert.deepEqual(classes, ["intro__hero", "intro__start"]);
  const text = visibleText(node);
  assert.ok(text.includes(introTexts.title()));
  assert.ok(text.includes(introTexts.lead()));
  assert.ok(text.includes(introTexts.about()));
  const logo = findAll(node, "img").find((item) => item.attrs["class"] === "intro__logo");
  assert.equal(logo?.attrs["src"], introTexts.wordmarkSrc());
  assert.equal(logo?.attrs["alt"], introTexts.wordmarkAlt());
  for (const beat of introTexts.beats()) assert.ok(text.includes(beat), `нет удара «${beat}»`);
  assert.ok(text.includes(introTexts.startTitle()));
  const titleAt = text.indexOf(introTexts.title());
  const startAt = text.indexOf(introTexts.startTitle());
  const nameAt = text.indexOf(introTexts.nameLabel());
  assert.ok(titleAt >= 0 && startAt > titleAt && nameAt > startAt, "поля не должны идти раньше идеи");
});

test("клавиатурный путь: имя, дата за строкой, отправка", () => {
  const path = focusable(card());
  assert.deepEqual(
    path.map((node) => node.attrs["name"] ?? node.tag),
    ["name", "summary", "birth", "submit"],
  );
  assert.ok(byClass(card(), "intro__optional").length === 1);
  assert.ok(byClass(card(), "intro__submit").length === 1);
  assert.equal(renderToString(card()).includes("404"), false);
});
