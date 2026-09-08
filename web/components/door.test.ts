/**
 * Двери, маршрут и точка оплаты (E6-08).
 *
 * Приёмка: на экране первого шага оплаты одна цена; закрытые платные двери
 * без цен; хотя бы одна дверь помечена как открывающаяся ответами.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { doorVisual, renderDoor, renderRoute, routeViolations, type RouteContext } from "./door.js";
import { renderOffer, renderPaymentStep } from "./offer.js";
import { allDeclarations, declared } from "../src/css.js";
import { componentLookup } from "../src/test-support.js";
import { findAll, renderToString, visibleText } from "../src/dom.js";
import * as mock from "../showcase/mocks.js";

const lookup = componentLookup();

const route = (context: RouteContext, doors = mock.doors) =>
  renderRoute({
    doors,
    context,
    formatPrice: mock.formatPrice,
    notes: mock.doorNotes,
    label: mock.routeLabel,
  });

const payment = () =>
  renderPaymentStep({ offer: mock.offer, labels: mock.offerLabels });

const priceOccurrences = (markup: string): number =>
  [...markup.matchAll(new RegExp(String(mock.offer.price), "g"))].length;

// ── Пять состояний двери ──────────────────────────────────────────────────────

test("пять состояний двери выводятся из контракта и состояния страницы", () => {
  const paid = { id: "d", title: "т", state: "paid" as const, price: null, slice: "slice_node_finish" };
  assert.equal(doorVisual(paid, { offerSlice: null, profiled: false }), "locked_generic");
  assert.equal(doorVisual(paid, { offerSlice: null, profiled: true }), "locked_profiled");
  assert.equal(doorVisual(paid, { offerSlice: "slice_node_finish", profiled: true }), "offered");
  assert.equal(
    doorVisual({ ...paid, state: "opens_with_answers" }, { offerSlice: null, profiled: false }),
    "opens_with_answers",
  );
  assert.equal(doorVisual({ ...paid, state: "open" }, { offerSlice: null, profiled: true }), "open");
});

test("каждое состояние двери отличается формой значка или рамкой, а не только цветом", () => {
  const states = ["locked_generic", "locked_profiled", "opens_with_answers", "open", "offered"];
  const shapes = states.map((state) => {
    const face = allDeclarations(lookup, `.door[data-state="${state}"] .door__face`);
    const mark = allDeclarations(lookup, `.door[data-state="${state}"] .door__mark`);
    return [...face, ...mark]
      .filter((item) => /style|width|weight|shadow|size/.test(item.property))
      .map((item) => `${item.property}:${item.value}`)
      .sort()
      .join(";");
  });

  const distinct = new Set(shapes.filter((shape) => shape.length > 0));
  assert.ok(distinct.size >= 3, `состояний, различимых без цвета, всего ${distinct.size}`);
});

// ── Цена ──────────────────────────────────────────────────────────────────────

test("цена показывается только у предложенной двери", () => {
  const offered = renderDoor({
    door: mock.doors[2] as (typeof mock.doors)[number],
    visual: "offered",
    priceText: mock.formatPrice(mock.offer.price),
  });
  assert.ok(visibleText(offered).includes(mock.formatPrice(mock.offer.price)));

  for (const visual of ["locked_generic", "locked_profiled", "opens_with_answers", "open"] as const) {
    const closed = renderDoor({
      door: mock.doors[2] as (typeof mock.doors)[number],
      visual,
      priceText: mock.formatPrice(mock.offer.price),
    });
    assert.equal(/\d/.test(visibleText(closed)), false, `цена просочилась в состояние ${visual}`);
  }
});

test("в маршруте до предложения цен нет вовсе", () => {
  const markup = renderToString(route({ offerSlice: null, profiled: false }));
  assert.equal(priceOccurrences(markup), 0);
});

test("в маршруте с предложением цена ровно одна", () => {
  const markup = renderToString(route({ offerSlice: mock.offer.slice, profiled: true }, mock.doorsWithOffer));
  assert.equal(priceOccurrences(markup), 1);
});

test("на экране первого шага оплаты одна цена и две кнопки", () => {
  const markup = renderToString(payment());
  assert.equal(priceOccurrences(markup), 1, "цена на экране оплаты обязана быть одна");
  assert.equal(findAll(payment(), "button").length, 2, "покупка и отказ — и ничего больше");
});

test("на экране оплаты нет второго продукта, таймера и зачёркнутой цены", () => {
  const node = payment();
  assert.equal(node.attrs["class"], "payment");
  assert.equal(findAll(node, "ul").length, 0, "маршрут на экране оплаты не показывается");
  const markup = renderToString(node);
  for (const forbidden of ["<s>", "<del>", "text-decoration"]) {
    assert.equal(markup.includes(forbidden), false, `на экране оплаты ${forbidden}`);
  }
});

// ── Правила маршрута ──────────────────────────────────────────────────────────

test("хотя бы одна дверь открывается ответами", () => {
  const visuals = mock.doors.map((door) => doorVisual(door, { offerSlice: null, profiled: false }));
  assert.ok(visuals.includes("opens_with_answers"), "маршрут без бесплатной двери читается как витрина");
  assert.deepEqual(routeViolations(mock.doors, { offerSlice: null, profiled: false }), []);
});

test("маршрут без двери, открывающейся ответами, не отрисовывается", () => {
  const doors = mock.doors.filter((door) => door.state !== "opens_with_answers");
  assert.deepEqual(routeViolations(doors, { offerSlice: null, profiled: false }), ["no-door-opens-with-answers"]);
  assert.throws(() =>
    renderRoute({ doors, context: { offerSlice: null, profiled: false }, formatPrice: mock.formatPrice, label: mock.routeLabel }),
  );
});

test("две цены на экране — исключение, а не тихая витрина", () => {
  const doors = [
    ...mock.doorsWithOffer,
    { id: "door-second", title: "вторая", state: "paid" as const, price: 1290, slice: "slice_relations" },
  ];
  const violations = routeViolations(doors, { offerSlice: "slice_node_finish", profiled: true });
  assert.ok(violations.includes("price-without-offer"));
  assert.throws(() =>
    renderRoute({ doors, context: { offerSlice: "slice_node_finish", profiled: true }, formatPrice: mock.formatPrice, label: mock.routeLabel }),
  );
});

test("подписи дверей приходят с сервера и меняются вместе с состоянием страницы", () => {
  const generic = visibleText(route({ offerSlice: null, profiled: false }));
  for (const door of mock.doors) assert.ok(generic.includes(door.title), `подписи ${door.id} нет в маршруте`);
});

// ── Предложение ───────────────────────────────────────────────────────────────

test("предложение показывает состав, а не список выгод, и оставляет выход", () => {
  const text = visibleText(renderOffer({ offer: mock.offer, labels: mock.offerLabels }));
  assert.ok(text.includes(mock.offerLabels.contents));
  assert.ok(text.includes(mock.offerLabels.decline));
});

test("кнопка покупки — единственное место, где напечатана цена", () => {
  const node = renderOffer({ offer: mock.offer, labels: mock.offerLabels });
  assert.equal(priceOccurrences(renderToString(node)), 1);

  // Цена напечатана внутри кнопки, а не рядом с ней: формат приходит готовой
  // строкой из реестра микрокопии, компонент цену не собирает.
  const buttons = findAll(node, "button").filter((item) => item.attrs["class"] === "offer__buy");
  assert.equal(buttons.length, 1);
  assert.equal(priceOccurrences(renderToString(buttons[0] ?? null)), 1);
});

test("предложение приподнято тенью из шкалы, а не выкрашено в праздничный цвет", () => {
  const shadow = declared(lookup, ".offer", "box-shadow");
  assert.ok(shadow !== null && shadow !== "none");
});
