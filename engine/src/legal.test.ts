/**
 * Юридические тексты: версия согласия из содержимого, страницы читают markdown.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  consentShort,
  consentVersion,
  disclaimersAt,
  legalDocumentByPath,
  legalTitle,
  markdownSection,
  normalizeLegalSource,
  readLegalFile,
  renderLegalDocument,
  LEGAL_DOCUMENTS,
} from "./legal.js";
import { renderLegalMarkdown } from "./legal-markdown.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("каталог документов покрывает политику, согласие, оферту и дисклеймеры", () => {
  assert.deepEqual(
    LEGAL_DOCUMENTS.map((item) => item.id),
    ["privacy", "consent", "offer", "disclaimers"],
  );
  for (const item of LEGAL_DOCUMENTS) {
    assert.match(item.path, /^\/legal\/[a-z-]+$/);
    assert.ok(readLegalFile(item.file).length > 400, `${item.file} пустой`);
    assert.equal(legalDocumentByPath(item.path)?.id, item.id);
  }
  assert.equal(legalDocumentByPath("/legal/нет"), null);
});

test("версия согласия — отпечаток полного текста, а не номер в файле", () => {
  const source = readLegalFile("consent.md");
  const body = markdownSection(source, "Полный текст согласия");
  const expected = createHash("sha256").update(normalizeLegalSource(body), "utf8").digest("hex");
  assert.equal(consentVersion(source), expected);
  assert.equal(consentVersion(source).length, 64);
  assert.equal(consentVersion(source), consentVersion());

  const patched = source.replace("Я даю", "Я даю (правка)");
  assert.notEqual(consentVersion(patched), expected);

  const windows = source.replace(/\n/g, "\r\n");
  assert.equal(consentVersion(windows), expected);
});

test("правка пояснения «как собирается» версию не меняет, правка полного текста — меняет", () => {
  const source = readLegalFile("consent.md");
  const original = consentVersion(source);
  const meta = source.replace("не оформляется модальным окном", "не всплывает окном");
  assert.equal(consentVersion(meta), original);
  const legal = source.replace("автоматизированный.", "автоматизированный и смешанный.");
  assert.notEqual(consentVersion(legal), original);
});

test("короткий текст согласия читается из файла и ссылается на постоянные адреса", () => {
  const short = consentShort();
  assert.equal(short.title, "Прежде чем начать");
  assert.ok(short.body.includes("Твои ответы сохраняются на сервере"));
  assert.equal(short.button, "Начать");
  assert.ok(short.mark.some((part) => part.href === "/legal/privacy" && part.text === "политике"));
  assert.ok(short.refuse.some((part) => part.href === "/" && part.text === "странице о сервисе"));
  assert.equal(short.mark.some((part) => (part.href ?? "").includes("{{")), false);
});

test("страница читает markdown и не копирует его в код", () => {
  const policy = repoFile("content/legal/privacy-policy.md");
  const page = renderLegalDocument("privacy", { unfilledLabel: "не заполнено" });
  assert.equal(page.title, legalTitle(policy));
  assert.ok(page.html.includes("Какие данные обрабатываются"));
  assert.ok(page.html.includes("data-unfilled=\"ОПЕРАТОР_ИНН\""));
  assert.ok(page.html.includes("{{ОПЕРАТОР_ИНН}}"));
  assert.ok(page.html.includes("Умная корзина"), "имя продукта должно подставляться из идентичности");
  assert.ok(page.html.includes("wordpop.ru"), "домен должен подставляться из идентичности");
  assert.equal(page.unfilled.includes("ДОМЕН"), false);
  assert.equal(page.unfilled.includes("НАЗВАНИЕ_ПРОДУКТА"), false);
  assert.ok(page.unfilled.includes("ОПЕРАТОР_ИНН"));
  assert.equal(page.html.includes("ООО «Ромашка»"), false);
  assert.equal(page.html.includes("1234567890"), false);
});

test("заполненный реквизит становится текстом, пустой остаётся подстановкой", () => {
  const html = renderLegalMarkdown("Сервис {{НАЗВАНИЕ_ПРОДУКТА}} на {{ДОМЕН}}. ИНН {{ОПЕРАТОР_ИНН}}.\n", {
    unfilledLabel: "не заполнено",
    values: { НАЗВАНИЕ_ПРОДУКТА: "Умная корзина", ДОМЕН: "wordpop.ru" },
  });
  assert.match(html, /Умная корзина/);
  assert.match(html, /wordpop\.ru/);
  assert.match(html, /data-unfilled="ОПЕРАТОР_ИНН"/);
  assert.equal(html.includes("{{ДОМЕН}}"), false);
});

test("незаполненная подстановка на странице видна и не подменяется", () => {
  const html = renderLegalMarkdown("Оператор: {{ОПЕРАТОР_НАИМЕНОВАНИЕ}}.\n", { unfilledLabel: "не заполнено" });
  assert.match(html, /data-unfilled="ОПЕРАТОР_НАИМЕНОВАНИЕ"/);
  assert.match(html, /title="не заполнено"/);
  assert.match(html, /\{\{ОПЕРАТОР_НАИМЕНОВАНИЕ\}\}/);
});

test("оферта и дисклеймеры открываются тем же разбором", () => {
  const offer = renderLegalDocument("offer", { unfilledLabel: "не заполнено" });
  assert.ok(offer.html.includes("Что покупается"));
  assert.ok(offer.unfilled.includes("ПЛАТЁЖНЫЙ_ПРОВАЙДЕР"));

  const list = renderLegalDocument("disclaimers", { unfilledLabel: "не заполнено" });
  assert.ok(list.html.includes("DISCLAIMER_NOT_MEDICAL") || list.html.includes("не медицинская"));
  assert.ok(list.html.includes("<table>"));
});

test("немедицинский дисклеймер есть у разбора, а не только в подвале", () => {
  const items = disclaimersAt("блок ступени 3");
  assert.ok(items.some((item) => item.id === "DISCLAIMER_NOT_MEDICAL"));
  const footer = disclaimersAt("подвал");
  assert.ok(footer.some((item) => item.id === "DISCLAIMER_NOT_MEDICAL"));
  const pay = disclaimersAt("экран оплаты");
  assert.ok(pay.some((item) => item.id === "DISCLAIMER_NOT_MEDICAL"));
});
