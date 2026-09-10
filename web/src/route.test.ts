/**
 * Адресация живой страницы. Шаблоны обязаны совпадать с контрактом:
 * клиент их копирует, а не импортирует сервер в браузер.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  API_CREATE_PROFILE,
  API_DECLINE_OFFER,
  API_DISAGREE,
  API_GENERATION_STATUS,
  API_PAGE_STATE,
  API_PUBLIC_PAGE,
  API_PURCHASE,
  API_RECORD_CONSENT,
  API_SAVE_CONTACT,
  API_SHARE,
  API_SUBMIT_PORTION,
  fillPath,
  LEGAL_PATHS,
  PAGE_PATH,
  parseRoute,
  PUBLIC_PAGE_PATH,
} from "./route.js";
import { repoRoot } from "./paths.js";

const contract = (await import(pathToFileURL(join(repoRoot, "server/dist/contract/index.js")).href)) as typeof import("../../server/dist/contract/index.js");

test("шаблоны адресов совпадают с контрактом", () => {
  assert.equal(PAGE_PATH, contract.PAGE_PATH);
  assert.equal(PUBLIC_PAGE_PATH, contract.PUBLIC_PAGE_PATH);
  assert.equal(API_PAGE_STATE, contract.API.pageState.path);
  assert.equal(API_CREATE_PROFILE, contract.API.createProfile.path);
  assert.equal(API_SUBMIT_PORTION, contract.API.submitPortion.path);
  assert.deepEqual(LEGAL_PATHS, contract.LEGAL_PATHS);
  assert.equal(API_DISAGREE, contract.API.disagree.path);
  assert.equal(API_SAVE_CONTACT, contract.API.saveContact.path);
  assert.equal(API_SHARE, contract.API.share.path);
  assert.equal(API_PUBLIC_PAGE, contract.API.publicPage.path);
  assert.equal(API_PURCHASE, contract.API.purchase.path);
  assert.equal(API_GENERATION_STATUS, contract.API.generationStatus.path);
  assert.equal(API_DECLINE_OFFER, contract.API.declineOffer.path);
  assert.equal(API_RECORD_CONSENT, contract.API.recordConsent.path);
});

test("подстановка параметров совпадает с buildPath контракта", () => {
  const profileId = "abcdefghijabcdefghijab";
  assert.equal(fillPath(PAGE_PATH, { profileId }), `/p/${profileId}`);
  assert.equal(fillPath(API_PAGE_STATE, { profileId }), contract.buildPath("pageState", { profileId }));
  assert.equal(fillPath(API_SUBMIT_PORTION, { profileId }), contract.buildPath("submitPortion", { profileId }));
  assert.equal(
    fillPath(API_GENERATION_STATUS, { profileId, generationId: "gen" }),
    contract.buildPath("generationStatus", { profileId, generationId: "gen" }),
  );
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

test("ссылка /s/{token} открывает публичный вид", () => {
  assert.deepEqual(parseRoute("/s/abcdefghijabcdefghijab"), { kind: "public", token: "abcdefghijabcdefghijab" });
  assert.deepEqual(parseRoute("/s/a%20b"), { kind: "public", token: "a b" });
});

test("неизвестный адрес — понятная страница без профиля", () => {
  assert.deepEqual(parseRoute("/нет-такого"), { kind: "missing" });
  assert.deepEqual(parseRoute("/p/"), { kind: "missing" });
  assert.deepEqual(parseRoute("/s/"), { kind: "missing" });
});
