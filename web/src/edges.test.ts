/**
 * Краевые состояния: какую заметку ставит живой клиент.
 *
 * Витрина передаёт заметку явно из `EDGE_CASES`. Живой клиент выводит её
 * из состояния сервера и короткого контекста визита. Сборка экрана одна.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { EDGE_CASES } from "../showcase/edge-states.js";
import { edgeNotice } from "./edges.js";
import { edgeTexts } from "./page-copy.js";

const byId = (id: string) => {
  const found = EDGE_CASES.find((item) => item.id === id);
  assert.ok(found, `нет краевого «${id}»`);
  return found;
};

test("короткий L12 — не заметка страницы", () => {
  const edge = byId("open-too-short");
  assert.equal(edge.notice, null);
  assert.equal(edgeNotice(edge.page), null);
});

test("девять ситуаций витрины покрыты, и живой клиент ставит ту же заметку", () => {
  assert.equal(EDGE_CASES.length, 9);

  assert.equal(edgeNotice(byId("no-date").page)?.id, "no-date");
  assert.equal(edgeNotice(byId("crisis").page)?.id, "crisis");
  assert.equal(edgeNotice(byId("no-node").page)?.id, "no-node");
  assert.equal(edgeNotice(byId("return").page, { returned: true })?.id, "return");
  assert.equal(edgeNotice(byId("pay-declined").page, { offerDeclined: true })?.id, "pay-declined");
  assert.equal(edgeNotice(byId("answer-changed").page)?.id, "answer-changed");
  assert.equal(edgeNotice(byId("payment-failed").page, { paymentFailed: true })?.id, "payment-failed");
  assert.equal(edgeNotice(byId("generation-failed").page)?.id, "generation-failed");
});

test("тексты заметок — из реестра микрокопии", () => {
  assert.equal(edgeNotice(byId("no-date").page)?.texts[0], edgeTexts.noDate());
  assert.equal(edgeNotice(byId("crisis").page)?.texts[0], edgeTexts.crisis());
  assert.equal(edgeNotice(byId("crisis").page)?.tone, "crisis");
  assert.equal(edgeNotice(byId("generation-failed").page)?.texts[0], edgeTexts.generationFailed());
});

test("приоритет: кризис, затем сборка, оплата, правка, узел, возврат, дата", () => {
  const crisis = byId("crisis").page;
  assert.equal(
    edgeNotice(crisis, { paymentFailed: true, offerDeclined: true, returned: true })?.id,
    "crisis",
  );

  const failed = byId("generation-failed").page;
  assert.equal(edgeNotice(failed, { paymentFailed: true, offerDeclined: true })?.id, "generation-failed");

  const s4 = byId("payment-failed").page;
  assert.equal(edgeNotice(s4, { paymentFailed: true, offerDeclined: true })?.id, "payment-failed");
  assert.equal(edgeNotice(s4, { offerDeclined: true, returned: true })?.id, "pay-declined");

  const stale = byId("answer-changed").page;
  assert.equal(edgeNotice(stale, { returned: true })?.id, "answer-changed");

  const noNode = byId("no-node").page;
  assert.equal(edgeNotice(noNode, { returned: true })?.id, "no-node");

  const returned = byId("return").page;
  assert.equal(edgeNotice(returned, { returned: true })?.id, "return");
});
