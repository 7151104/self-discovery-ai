/**
 * Сборка страницы: крючок, блоки, карта, маршрут — приёмка E7-04…E7-06.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, isVNode, renderToString, visibleText, type Child, type VNode } from "./dom.js";
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

const classList = (node: VNode): string[] => String(node.attrs["class"] ?? "").split(/\s+/).filter(Boolean);

function slotsOf(page: VNode): string[] {
  const names: string[] = [];
  const walk = (nodes: Child[]): void => {
    for (const child of nodes) {
      if (!isVNode(child)) continue;
      const classes = classList(child);
      if (classes.includes("page__portrait") || classes.includes("reading")) {
        walk(child.children);
        continue;
      }
      if (classes.includes("head")) names.push("head");
      else if (classes.includes("hook")) names.push("hook");
      else if (classes.includes("map")) names.push("map");
      else if (classes.includes("portion")) names.push("portion");
      else if (classes.includes("route")) names.push("route");
      else if (classes.includes("wait")) names.push("wait");
      else if (classes.includes("block")) names.push("block");
      else if (classes.includes("offer")) names.push("offer");
    }
  };
  walk(page.children);
  return names;
}

test("после первой порции на странице карточка контакта, на входе её нет", () => {
  const s0 = draw("s0");
  assert.equal(byClass(s0, "contact").length, 0);
  const s1 = draw("s1");
  assert.equal(byClass(s1, "contact").length, 1);
  const text = visibleText(s1);
  assert.ok(text.includes(copy("UI_CONTACT_TITLE")));
  assert.ok(text.includes(copy("UI_CONTACT_SKIP")));
  const skipped = renderPersonalPage(
    { ...pageStates.s1, contact: { status: "skipped" } },
    viewLabels(pageStates.s1),
    { onContactLater: () => undefined },
  );
  assert.equal(byClass(skipped, "contact").length, 0);
  assert.ok(visibleText(skipped).includes(copy("UI_CONTACT_LATER")));
});

test("витрина реэкспортирует ту же сборку страницы", async () => {
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

test("на s0 страница читается разделами, а не стопкой полей", () => {
  const node = draw("s0");
  const text = visibleText(node);
  assert.ok(byClass(node, "hook")[0]?.attrs["data-empty"] === "true");
  assert.ok(text.includes(copy("UI_HOOK_EMPTY")));
  assert.ok(text.includes(copy("UI_MAP_TITLE")));
  assert.ok(text.includes(copy("UI_MAP_CLOSED_NOTE")));
  assert.ok(text.includes(copy("UI_READING_TITLE")));
  assert.ok(text.includes(copy("UI_READING_EMPTY")));
  assert.ok(text.includes(copy("UI_PORTION_TITLE")));
  assert.ok(text.includes(copy("UI_ROUTE_TITLE")));
  assert.ok(text.includes(copy("UI_ROUTE_NOTE")));
  assert.equal(text.includes(copy("UI_HEAD_LINK_HINT", { ссылка: pageStates.s0.url })), false);
});

test("на s0 работа — вопрос: порция сразу под шапкой, пустые слоты ниже", () => {
  const node = draw("s0");
  assert.deepEqual(slotsOf(node), ["head", "portion", "hook", "map", "route"]);
  assert.equal(byClass(node, "map")[0]?.attrs["data-empty"], "true");
  const s1 = draw("s1");
  assert.deepEqual(slotsOf(s1), ["head", "hook", "map", "block", "portion", "route"]);
  assert.equal(byClass(s1, "map")[0]?.attrs["data-empty"], "false");
});

test("после первой порции шапка показывает ссылку на страницу", () => {
  const node = draw("s1");
  assert.ok(visibleText(node).includes(copy("UI_HEAD_LINK_HINT", { ссылка: pageStates.s1.url })));
  assert.equal(byClass(node, "hook")[0]?.attrs["data-empty"], "false");
  assert.equal(visibleText(node).includes(copy("UI_READING_EMPTY")), false);
  assert.ok(visibleText(node).includes(copy("UI_READING_TITLE")));
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

test("на странице один портрет и одно «Поделиться», блоки — главы чтения", () => {
  const node = draw("s3");
  assert.equal(byClass(node, "page__portrait").length, 1);
  assert.equal(byClass(node, "reading").length, 1);
  const shares = findAll(node, "button").filter((item) => item.attrs["data-action"] === "share");
  assert.equal(shares.length, 1);
  assert.equal(byClass(node, "contact").length, 0);
});

test("карточка контакта стоит после порции, не между блоком и вопросами", () => {
  const markup = renderToString(draw("s1"));
  const portion = markup.indexOf('class="portion"');
  const contact = markup.indexOf('class="contact"');
  assert.ok(portion >= 0 && contact >= 0);
  assert.ok(portion < contact);
});

test("открытая панель шеринга стоит между портретом и чтением", () => {
  const node = draw("s2", {
    sharePanel: {
      imageReady: "ready",
      imageOnly: "only",
      saveLabel: "save",
      svg: "<svg></svg>",
      privacy: null,
      live: "live",
      openLabel: "open",
      publicOn: null,
      link: null,
      closeLabel: "close",
      closed: null,
    },
  });
  const markup = renderToString(node);
  const portrait = markup.indexOf('class="page__portrait"');
  const panel = markup.indexOf('class="share-panel"');
  const reading = markup.indexOf('class="reading"');
  assert.ok(portrait >= 0 && panel >= 0 && reading >= 0);
  assert.ok(portrait < panel && panel < reading);
});

test("пауза «собираю» стоит на месте порции", () => {
  const node = draw("s0", { collecting: true });
  assert.equal(node.attrs["data-collecting"], "on");
  assert.equal(byClass(node, "portion").length, 0);
  assert.ok(byClass(node, "wait").some((item) => item.attrs["data-wait"] === "collecting"));
  assert.ok(visibleText(node).includes(copy("UI_WAIT_COLLECTING")));
  assert.deepEqual(slotsOf(node), ["head", "wait", "hook", "map", "route"]);
});

test("пока сюжет пишется, предложение не показывается", () => {
  const waiting = {
    ...pageStates.s4Waiting,
    offer: mock.offer,
  };
  const node = renderPersonalPage(waiting, viewLabels(waiting));
  assert.ok(byClass(node, "wait").length === 1);
  assert.equal(byClass(node, "offer").length, 0);
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

test("уточняющие вопросы показываются текстом сервера, без ожидания и без отчёта", () => {
  const questions = ["follow-up-one", "follow-up-two"];
  const page = {
    ...pageStates.paidWaiting,
    offer: mock.offer,
    clarifications: { slice: "slice_node_finish", questions },
  };
  const node = renderPersonalPage(page, viewLabels(page));
  assert.equal(byClass(node, "wait").length, 0);
  assert.equal(byClass(node, "offer").length, 0);
  const section = findAll(node, "section").find((item) => item.attrs["data-clarifications"] === "slice_node_finish");
  assert.ok(section);
  const text = visibleText(node);
  assert.ok(text.includes(copy("UI_PAY_QUESTIONS", { вопросов: String(questions.length) })));
  for (const question of questions) assert.ok(text.includes(question));
});

test("после оплаты порция добора не соседствует с ожиданием ступени 4", () => {
  const page = {
    ...pageStates.paidPending,
    blocks: pageStates.s4Waiting.blocks,
  };
  const node = renderPersonalPage(page, viewLabels(page));
  assert.equal(byClass(node, "wait").length, 0);
  assert.equal(byClass(node, "portion").length, 1);
  assert.equal(byClass(node, "offer").length, 0);
});

test("промежуточный блок без действий несогласия и шеринга", () => {
  const page = {
    ...pageStates.paidPending,
    blocks: [
      ...pageStates.paidPending.blocks,
      {
        id: "slice:slice_work:interlude" as const,
        heading: "interlude-heading",
        paragraphs: ["interlude-body"],
        highlight: null,
        generation: null,
        disagreed: false,
        purchased: false,
        stale: false,
      },
    ],
  };
  const node = renderPersonalPage(page, viewLabels(page));
  const interlude = byClass(node, "block").find((item) => item.attrs["data-block"] === "slice:slice_work:interlude");
  assert.ok(interlude);
  assert.equal(findAll(interlude, "button").length, 0);
  assert.ok(visibleText(interlude).includes("interlude-heading"));
  assert.ok(visibleText(interlude).includes("interlude-body"));
});
