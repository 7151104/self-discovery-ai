/**
 * Экраны оплаты (E5-09).
 *
 * Проверяется то, что на этом экране легко потерять: состав есть у каждого среза и
 * записан составом, а не выгодой; цена на экране одна; запрещённых приёмов продажи нет
 * ни в текстах срезов, ни в рамке экрана из `content/ui-copy.md`.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { payContents, payScreen, payScreens } from "./pay-screens.js";
import { uiCopy, uiCopyGroup } from "./ui-copy.js";
import { scanTexts, describeHit } from "./forbidden.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const screens = payScreens();

test("экран оплаты написан для каждого среза с доборами и для полной карты", () => {
  const withFile = rawContent.slices.filter((slice) => slice.file).map((slice) => slice.id);
  assert.deepEqual(
    [...screens.map((screen) => screen.slice)].sort(),
    [...withFile, "slice_full_map"].sort(),
  );
  assert.equal(screens.length, 9, "экранов оплаты должно быть девять: восемь срезов и полная карта");
  assert.throws(() => payScreen("slice_compatibility"), /нет экрана оплаты/);
});

test("«что внутри» — состав, а не выгоды", () => {
  for (const screen of screens) {
    assert.ok(screen.contents.length >= 3, `${screen.slice}: в составе меньше трёх частей`);
    for (const part of screen.contents) {
      assert.ok(part.length > 12, `${screen.slice}: часть состава «${part}» слишком коротка, чтобы быть составом`);
      // Выгода обещает состояние человека после разбора; состав называет, что внутри.
      assert.ok(
        !/(станешь|начнёшь|перестанешь|избавишься|наконец|легко|быстро|уверенн|счастлив|успешн)/i.test(part),
        `${screen.slice}: «${part}» обещает состояние, а не называет часть разбора`,
      );
      assert.ok(!/^ты\b/i.test(part), `${screen.slice}: «${part}» начинается с обещания человеку`);
    }
    assert.ok(
      screen.contents.some((part) => /тво|теб|ты /i.test(part)),
      `${screen.slice}: состав ни в одной части не про этого человека`,
    );
  }
});

test("на экране одна цена: в текстах её нет вообще", () => {
  for (const screen of screens) {
    assert.ok(screen.price >= 490, `${screen.slice}: цена вне маршрута`);
    for (const text of [...screen.contents, screen.decline, screen.promise]) {
      assert.ok(!/₽|руб/i.test(text), `${screen.slice}: цена записана в тексте — на экране их станет две`);
    }
  }

  const withPrice = uiCopyGroup("PAY").filter((entry) => entry.text.includes("₽"));
  assert.deepEqual(
    withPrice.map((entry) => entry.id),
    ["UI_PAY_BUTTON"],
    "цена в реестре микрокопии стоит больше одного раза",
  );
  assert.equal(uiCopy("UI_PAY_BUTTON", { цена: 590 }), "Открыть — 590 ₽");
});

test("отказ есть у каждого экрана и не давит", () => {
  for (const screen of screens) {
    assert.ok(screen.decline.length > 30, `${screen.slice}: текст отказа слишком короткий`);
    assert.ok(
      !/(последний|только сегодня|успей|осталось|поспеши|пока не поздно|скидк|подорожа)/i.test(screen.decline),
      `${screen.slice}: в отказе давление на срок`,
    );
    assert.ok(!/\?|!/.test(screen.decline), `${screen.slice}: отказ спорит с человеком`);
  }
  assert.ok(!/\?|!/.test(uiCopy("UI_PAY_DECLINE")));
});

test("запрещённых приёмов продажи на экране оплаты нет", () => {
  const texts = [
    ...screens.flatMap((screen) => [...screen.contents, screen.decline, screen.promise]),
    ...uiCopyGroup("PAY").map((entry) => entry.text),
  ];
  const found = scanTexts(texts, "интерфейс");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );

  // Таймеров, зачёркнутых цен, отзывов и второй кнопки на экране быть не может:
  // запрет из docs/11-ui-page-spec.md проверяется по текстам, которые на нём стоят.
  for (const text of texts) {
    assert.ok(
      !/(таймер|осталось \d|мест осталось|отзыв|звёзд|было \d+|скидк|акци)/i.test(text),
      `запрещённый приём продажи в тексте: ${text}`,
    );
  }
});

test("состав экрана и обещание оффера — один источник правды", () => {
  for (const screen of screens) {
    const source = repoFile(`content/slices/${screen.file}`);
    assert.ok(source.includes(`**Что внутри:** ${screen.contents.join(" · ")}`), `${screen.slice}: состав разошёлся с файлом`);
    assert.ok(source.includes(`**Отказ:** ${screen.decline}`), `${screen.slice}: отказ разошёлся с файлом`);
    assert.equal(payContents(screen.slice), screen.contents.join(" · "));

    const slice = rawContent.slices.find((candidate) => candidate.id === screen.slice);
    if (!slice?.file) continue;
    assert.equal(screen.promise, slice.promise, `${screen.slice}: обещание экрана переписано вторым текстом`);
    assert.equal(screen.price, slice.price, `${screen.slice}: цена экрана разошлась с ценой среза`);
  }
});
