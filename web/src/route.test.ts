/**
 * Адресация живой страницы. Шаблоны обязаны совпадать с контрактом:
 * клиент их копирует, а не импортирует сервер в браузер.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { API_CREATE_PROFILE, API_PAGE_STATE, API_SUBMIT_PORTION, fillPath, PAGE_PATH, parseRoute } from "./route.js";
import { repoRoot } from "./paths.js";

const contract = (await import(pathToFileURL(join(repoRoot, "server/dist/contract/index.js")).href)) as typeof import("../../server/dist/contract/index.js");

test("шаблоны адресов совпадают с контрактом", () => {
  assert.equal(PAGE_PATH, contract.PAGE_PATH);
  assert.equal(API_PAGE_STATE, contract.API.pageState.path);
  assert.equal(API_CREATE_PROFILE, contract.API.createProfile.path);
  assert.equal(API_SUBMIT_PORTION, contract.API.submitPortion.path);
});

test("подстановка параметров совпадает с buildPath контракта", () => {
  const profileId = "abcdefghijabcdefghijab";
  assert.equal(fillPath(PAGE_PATH, { profileId }), `/p/${profileId}`);
  assert.equal(fillPath(API_PAGE_STATE, { profileId }), contract.buildPath("pageState", { profileId }));
  assert.equal(fillPath(API_SUBMIT_PORTION, { profileId }), contract.buildPath("submitPortion", { profileId }));
});

test("ссылка /p/{profileId} открывает страницу профиля", () => {
  assert.deepEqual(parseRoute("/p/abcdefghijabcdefghijab"), { kind: "page", profileId: "abcdefghijabcdefghijab" });
  assert.deepEqual(parseRoute("/p/a%20b"), { kind: "page", profileId: "a b" });
});

test("корень и адрес клиента — карточка входа", () => {
  for (const path of ["/", "/index.html", "/web/page", "/web/page/", "/web/page/index.html"]) {
    assert.deepEqual(parseRoute(path), { kind: "intro" }, path);
  }
});

test("неизвестный адрес — понятная страница без профиля", () => {
  assert.deepEqual(parseRoute("/нет-такого"), { kind: "missing" });
  assert.deepEqual(parseRoute("/p/"), { kind: "missing" });
  assert.deepEqual(parseRoute("/s/token"), { kind: "missing" });
});
