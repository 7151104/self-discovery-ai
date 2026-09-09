/**
 * Карточка контакта после первой порции: пропуск возможен, пустая отправка — нет.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, visibleText } from "../src/dom.js";
import { contactPayload, renderContactCard } from "./contact.js";

const labels = {
  title: "Страница уже твоя",
  lead: "Оставь контакт",
  emailLabel: "Почта",
  emailPlaceholder: "если удобно письмом",
  channelLabel: "Telegram или телефон",
  channelHint: "Необязательно",
  submit: "Оставить контакт",
  skip: "Пока не сейчас",
  error: "Нужна почта или Telegram — хотя бы что-то одно.",
};

test("пустые поля не собираются, одно поле — достаточно", () => {
  assert.deepEqual(contactPayload("  ", ""), { ok: false });
  assert.deepEqual(contactPayload("a@b.c", ""), { ok: true, email: "a@b.c", channel: "" });
  assert.deepEqual(contactPayload("", " @anna "), { ok: true, email: "", channel: "@anna" });
});

test("на карточке видны пропуск и оба поля", () => {
  const node = renderContactCard({ labels });
  const text = visibleText(node);
  assert.ok(text.includes(labels.title));
  assert.ok(text.includes(labels.skip));
  assert.ok(findAll(node, "input").some((item) => item.attrs["name"] === "email"));
  assert.ok(findAll(node, "input").some((item) => item.attrs["name"] === "channel"));
  assert.equal(findAll(node, "button").length, 2);
});
