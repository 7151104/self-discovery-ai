/**
 * Сборка страницы из состояния сервера: не список компонентов, а экран.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, renderToString, visibleText } from "../src/dom.js";
import { waitFromPage } from "../components/wait.js";
import { viewLabels } from "./labels.js";
import { renderPersonalPage } from "./page.js";
import { pageStates } from "./page-states.js";

const markup = (key: keyof typeof pageStates): string => {
  const page = pageStates[key];
  return renderToString(renderPersonalPage(page, viewLabels(page)));
};

test("s0: шапка, порция, место крючка, пустая карта, маршрут — без блоков", () => {
  const page = pageStates.s0;
  const node = renderPersonalPage(page, viewLabels(page));
  assert.equal(node.attrs["data-page"], "s0");
  const hooks = findAll(node, "p").filter((item) => item.attrs["class"] === "hook");
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0]?.attrs["data-empty"], "true");
  assert.equal(findAll(node, "article").length, 0);
  assert.ok(findAll(node, "section").some((item) => item.attrs["class"] === "portion"));
  assert.ok(page.map.every((bar) => bar.fill === "empty"));
  assert.equal(waitFromPage(page, { now: Date.parse(page.updatedAt) }), null);
});

test("s1 и s2 наращивают блоки и полосы, порция остаётся внизу", () => {
  const s1 = renderPersonalPage(pageStates.s1, viewLabels(pageStates.s1));
  const s2 = renderPersonalPage(pageStates.s2, viewLabels(pageStates.s2));
  assert.equal(findAll(s1, "article").length, 1);
  assert.equal(findAll(s2, "article").length, 2);
  assert.equal(pageStates.s1.map.filter((bar) => bar.fill !== "empty").length, 3);
  assert.equal(pageStates.s2.map.filter((bar) => bar.fill !== "empty").length, 5);
  assert.ok(visibleText(s1).includes(pageStates.s1.hook as string));
});

test("s4: сюжет и одно предложение, порции уже нет", () => {
  const node = renderPersonalPage(pageStates.s4, viewLabels(pageStates.s4));
  assert.equal(findAll(node, "article").length, 4);
  assert.equal(findAll(node, "section").filter((item) => item.attrs["class"] === "offer").length, 1);
  assert.equal(findAll(node, "section").filter((item) => item.attrs["class"] === "portion").length, 0);
  assert.equal([...renderToString(node).matchAll(/590/g)].length, 2, "цена на кнопке предложения и у предложенной двери");
});

test("paid_pending: после оплаты вопросы, а не отчёт", () => {
  const node = renderPersonalPage(pageStates.paidPending, viewLabels(pageStates.paidPending));
  assert.ok(findAll(node, "section").some((item) => item.attrs["class"] === "portion"));
  assert.equal(findAll(node, "section").filter((item) => item.attrs["class"] === "offer").length, 0);
  assert.equal(findAll(node, "article").filter((item) => String(item.attrs["data-block"] ?? "").startsWith("slice:")).length, 0);
});

test("paid_done: блок среза на месте, следующее предложение одно", () => {
  const node = renderPersonalPage(pageStates.paidDone, viewLabels(pageStates.paidDone));
  assert.ok(findAll(node, "article").some((item) => String(item.attrs["data-block"]).startsWith("slice:")));
  assert.equal(findAll(node, "section").filter((item) => item.attrs["class"] === "offer").length, 1);
  assert.equal(markup("paidDone").includes("590"), false, "цена закрытого среза не должна остаться на экране");
  assert.ok(markup("paidDone").includes("1290"));
});

test("на ступенях 1–3 ожидания нет, на сборке сюжета — есть", () => {
  for (const key of ["s0", "s1", "s2", "s3"] as const) {
    const html = markup(key);
    assert.equal(html.includes('class="wait"'), false, `${key}: ожидание на lookup-ступени`);
  }
  const waiting = markup("s4Waiting");
  assert.ok(waiting.includes('class="wait"'));
  assert.ok(waiting.includes('data-wait="step4"'));
});
