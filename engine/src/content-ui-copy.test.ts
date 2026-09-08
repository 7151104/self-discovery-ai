/**
 * E5-03 и E5-06: реестр микрокопии (`content/ui-copy.md`), тексты пустых полос и
 * краевых состояний.
 *
 * Три вещи проверяются здесь и нигде больше: обращение к отсутствующему
 * идентификатору падает, у каждой полосы и каждого краевого состояния есть текст,
 * в `prototype/` не осталось зашитых русских строк.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawExtraContent } from "./generated/content-extra.js";
import { uiCopy, uiCopyGroup, uiCopyIds, barCopy } from "./ui-copy.js";
import { BAR_DEFINITIONS } from "./map.js";
import { scanTexts, describeHit } from "./forbidden.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const registry = rawExtraContent.uiCopy;

test("реестр разобран: идентификаторы, группы и места показа", () => {
  assert.ok(registry.length >= 100, `в реестре только ${registry.length} строк`);
  for (const entry of registry) {
    assert.match(entry.id, /^UI_[A-Z0-9_]+$/, `идентификатор ${entry.id}`);
    assert.ok(entry.group.length > 0, `${entry.id}: нет группы`);
    assert.ok(entry.text.length > 0, `${entry.id}: пустой текст`);
    assert.ok(entry.where.length > 0, `${entry.id}: не сказано, где показывается`);
  }
  const groups = new Set(registry.map((entry) => entry.group));
  for (const group of ["INTRO", "LEGAL", "HEAD", "MAP", "BLOCK", "PORTION", "OPEN", "WAIT", "PAY", "ROUTE", "ERROR", "EDGE"]) {
    assert.ok(groups.has(group), `нет группы ${group}`);
  }
});

test("обращение к отсутствующему идентификатору падает", () => {
  assert.throws(() => uiCopy("UI_НЕТ_ТАКОЙ_СТРОКИ"), /нет строки/);
  assert.throws(() => uiCopy("UI_PAY_BUTTON"), /не передана подстановка \{цена\}/);
  assert.throws(() => uiCopy("UI_ROUTE_TITLE", { цена: 1 }), /подстановки \{цена\} в тексте нет/);
  assert.equal(uiCopy("UI_PAY_BUTTON", { цена: 590 }), "Открыть — 590 ₽");
});

test("у каждой подстановки в тексте есть имя, и оно на русском", () => {
  for (const entry of registry) {
    const braces = [...entry.text.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    for (const name of braces) {
      assert.match(name, /^[а-яё]+$/, `${entry.id}: подстановка «${name}» записана не по правилу`);
    }
    assert.deepEqual(entry.params, braces, `${entry.id}: подстановки разобраны неверно`);
  }
});

test("у каждой полосы карты есть подпись и непустая подсказка пустого состояния", () => {
  assert.equal(BAR_DEFINITIONS.length, 7);
  for (const definition of BAR_DEFINITIONS) {
    const copy = barCopy(definition.coordinate);
    assert.ok(copy.label.length > 2, `полоса ${definition.coordinate}: пустая подпись`);
    assert.ok(copy.empty.length > 15, `полоса ${definition.coordinate}: подсказка пустой полосы слишком короткая`);
    assert.equal(definition.label, copy.label, `полоса ${definition.coordinate}: подпись взята не из реестра`);
    assert.equal(definition.hint, copy.empty, `полоса ${definition.coordinate}: подсказка взята не из реестра`);
    assert.match(copy.empty, /Откроется/, `полоса ${definition.coordinate}: подсказка не обещает, чем откроется`);
  }
  // Полюса есть у всех полос, кроме категориальной «Что задевает».
  const withoutPoles = BAR_DEFINITIONS.filter((definition) => definition.poles === null);
  assert.equal(withoutPoles.length, 1);
  assert.equal(withoutPoles[0]!.coordinate, 8);
});

test("каждое краевое состояние из docs/11 имеет текст", () => {
  const edge = uiCopyGroup("EDGE");
  assert.ok(edge.length >= 9, `краевых состояний в реестре ${edge.length}, в маршруте девять`);
  for (const id of [
    "UI_EDGE_NO_DATE",
    "UI_EDGE_OPEN_TOO_SHORT",
    "UI_EDGE_CRISIS",
    "UI_EDGE_NO_NODE",
    "UI_EDGE_RETURN",
    "UI_EDGE_PAY_DECLINED",
    "UI_EDGE_ANSWER_CHANGED",
    "UI_EDGE_PAYMENT_FAILED",
    "UI_EDGE_GENERATION_FAILED",
  ]) {
    assert.ok(
      edge.some((entry) => entry.id === id),
      `нет текста краевого состояния ${id}`,
    );
  }

  // Таблица краевых состояний документа и группа реестра не должны разъезжаться.
  const doc = repoFile("docs/11-ui-page-spec.md");
  const section = doc.slice(doc.indexOf("## Краевые состояния"));
  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("---"))
    .slice(1);
  assert.equal(rows.length, 9, `в docs/11 краевых состояний ${rows.length}`);
});

test("микрокопия проходит реестр запрещённых формулировок", () => {
  const found = scanTexts(
    registry.map((entry) => entry.text),
    "интерфейс",
  );
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("в прототипе нет зашитых русских строк", () => {
  // Значения типов вопросов приходят из контента и сравниваются как машинные токены.
  const dataTokens = ["выбор", "шкала", "открытый"];
  const script = repoFile("prototype/app.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const inScript = [...script.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim())
    .filter((literal) => /[а-яёА-ЯЁ]/.test(literal))
    .filter((literal) => !dataTokens.includes(literal));
  assert.deepEqual(inScript, [], "prototype/app.js: русские строки должны приходить из content/ui-copy.md");

  const markup = repoFile("prototype/index.html").replace(/<!--[\s\S]*?-->/g, "");
  const inMarkup = [...markup.matchAll(/>([^<>]*)</g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((literal) => /[а-яёА-ЯЁ]/.test(literal));
  assert.deepEqual(inMarkup, [], "prototype/index.html: текст разметки задаётся через data-copy");
});

test("интерфейс не обращается к отсутствующему идентификатору", () => {
  const ids = new Set(uiCopyIds());
  const sources = ["prototype/app.js", "prototype/index.html", "engine/src/map.ts", "engine/src/offers.ts", "engine/src/index.ts", "server/src/http/page-shell.ts"];
  const used: string[] = [];
  for (const path of sources) {
    const source = repoFile(path);
    for (const match of source.matchAll(/uiCopy\(\s*"(UI_[A-Z0-9_]+)"|data-copy="(UI_[A-Z0-9_]+)"/g)) {
      used.push(match[1] ?? match[2] ?? "");
    }
  }
  assert.ok(used.length >= 25, `в интерфейсе найдено только ${used.length} обращений к реестру`);
  const missing = used.filter((id) => !ids.has(id));
  assert.deepEqual([...new Set(missing)], [], "интерфейс просит строки, которых нет в реестре");
});

test("в движке нет зашитых строк интерфейса", () => {
  const shown = ["Карта", "Маршрут", "Точно", "Пока предположение", "Следующая порция", "Темп", "Доведение"];
  for (const path of ["engine/src/map.ts", "engine/src/offers.ts", "engine/src/index.ts"]) {
    const source = repoFile(path);
    for (const literal of shown) {
      assert.ok(!source.includes(`"${literal}"`), `${path}: строка «${literal}» должна приходить из реестра`);
    }
  }
});

test("идентификаторы реестра не пересекаются с другими реестрами контента", () => {
  const ids = new Set(uiCopyIds());
  for (const disclaimer of rawExtraContent.disclaimers) {
    assert.ok(!ids.has(disclaimer.id), `${disclaimer.id} есть и в дисклеймерах, и в микрокопии`);
  }
  for (const crisis of rawExtraContent.crisis.texts) {
    assert.ok(!ids.has(crisis.id), `${crisis.id} есть и в кризисных текстах, и в микрокопии`);
  }
});
