/**
 * Витрина: показаны ли компоненты во всех состояниях.
 *
 * Без этого «витрина есть» означает только «файл есть». Тест перечисляет
 * состояния, которые основатель должен увидеть глазами, и падает, когда
 * очередное состояние забыли добавить.
 *
 * Состояния страницы `s0`–`paid_done` целиком — задача E6-12.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderShowcase, SECTIONS } from "./showcase.js";
import { renderToString } from "../src/dom.js";

const markup = (only?: string): string => renderToString(renderShowcase(only));

test("разделы витрины на месте", () => {
  const page = markup();
  for (const id of ["tokens", "typography", "input", "block", "map", "door", "payment"]) {
    assert.ok(page.includes(`data-section="${id}"`), `нет раздела ${id}`);
  }
  assert.equal(SECTIONS.length, 7);
});

test("раздел открывается отдельно: снимок на раздел для E11-04", () => {
  const one = markup("map");
  assert.ok(one.includes('data-section="map"'));
  assert.equal(one.includes('data-section="door"'), false);
});

test("вариант ответа показан в покое, выбранным и отключённым", () => {
  const page = markup("input");
  for (const state of ["rest", "selected", "disabled"]) {
    assert.ok(page.includes(`class="option" for="`) && page.includes(`data-state="${state}"`), `нет состояния ${state}`);
  }
});

test("шкала показана в покое, с выбором и отключённой", () => {
  const page = markup("input");
  assert.ok(page.includes('class="scale" role="radiogroup" data-state="rest"'));
  assert.ok(page.includes('data-state="disabled"'));
  assert.ok(page.includes('class="scale__mark" for="scale-set-4" data-state="selected"'));
});

test("открытое поле показано до счётчика, со счётчиком, готовым и отключённым", () => {
  const page = markup("input");
  for (const state of ["short", "ready", "disabled"]) {
    assert.ok(page.includes(`class="field" data-state="${state}"`), `нет состояния поля ${state}`);
  }
});

test("блок показан во всех пяти состояниях", () => {
  const page = markup("block");
  for (const state of ["rest", "purchased", "stale", "disagreed"]) {
    assert.ok(page.includes(`data-state="${state}"`), `нет состояния блока ${state}`);
  }
  assert.ok(page.includes("block__highlight"), "блок со сшивкой обязателен");
});

test("карта показана с тремя состояниями полосы и в пустом состоянии s0", () => {
  const page = markup("map");
  for (const fill of ["empty", "approximate", "precise"]) {
    assert.ok(page.includes(`data-fill="${fill}"`), `нет состояния полосы ${fill}`);
  }
  assert.ok(page.includes('data-animate="off"'), "нет случая «маркер уже приезжал»");
});

test("двери показаны во всех пяти состояниях", () => {
  const page = markup("door");
  for (const state of ["locked_generic", "locked_profiled", "opens_with_answers", "open", "offered"]) {
    assert.ok(page.includes(`data-state="${state}"`), `нет состояния двери ${state}`);
  }
});

test("во всей витрине цена печатается только там, где предложение", () => {
  const page = markup();
  const prices = [...page.matchAll(/590/g)].length;
  assert.equal(prices, 4, "цена появляется в пяти состояниях двери, в двух маршрутах и на экране оплаты");
});
