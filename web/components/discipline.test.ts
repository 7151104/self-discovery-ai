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
import { renderPortion } from "./portion.js";
import { renderScale } from "./scale.js";
import { renderWait } from "./wait.js";
import { renderConsent } from "./consent.js";
import { renderDisclaimerList } from "./disclaimer.js";
import { renderFooter } from "./footer.js";
import { renderLegalDoc } from "./legal-doc.js";
import { renderIntro } from "./intro.js";
import { renderMissing } from "./missing.js";
import { renderSharePanel } from "./share-panel.js";
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
      labels: {
        buy: "B",
        contents: "C",
        decline: "D",
        oneDoor: "O",
        legalLead: "L",
        legalLinks: [{ label: "O", href: "/legal/offer" }],
      },
    }),
  },
  {
    name: "предложение",
    node: renderOffer({
      offer: { slice: "s", title: "T", price: 590, promise: "P", questionCount: "10" },
      labels: {
        buy: "B",
        contents: "C",
        decline: "D",
        oneDoor: "O",
        legalLead: "L",
        legalLinks: [{ label: "P", href: "/legal/privacy" }],
      },
    }),
  },
  { name: "шапка", node: renderHead({ name: "N", season: null, theme: "T", metaphor: "M", cta: "C" }) },
  { name: "крючок", node: renderHook("H") },
  {
    name: "порция выбора",
    node: renderPortion({
      id: "step:1",
      question: { id: "Q1", kind: "выбор", text: "Q", options: [{ key: "A", text: "T" }], scale: null },
      index: 1,
      total: 3,
      labels: {
        lead: "L",
        progress: "P",
        back: "B",
        scaleMarks: ["a", "b", "c", "d", "e"],
        scaleHint: "H",
        openHint: "H",
        openSubmit: "S",
        counterText: (state) => `w ${state.words}`,
      },
    }),
  },
  {
    name: "порция числа",
    node: renderPortion({
      id: "slice:s",
      question: {
        id: "S5",
        kind: "число",
        text: "Q",
        options: [
          { key: "a", text: "A" },
          { key: "b", text: "B" },
        ],
        scale: null,
      },
      index: 0,
      total: 1,
      labels: {
        lead: "L",
        progress: "P",
        back: null,
        scaleMarks: ["a", "b", "c", "d", "e"],
        scaleHint: "H",
        openHint: "H",
        openSubmit: "S",
        counterText: (state) => `w ${state.words}`,
      },
    }),
  },
  { name: "ожидание", node: renderWait({ title: "T", topics: "X", longNote: "N" }) },
  {
    name: "карточка входа",
    node: renderIntro({
      labels: {
        title: "T",
        about: "A",
        nameLabel: "N",
        namePlaceholder: "P",
        nameRequired: "R",
        dateLabel: "D",
        dateHint: "H",
        submit: "S",
      },
      values: { name: "Ada", birthDate: "1990-01-01" },
    }),
  },
  { name: "нет профиля", node: renderMissing({ title: "T", text: "X", action: "A" }) },
  {
    name: "согласие",
    node: renderConsent({
      title: "T",
      body: "B",
      mark: [{ text: "M " }, { text: "L", href: "/legal/privacy" }],
      refuse: [{ text: "R " }, { text: "H", href: "/" }],
      checked: false,
    }),
  },
  {
    name: "подвал",
    node: renderFooter({ heading: "D", links: [{ label: "P", href: "/legal/privacy" }] }),
  },
  {
    name: "дисклеймер",
    node: renderDisclaimerList({ items: [{ id: "d", text: "T {{X}}" }], unfilledLabel: "u" }) as VNode,
  },
  { name: "документ", node: renderLegalDoc({ title: "T" }) },
  {
    name: "панель шеринга",
    node: renderSharePanel({
      imageReady: "R",
      imageOnly: "O",
      saveLabel: "S",
      svg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      privacy: "P",
      live: "L",
      openLabel: "N",
      publicOn: null,
      link: null,
      closeLabel: null,
      closed: null,
    }),
  },
];

for (const item of cases) {
  test(`${item.name} не приносит своих русских строк`, () => {
    const markup = renderToString(item.node);
    const found = CYRILLIC.exec(markup);
    assert.equal(found, null, `в разметке кириллица: ${markup.slice(Math.max(0, (found?.index ?? 0) - 40), (found?.index ?? 0) + 40)}`);
  });
}

/**
 * Слои — стили без компонента: общая основа (сброс, кольцо фокуса) и движение
 * (появление блока, выключатель анимаций). Список закрытый: файл стилей без
 * компонента и без места в этом списке — ошибка, а не новый слой.
 */
const LAYERS = new Set(["base.css", "motion.css"]);

test("компоненты не знают о витрине и её моках", () => {
  for (const name of componentFiles()) {
    if (LAYERS.has(name)) continue;
    const source = readFileSync(join(webRoot, "components", name.replace(".css", ".ts")), "utf8");
    assert.equal(source.includes("showcase"), false, `${name}: компонент тянет витрину`);
  }
});

test("каждому файлу стилей соответствует компонент, и наоборот", () => {
  for (const file of componentFiles()) {
    const component = join(webRoot, "components", file.replace(".css", ".ts"));
    if (LAYERS.has(file)) {
      assert.throws(() => readFileSync(component, "utf8"), `${file} объявлен слоем, но у него есть компонент`);
      continue;
    }
    assert.doesNotThrow(() => readFileSync(component, "utf8"), `${file} без компонента`);
  }
});
