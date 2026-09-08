/**
 * Дисциплина компонентов: русских продуктовых строк в них нет.
 *
 * Проверка не по исходнику, а по результату: каждый компонент собирается на
 * данных без единой русской буквы. Если в разметке появилась кириллица —
 * значит, формулировка зашита в компонент и выпала из линтера запрещённых
 * формулировок (E5-01) и из реестра микрокопии (E5-03).
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderBlock } from "./block.js";
import { renderDoor, renderRoute } from "./door.js";
import { renderMap } from "./map.js";
import { renderOffer, renderPaymentStep } from "./offer.js";
import { renderOpenField } from "./open-field.js";
import { renderOption, renderOptions } from "./option.js";
import { renderHead, renderHook } from "./page-head.js";
import { renderScale } from "./scale.js";
import { renderToString, type VNode } from "../src/dom.js";
import { componentFiles } from "../src/test-support.js";
import { webRoot } from "../src/paths.js";
import type { DoorDto, MapBarDto } from "../src/contract.js";

const CYRILLIC = /[\u0400-\u04FF]/;

const latinBars: MapBarDto[] = [
  { id: "tempo", label: "L", poles: { low: "lo", high: "hi" }, fill: "precise", position: 0.7, category: null, hint: "h" },
  { id: "structure", label: "L", poles: { low: "lo", high: "hi" }, fill: "empty", position: null, category: null, hint: "h" },
  {
    id: "trigger",
    label: "L",
    poles: null,
    fill: "approximate",
    position: null,
    category: { options: ["a", "b", "c", "d", "e", "f", "g"], selected: "c" },
    hint: "h",
  },
];

const latinDoors: DoorDto[] = [
  { id: "one", title: "T", state: "opens_with_answers", price: null, slice: null },
  { id: "two", title: "T", state: "paid", price: 590, slice: "s" },
];

const cases: { name: string; node: VNode }[] = [
  { name: "вариант ответа", node: renderOption({ group: "g", value: "v", text: "T" }) },
  { name: "группа вариантов", node: renderOptions({ group: "g", label: "L", options: [{ value: "v", text: "T" }] }) },
  {
    name: "шкала",
    node: renderScale({ group: "g", label: "L", poles: { low: "lo", high: "hi" }, markLabels: ["a", "b", "c", "d", "e"], value: 3 }),
  },
  {
    name: "открытое поле",
    node: renderOpenField({
      id: "f",
      label: "L",
      hint: "H",
      value: "one two three four five six",
      submitLabel: "S",
      counterText: (state) => `w ${state.words}`,
    }),
  },
  {
    name: "блок разбора",
    node: renderBlock({
      id: "step1",
      heading: "H",
      paragraphs: ["P"],
      highlight: "S",
      actions: [{ id: "disagree", label: "D" }],
      note: "N",
      stale: true,
    }),
  },
  { name: "карта", node: renderMap({ bars: latinBars, label: "L" }) },
  { name: "дверь", node: renderDoor({ door: latinDoors[1] as DoorDto, visual: "offered", priceText: "590" }) },
  {
    name: "маршрут",
    node: renderRoute({
      doors: latinDoors,
      context: { offerSlice: "s", profiled: true },
      formatPrice: (price) => String(price),
      label: "L",
    }),
  },
  {
    name: "точка оплаты",
    node: renderPaymentStep({
      offer: { slice: "s", title: "T", price: 590, promise: "P", questionCount: "10" },
      labels: { buy: "B", contents: "C", decline: "D" },
      formatPrice: (price) => String(price),
    }),
  },
  {
    name: "предложение",
    node: renderOffer({
      offer: { slice: "s", title: "T", price: 590, promise: "P", questionCount: "10" },
      labels: { buy: "B", contents: "C", decline: "D" },
      formatPrice: (price) => String(price),
    }),
  },
  { name: "шапка", node: renderHead({ name: "N", season: null, theme: "T", metaphor: "M", cta: "C" }) },
  { name: "крючок", node: renderHook("H") },
];

for (const item of cases) {
  test(`${item.name} не приносит своих русских строк`, () => {
    const markup = renderToString(item.node);
    const found = CYRILLIC.exec(markup);
    assert.equal(found, null, `в разметке кириллица: ${markup.slice(Math.max(0, (found?.index ?? 0) - 40), (found?.index ?? 0) + 40)}`);
  });
}

test("компоненты не знают о витрине и её моках", () => {
  for (const name of componentFiles()) {
    if (name === "base.css") continue;
    const source = readFileSync(join(webRoot, "components", name.replace(".css", ".ts")), "utf8");
    assert.equal(source.includes("showcase"), false, `${name}: компонент тянет витрину`);
  }
});

test("каждому файлу стилей соответствует компонент, и наоборот", () => {
  const styles = componentFiles().map((name) => name.replace(".css", ""));
  for (const name of styles) {
    if (name === "base") continue;
    assert.doesNotThrow(() => readFileSync(join(webRoot, "components", `${name}.ts`), "utf8"), `${name}.css без компонента`);
  }
});
