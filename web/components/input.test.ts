/**
 * Компоненты ввода (E6-05).
 *
 * Приёмка: цели не меньше 44×44 px (проверяется в `layout.test.ts` по всему
 * дереву витрины), шкала доступна как группа радиокнопок с именами, счётчик
 * слов появляется после пяти слов, кнопка включается от пятнадцати.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { renderOption, renderOptions, optionState } from "./option.js";
import { renderScale, SCALE_VALUES } from "./scale.js";
import {
  COUNTER_FROM_WORDS,
  SUBMIT_FROM_WORDS,
  countWords,
  openDraftNeedsPaint,
  openFieldState,
  renderOpenField,
} from "./open-field.js";
import { findAll, renderToString, visibleText } from "../src/dom.js";
import * as mock from "../showcase/mocks.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../src/paths.js";

const scale = (value?: 1 | 2 | 3 | 4 | 5, disabled = false) =>
  renderScale({
    group: "scale-test",
    label: mock.scaleQuestion.label,
    poles: mock.scaleQuestion.poles,
    markLabels: mock.scaleQuestion.markLabels,
    value: value ?? null,
    disabled,
  });

const field = (text: string, disabled = false) =>
  renderOpenField({
    id: "field-test",
    label: mock.openQuestion.label,
    hint: mock.openQuestion.hint,
    value: text,
    submitLabel: mock.openQuestion.submitLabel,
    counterText: mock.openQuestion.counterText,
    disabled,
  });

// ── Вариант ответа ────────────────────────────────────────────────────────────

test("вариант ответа — родная радиокнопка с подписью полным текстом", () => {
  const node = renderOption({ group: "q", value: "A", text: "когда меня торопят" });
  const inputs = findAll(node, "input");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.attrs["type"], "radio");
  assert.equal(inputs[0]?.attrs["name"], "q");
  assert.ok(visibleText(node).includes("когда меня торопят"));
});

test("состояния варианта: покой, выбранное, отключённое", () => {
  assert.equal(optionState({ group: "q", value: "A", text: "т" }), "rest");
  assert.equal(optionState({ group: "q", value: "A", text: "т", selected: true }), "selected");
  assert.equal(optionState({ group: "q", value: "A", text: "т", selected: true, disabled: true }), "disabled");
});

test("отключённая группа отключает каждую радиокнопку, а не только вид", () => {
  const node = renderOptions({ group: "q", label: "в", options: mock.choiceQuestion.options, disabled: true });
  for (const input of findAll(node, "input")) assert.equal(input.attrs["disabled"], true);
});

test("группа вариантов имеет имя: скринридер читает вопрос", () => {
  const node = renderOptions({ group: "q", label: mock.choiceQuestion.label, options: mock.choiceQuestion.options });
  assert.equal(node.attrs["role"], "radiogroup");
  assert.equal(node.attrs["aria-label"], mock.choiceQuestion.label);
});

// ── Шкала ─────────────────────────────────────────────────────────────────────

test("шкала — группа из пяти радиокнопок с общим именем", () => {
  const node = scale();
  assert.equal(node.attrs["role"], "radiogroup");
  const inputs = findAll(node, "input");
  assert.equal(inputs.length, SCALE_VALUES.length);
  assert.equal(new Set(inputs.map((input) => input.attrs["name"])).size, 1);
  for (const input of inputs) assert.equal(input.attrs["type"], "radio");
});

test("у каждой отметки шкалы своё имя, а не безымянная точка", () => {
  const names = findAll(scale(), "input").map((input) => String(input.attrs["aria-label"] ?? ""));
  assert.equal(names.length, 5);
  for (const name of names) assert.ok(name.length > 0, "отметка без имени");
  assert.equal(new Set(names).size, 5, "имена отметок повторяются");
});

test("подписи полюсов на месте, чисел в разметке шкалы человек не видит", () => {
  const text = visibleText(scale(3));
  assert.ok(text.includes(mock.scaleQuestion.poles.low));
  assert.ok(text.includes(mock.scaleQuestion.poles.high));
  assert.equal(/\d/.test(text), false, `цифра в тексте шкалы: ${text}`);
});

test("выбранная отметка одна и помечена и в разметке, и для скринридера", () => {
  const node = scale(4);
  const checked = findAll(node, "input").filter((input) => input.attrs["checked"] === true);
  assert.equal(checked.length, 1);
  assert.equal(checked[0]?.attrs["value"], "4");
});

test("отключённая шкала отключена целиком", () => {
  const node = scale(undefined, true);
  assert.equal(node.attrs["disabled"], true);
  for (const input of findAll(node, "input")) assert.equal(input.attrs["disabled"], true);
});

// ── Открытое поле ─────────────────────────────────────────────────────────────

test("слова считаются по словам, а не по пробелам", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("одно"), 1);
  assert.equal(countWords("  два   слова  "), 2);
  assert.equal(countWords("тире — не слово"), 3);
});

test("счётчик появляется ровно после пяти слов", () => {
  const four = openFieldState("раз два три четыре");
  assert.equal(four.counterVisible, false);
  const five = openFieldState("раз два три четыре пять");
  assert.equal(five.words, COUNTER_FROM_WORDS);
  assert.equal(five.counterVisible, true);
});

test("кнопка включается ровно от пятнадцати слов", () => {
  const fourteen = openFieldState(Array.from({ length: SUBMIT_FROM_WORDS - 1 }, () => "слово").join(" "));
  assert.equal(fourteen.submitEnabled, false);
  const fifteen = openFieldState(Array.from({ length: SUBMIT_FROM_WORDS }, () => "слово").join(" "));
  assert.equal(fifteen.submitEnabled, true);
});

test("черновик не требует перерисовки, пока не меняется видимая часть поля", () => {
  assert.equal(openDraftNeedsPaint("", "п"), false);
  assert.equal(openDraftNeedsPaint("раз два три четы", "раз два три четыр"), false);
  assert.equal(openDraftNeedsPaint("раз два три четыре", "раз два три четыре п"), true);
  assert.equal(
    openDraftNeedsPaint(
      Array.from({ length: SUBMIT_FROM_WORDS - 1 }, () => "слово").join(" "),
      Array.from({ length: SUBMIT_FROM_WORDS }, () => "слово").join(" "),
    ),
    true,
  );
});

test("на доборе среза кнопка включается с одного слова", () => {
  const one = openFieldState("слово", 1);
  assert.equal(one.submitEnabled, true);
  assert.equal(openFieldState("", 1).submitEnabled, false);
});

test("порог кнопки совпадает с порогом из content/questions-ladder.md", async () => {
  const engine = (await import(
    pathToFileURL(join(repoRoot, "engine/dist/index.js")).href
  )) as typeof import("../../engine/dist/index.js");
  assert.equal(SUBMIT_FROM_WORDS, engine.openMinWords());
});

test("пороги в разметке совпадают с порогами в состоянии", () => {
  const short = renderToString(field("раз два три"));
  assert.ok(short.includes("hidden"), "счётчик обязан быть спрятан до пяти слов");
  assert.ok(short.includes("disabled"), "кнопка обязана быть выключена до пятнадцати слов");

  const ready = renderToString(field(Array.from({ length: 20 }, () => "слово").join(" ")));
  assert.equal(ready.includes("disabled"), false, "от пятнадцати слов кнопка включается");
});

test("подсказка не исчезает: она в разметке при любом числе слов", () => {
  for (const text of ["", "раз два три", mock.openQuestion.long]) {
    assert.ok(visibleText(field(text)).includes(mock.openQuestion.hint), `подсказка пропала на «${text}»`);
  }
});

test("счётчик объявлен живой областью и связан с полем", () => {
  const node = field(mock.openQuestion.long);
  const textarea = findAll(node, "textarea")[0];
  const counter = findAll(node, "p").find((item) => item.attrs["role"] === "status");
  assert.ok(counter !== undefined);
  assert.equal(counter.attrs["aria-live"], "polite");
  assert.ok(String(textarea?.attrs["aria-describedby"] ?? "").includes(String(counter.attrs["id"])));
});

test("отключённое поле отключает и ввод, и кнопку", () => {
  const node = field(mock.openQuestion.long, true);
  assert.equal(findAll(node, "textarea")[0]?.attrs["disabled"], true);
  assert.equal(findAll(node, "button")[0]?.attrs["disabled"], true);
});
