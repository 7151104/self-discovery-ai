/**
 * Приёмка E6-10: состояния загрузки и ожидания генерации.
 *
 *   1. на ступенях 1–3 состояний загрузки нет вообще;
 *   2. после перезагрузки на ожидании видно то же ожидание;
 *   3. затянувшееся ожидание сообщает об этом текстом из контента.
 *
 * И главное продуктовое ограничение: перечень уточняемого не выдаёт ни имён
 * координат, ни чисел, ни машинных кодов, а сам экран не изображает
 * размышление.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectAttributes, renderToString, visibleText } from "../src/dom.js";
import { copy } from "../src/copy.js";
import { webRoot } from "../src/paths.js";
import { componentCss } from "../src/test-support.js";
import { parseCss } from "../src/css.js";
import type { PageStateDto } from "../src/contract.js";
import { LONG_WAIT_MS, renderWait, waitFromPage, waitTopics } from "./wait.js";
import { waitTexts } from "../src/page-copy.js";
import * as mock from "../showcase/mocks.js";
import { pageStates } from "../showcase/page-states.js";

const at = (state: PageStateDto): number => Date.parse(state.updatedAt);

test("на ступенях 1–3 состояния загрузки нет вообще", () => {
  for (const name of ["s0", "s1", "s2", "s3"] as const) {
    const state = pageStates[name];
    for (const block of state.blocks) {
      assert.equal(block.generation, null, `${name}: у блока ${block.id} заявлена сборка, а тексты там lookup`);
    }
    assert.equal(waitFromPage(state, { now: at(state) }), null, `${name}: показано ожидание там, где ждать нечего`);
  }
});

test("сборка на ступени 1–3 не превращается в ожидание даже если сервер её пришлёт", () => {
  const broken: PageStateDto = {
    ...pageStates.s2,
    blocks: pageStates.s2.blocks.map((block, index) =>
      index === 0 ? { ...block, generation: { id: "g1", status: "pending" as const } } : block,
    ),
  };
  assert.equal(waitFromPage(broken, { now: at(broken) }), null);
});

test("ожидание ступени 4 и платного среза выводится из состояния страницы", () => {
  const step4 = pageStates.s4Waiting;
  const wait = waitFromPage(step4, { now: at(step4) });
  assert.deepEqual(wait, { kind: "step4", blockId: "step4", long: false, resumed: false });

  const paid = pageStates.paidWaiting;
  const paidWait = waitFromPage(paid, { now: at(paid) });
  assert.equal(paidWait?.kind, "slice");
  assert.match(String(paidWait?.blockId), /^slice:/);
});

test("после перезагрузки видно то же ожидание", () => {
  const state = pageStates.s4Waiting;
  const before = waitFromPage(state, { now: at(state) });
  // Перезагрузка: та же страница пришла с сервера заново, вкладка новая.
  const after = waitFromPage(structuredClone(state), { now: at(state) + 1_000, reopened: true });

  assert.deepEqual({ ...after, resumed: false }, before, "ожидание переехало перезагрузку не тем же");
  assert.equal(after?.resumed, true, "возврат на страницу не отмечен");

  const markup = (wait: ReturnType<typeof waitFromPage>) =>
    renderToString(renderWait({ title: waitTexts.title(wait!), kind: wait!.kind }));
  assert.equal(markup(after), markup(before), "разметка ожидания после перезагрузки другая");
});

test("состояние ожидания не хранится в браузере: источник — сервер", () => {
  const source = readFileSync(join(webRoot, "components", "wait.ts"), "utf8");
  for (const storage of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
    assert.equal(source.includes(storage), false, `ожидание опирается на ${storage} — перезагрузка его потеряет`);
  }
});

test("затянувшееся ожидание сообщает об этом текстом из контента", () => {
  const state = pageStates.s4Waiting;
  assert.equal(waitFromPage(state, { now: at(state) + LONG_WAIT_MS - 1 })?.long, false);

  const long = waitFromPage(state, { now: at(state) + LONG_WAIT_MS });
  assert.equal(long?.long, true);

  const note = copy("UI_WAIT_LONG");
  assert.equal(waitTexts.longNote(long!), note, "текст задержки взят не из реестра микрокопии");
  assert.match(renderToString(renderWait({ title: waitTexts.title(long!), longNote: note })), /Сборка идёт дольше/);
});

test("перечень уточняемого — темы карты, а не координаты", () => {
  const topics = waitTopics(mock.mapBars);
  assert.ok(topics.length > 0, "уточнять нечего — экран ожидания остался бы без перечня");

  const labels = mock.mapBars.map((bar) => bar.label);
  for (const topic of topics) assert.ok(labels.includes(topic), `«${topic}» не подпись полосы карты`);

  const precise = mock.mapBars.filter((bar) => bar.fill === "precise").map((bar) => bar.label);
  for (const topic of topics) assert.equal(precise.includes(topic), false, `«${topic}» уже точна, её не уточняют`);
});

test("в разметке ожидания нет ни чисел, ни процентов, ни машинных кодов", () => {
  const wait = waitFromPage(pageStates.paidWaiting, { now: at(pageStates.paidWaiting) + LONG_WAIT_MS });
  const node = renderWait({
    title: waitTexts.title(wait!),
    topics: waitTexts.topics(pageStates.paidWaiting),
    longNote: waitTexts.longNote(wait!),
    kind: wait!.kind,
  });

  const text = visibleText(node);
  assert.equal(/\d/.test(text), false, `на экране ожидания цифры: ${text}`);
  assert.equal(/%/.test(text), false, "на экране ожидания проценты");

  for (const attribute of collectAttributes(node)) {
    assert.equal(/slice[:_]|step[1-4]|confidence|coord/i.test(attribute.value), false,
      `машинный код в атрибуте ${attribute.name}="${attribute.value}"`);
  }
});

test("ожидание не изображает размышление модели", () => {
  const node = renderWait({
    title: waitTexts.title({ kind: "step4", blockId: "step4", long: false, resumed: false }),
    topics: waitTexts.topics(pageStates.s4Waiting),
  });
  const text = visibleText(node).toLowerCase();
  for (const word of ["ии", "нейросет", "модель", "думает", "печатает", "загрузка", "подождите", "искусственн"]) {
    assert.equal(text.includes(word), false, `на экране ожидания слово «${word}»`);
  }

  // Ни одной анимации: намётки строк неподвижны, бегущих точек нет.
  for (const rule of parseCss(componentCss("wait.css"))) {
    for (const declaration of rule.declarations) {
      assert.equal(declaration.property.startsWith("animation"), false,
        `wait.css:${declaration.line}: экран ожидания анимирован — это имитация работы`);
    }
  }
});

test("экран ожидания объявлен живой областью и занятым", () => {
  const markup = renderToString(renderWait({ title: "T" }));
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-busy="true"/);
  // Форма будущего текста — украшение, скринридеру её читать незачем.
  assert.match(markup, /class="wait__shape" aria-hidden="true"/);
});
