/**
 * Сборка страницы: крючок, блоки, карта, маршрут — приёмка E7-04…E7-06.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, renderToString, visibleText } from "./dom.js";
import { byClass, tokenPixels } from "./test-support.js";
import { copy } from "./copy.js";
import { filledBars, renderPersonalPage } from "./page.js";
import { viewLabels } from "../showcase/labels.js";
import { pageStates } from "../showcase/page-states.js";
import { EDGE_CASES } from "../showcase/edge-states.js";
import * as mock from "../showcase/mocks.js";
import { BASE_VIEWPORT_HEIGHT_PX } from "../tokens/tokens.js";

const draw = (key: keyof typeof pageStates, extra: Parameters<typeof renderPersonalPage>[2] = {}) =>
  renderPersonalPage(pageStates[key], viewLabels(pageStates[key]), extra);

test("витрина и живая страница собирают одну функцию", async () => {
  const showcase = await import("../showcase/page.js");
  assert.equal(showcase.renderPersonalPage, renderPersonalPage);
});

test("без даты шапка не показывает тему периода", () => {
  const edge = EDGE_CASES.find((item) => item.id === "no-date");
  assert.ok(edge);
  const node = renderPersonalPage(edge.page, viewLabels(edge.page), { notice: edge.notice });
  assert.equal(byClass(node, "head__theme").length, 0);
  assert.equal(byClass(node, "head__metaphor").length, 0);
  assert.ok(visibleText(node).includes(edge.page.card.name));
});

test("крючок — отдельный блок, читается без контекста и помещается на один экран", () => {
  const hooks = [pageStates.s1.hook, pageStates.s3.hook, pageStates.s4.hook].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  assert.equal(hooks.length, 3);
  for (const hook of hooks) {
    const node = draw(hook === pageStates.s1.hook ? "s1" : hook === pageStates.s3.hook ? "s3" : "s4");
    const blocks = byClass(node, "hook");
    assert.equal(blocks.length, 1);
    assert.equal(visibleText(blocks[0]!), hook);
    assert.equal(blocks[0]?.children.length, 1, "крючок обязан читаться одной фразой, без соседнего текста внутри");
  }

  const longest = hooks.reduce((best, item) => (item && item.length > best.length ? item : best), "");
  const line = tokenPixels("text-xl") * 1.25;
  const pad = tokenPixels("space-5") * 2;
  const lines = Math.ceil(longest.length / 28);
  const height = pad + lines * line;
  assert.ok(height <= BASE_VIEWPORT_HEIGHT_PX, `крючок ${height.toFixed(0)} px выше экрана`);
});

test("крючок обновляется на ступенях 3 и 4", () => {
  assert.notEqual(pageStates.s1.hook, pageStates.s3.hook);
  assert.notEqual(pageStates.s3.hook, pageStates.s4.hook);
  assert.ok(visibleText(draw("s3")).includes(mock.hookAfterStep3));
  assert.ok(visibleText(draw("s4")).includes(mock.hookAfterStep4));
  assert.equal(visibleText(draw("s0")).includes(mock.hook), false);
});

test("блоки идут в порядке ступеней даже если сервер прислал их вразброс", () => {
  const shuffled = {
    ...pageStates.s3,
    blocks: [...pageStates.s3.blocks].reverse(),
  };
  const node = renderPersonalPage(shuffled, viewLabels(shuffled));
  const ids = findAll(node, "article").map((item) => String(item.attrs["data-block"]));
  assert.deepEqual(ids, ["step1", "step2", "step3"]);
});

test("полосы растут 0 → 3 → 5 → 7", () => {
  assert.equal(filledBars(pageStates.s0), 0);
  assert.equal(filledBars(pageStates.s1), 3);
  assert.equal(filledBars(pageStates.s2), 5);
  assert.equal(filledBars(pageStates.s3), 7);
});

test("пустая полоса по нажатию объясняет, чем откроется", () => {
  const node = draw("s0");
  const empty = pageStates.s0.map.filter((bar) => bar.fill === "empty");
  assert.equal(empty.length, 7);
  assert.ok(renderToString(node).includes("<summary"));
  const text = visibleText(node);
  for (const bar of empty) {
    assert.ok(text.includes(bar.hint), `нет объяснения «${bar.hint}»`);
  }
});

test("маршрут виден с первого экрана до первого вопроса", () => {
  const node = draw("s0");
  assert.ok(byClass(node, "route").length === 1);
  assert.ok(byClass(node, "portion").length === 1);
  assert.equal(node.attrs["data-profiled"], "false");
  const doors = findAll(node, "li").filter((item) => item.attrs["data-door"]);
  assert.ok(doors.some((door) => door.attrs["data-state"] === "opens_with_answers"));
});

test("после ступени 3 подписи дверей становятся профильными", () => {
  const before = draw("s2");
  const after = draw("s3");
  assert.equal(before.attrs["data-profiled"], "false");
  assert.equal(after.attrs["data-profiled"], "true");
  const locked = findAll(after, "li").filter((item) => item.attrs["data-state"] === "locked_profiled");
  assert.ok(locked.length > 0, "после ступени 3 нет профильных закрытых дверей");
  assert.equal(findAll(before, "li").some((item) => item.attrs["data-state"] === "locked_profiled"), false);
});

test("на каждой ступени есть дверь, открывающаяся ответами", () => {
  for (const key of ["s0", "s1", "s2", "s3", "s4"] as const) {
    const node = draw(key);
    const opens = findAll(node, "li").filter((item) => item.attrs["data-state"] === "opens_with_answers");
    assert.ok(opens.length >= 1, `${key}: нет двери, открывающейся ответами`);
  }
});

test("«Поделиться» появляется с s2, не раньше", () => {
  const share = copy("UI_BLOCK_SHARE");
  assert.equal(visibleText(draw("s0")).includes(share), false);
  assert.equal(visibleText(draw("s1")).includes(share), false);
  assert.ok(visibleText(draw("s2")).includes(share));
});

test("пауза «собираю» стоит на месте порции", () => {
  const node = draw("s0", { collecting: true });
  assert.equal(node.attrs["data-collecting"], "on");
  assert.equal(byClass(node, "portion").length, 0);
  assert.ok(byClass(node, "wait").some((item) => item.attrs["data-wait"] === "collecting"));
  assert.ok(visibleText(node).includes(copy("UI_WAIT_COLLECTING")));
});

test("публичный вид скрывает блоки 3 и 4, маршрут и действия блока", () => {
  const node = renderPersonalPage(pageStates.s3, viewLabels(pageStates.s3), { publicView: true });
  assert.equal(node.attrs["data-view"], "public");
  const blocks = byClass(node, "block").map((item) => String(item.attrs["data-block"]));
  assert.deepEqual(blocks, ["step1", "step2"]);
  assert.equal(byClass(node, "offer").length, 0);
  assert.equal(byClass(node, "route").length, 0);
  assert.equal(visibleText(node).includes(copy("UI_BLOCK_DISAGREE")), false);
  assert.ok(visibleText(node).includes(copy("UI_PUBLIC_MAKE_OWN")));
  assert.ok(visibleText(node).includes(copy("UI_PUBLIC_TITLE", { имя: pageStates.s3.card.name })));
});

test("выбор несогласия открывается в блоке тремя вариантами", () => {
  const node = draw("s2", { disagreeing: "step1" });
  const kinds = findAll(node, "button").filter((item) => item.attrs["data-action"] === "disagree-kind");
  assert.deepEqual(
    kinds.map((item) => item.attrs["data-kind"]),
    ["not_about_me", "partly", "too_general"],
  );
  assert.ok(visibleText(node).includes(copy("UI_DISAGREE_TITLE")));
  assert.ok(visibleText(node).includes(copy("UI_DISAGREE_EFFECT")));
});

test("все девять краевых состояний собираются той же функцией страницы", () => {
  assert.equal(EDGE_CASES.length, 9);
  for (const item of EDGE_CASES) {
    const node = renderPersonalPage(item.page, viewLabels(item.page), {
      notice: item.notice,
      portionIndex: item.portionIndex,
      portionValue: item.portionValue,
    });
    assert.equal(node.attrs["data-page"], item.page.state);
    if (item.notice) {
      assert.equal(node.attrs["data-edge"], item.notice.id);
      assert.ok(visibleText(node).includes(item.notice.texts[0]!), `нет текста краевого «${item.situation}»`);
    }
  }
});
