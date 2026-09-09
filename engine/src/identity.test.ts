/**
 * Имя продукта и домен читаются из content/identity.md, не из кода.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { identityRequisites, productDomain, productIdentity, productOrigin } from "./identity.js";
import { shareCaption, shareReady } from "./share.js";

test("идентичность заполнена: русское имя, английское имя, домен и происхождение совпадают", () => {
  const identity = productIdentity();
  assert.equal(identity.nameRu, "Умная корзина");
  assert.equal(identity.nameEn, "Smart Basket");
  assert.equal(identity.domain, "wordpop.ru");
  assert.equal(identity.origin, "https://wordpop.ru");
  assert.equal(new URL(identity.origin).host, identity.domain);
  assert.equal(productDomain(), "wordpop.ru");
  assert.equal(productOrigin(), "https://wordpop.ru");
  assert.match(identity.logoMark, /^\/web\/assets\/logo-mark\.svg$/);
  assert.match(identity.logoWordmark, /^\/web\/assets\/logo-wordmark\.svg$/);
});

test("реквизиты закрывают шеринговую картинку без внешнего словаря", () => {
  const requisites = identityRequisites();
  assert.equal(shareReady(requisites), true);
  assert.equal(shareCaption("SHARE_IMAGE_SIGNATURE", requisites), "Умная корзина · wordpop.ru");
  assert.match(shareCaption("SHARE_IMAGE_ALT", requisites), /wordpop\.ru/);
});
