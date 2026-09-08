/**
 * Панель шеринга: картинка отдельно, публичная ссылка отдельно.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, visibleText } from "../src/dom.js";
import { renderSharePanel } from "./share-panel.js";

const svg = "<svg xmlns='http://www.w3.org/2000/svg'><text>крючок</text></svg>";

test("кнопка отдаёт картинку ссылкой скачивания, а не адрес страницы", () => {
  const node = renderSharePanel({
    imageReady: "готово",
    imageOnly: "только фраза",
    saveLabel: "сохранить",
    svg,
    privacy: "закрыта",
    live: "живая",
    openLabel: "открыть",
    publicOn: null,
    link: null,
    closeLabel: null,
    closed: null,
  });

  assert.equal(node.attrs["data-share"], "image");
  const save = findAll(node, "a").find((item) => item.attrs["class"] === "share-panel__save");
  assert.ok(save);
  assert.equal(save.attrs["download"], "share.svg");
  assert.equal(String(save.attrs["href"] ?? "").startsWith("data:image/svg+xml"), true);
  assert.ok(visibleText(node).includes("готово"));
  assert.ok(visibleText(node).includes("закрыта"));
});

test("без крючка картинки нет, публичный доступ всё равно можно включить", () => {
  const node = renderSharePanel({
    imageReady: "готово",
    imageOnly: "только фраза",
    saveLabel: "сохранить",
    svg: null,
    privacy: "закрыта",
    live: "живая",
    openLabel: "открыть",
    publicOn: null,
    link: null,
    closeLabel: null,
    closed: null,
  });

  assert.equal(node.attrs["data-share"], "empty");
  assert.equal(
    findAll(node, "a").some((item) => item.attrs["download"] === "share.svg"),
    false,
  );
  assert.ok(findAll(node, "button").some((item) => item.attrs["class"] === "share-panel__open"));
});

test("включённая ссылка показывает адрес и кнопку закрыть", () => {
  const node = renderSharePanel({
    imageReady: "готово",
    imageOnly: "только фраза",
    saveLabel: "сохранить",
    svg,
    privacy: null,
    live: "живая",
    openLabel: null,
    publicOn: "открыта",
    link: "ссылка: /s/token",
    closeLabel: "закрыть",
    closed: null,
  });

  assert.ok(visibleText(node).includes("открыта"));
  assert.ok(visibleText(node).includes("/s/token"));
  assert.ok(findAll(node, "button").some((item) => item.attrs["class"] === "share-panel__close"));
  assert.equal(
    findAll(node, "button").some((item) => item.attrs["class"] === "share-panel__open"),
    false,
  );
});
