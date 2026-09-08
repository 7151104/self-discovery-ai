/**
 * Витрина: показаны ли компоненты во всех состояниях, и сверка с docs/11.
 *
 * Без этого «витрина есть» означает только «файл есть». Список состояний
 * сверяется с таблицами `docs/11-ui-page-spec.md`: забытое состояние роняет
 * тест. Тот же приём, что у полос карты и подтипов срезов.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderShowcase, SECTIONS } from "./showcase.js";
import { renderToString } from "../src/dom.js";
import { EDGE_CASES } from "./edge-states.js";
import { PAGE_STATE_CASES } from "./page-states.js";
import { specEdgeSituations, specPageStates, uiSpec } from "./spec.js";

const markup = (only?: string): string => renderToString(renderShowcase(only));

const sectionIds = (): string[] => SECTIONS.map((build) => String(build().attrs["data-section"]));

test("разделы витрины на месте", () => {
  const page = markup();
  for (const id of ["tokens", "typography", "input", "block", "map", "door", "payment", "portion", "wait"]) {
    assert.ok(page.includes(`data-section="${id}"`), `нет раздела ${id}`);
  }
});

test("каждый раздел открывается по своему адресу: снимок на раздел для E11-04", () => {
  const ids = sectionIds();
  assert.equal(new Set(ids).size, ids.length, `id разделов повторяются: ${ids.join(", ")}`);
  for (const id of ids) {
    const one = markup(id);
    assert.ok(one.includes(`data-section="${id}"`), `?section=${id} не собрал свой раздел`);
    for (const other of ids) {
      if (other === id) continue;
      assert.equal(one.includes(`data-section="${other}"`), false, `?section=${id} принёс ещё ${other}`);
    }
  }
});

test("состояния страницы витрины совпадают с таблицей docs/11-ui-page-spec.md", () => {
  const spec = specPageStates(uiSpec());
  const shown = PAGE_STATE_CASES.filter((item) => item.spec).map((item) => item.id);
  assert.deepEqual(shown, spec, "в витрине не те состояния, что в документе");
  for (const id of spec) {
    const page = markup(id);
    assert.ok(page.includes(`data-section="${id}"`), `нет раздела ${id}`);
    assert.ok(page.includes(`data-page="${id}"`), `раздел ${id} собран не страницей`);
    assert.equal(page.includes('class="page"'), true);
  }
});

test("краевые состояния витрины совпадают с таблицей docs/11-ui-page-spec.md", () => {
  const spec = specEdgeSituations(uiSpec());
  assert.equal(spec.length, 9, `в docs/11 краевых состояний ${spec.length}`);
  assert.deepEqual(
    EDGE_CASES.map((item) => item.situation),
    spec,
    "формулировки краевых состояний разошлись с документом",
  );
  for (const item of EDGE_CASES) {
    const page = markup(`edge-${item.id}`);
    assert.ok(page.includes(`data-section="edge-${item.id}"`), `нет раздела edge-${item.id}`);
    assert.ok(page.includes(item.situation), `ситуация «${item.situation}» не видна в витрине`);
    assert.ok(page.includes('class="page"'), `краевое «${item.situation}» собрано не страницей`);
  }
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

const priceCount = (html: string): number => [...html.matchAll(/590/g)].length;

test("цена 590 только у предложения и предложенной двери", () => {
  assert.equal(priceCount(markup("payment")), 2);
  assert.equal(priceCount(markup("door")), 2);
  assert.equal(priceCount(markup("s4")), 2, "кнопка предложения и предложенная дверь");
  assert.equal(priceCount(markup("s0")), 0);
  assert.equal(priceCount(markup("s1")), 0);
  assert.equal(priceCount(markup("s2")), 0);
  assert.equal(priceCount(markup("s3")), 0);
  assert.equal(priceCount(markup("paid_pending")), 0);
  assert.equal(priceCount(markup("paid_done")), 0);
  assert.equal(priceCount(markup("portion")), 0);
});

test("порция показана всеми четырьмя типами вопросов", () => {
  const page = markup("portion");
  for (const kind of ["choice", "scale", "open", "number"]) {
    assert.ok(page.includes(`data-kind="${kind}"`), `нет типа ${kind}`);
  }
  assert.ok(page.includes("portion__back"), "нет кнопки «назад» на втором вопросе");
  assert.equal(page.includes("из 12"), false, "общее число вопросов лестницы просочилось в порцию");
});

test("ожидание показано для ступени 4 и для среза, и на собранной странице", () => {
  const page = markup("wait");
  assert.ok(page.includes('data-wait="step4"'));
  assert.ok(page.includes('data-wait="slice"'));
  assert.ok(page.includes('data-page="s4"'));
  assert.ok(page.includes('data-page="paid_pending"'));
});
