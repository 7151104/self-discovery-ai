/**
 * Реестр микрокопии на клиенте: та же строка, что у движка, и то же поведение
 * на ошибке.
 *
 * Смысл теста — не дать двум реализациям чтения разъехаться. Данные у них из
 * одного источника, но функции разные, и молчаливое расхождение было бы
 * худшим из возможных: на экране появился бы текст, которого нет в контенте.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { copy, copyGroup, copyIds, hasCopy } from "./copy.js";
import { repoRoot } from "./paths.js";

/**
 * Движок подключается только здесь и только в тесте: в браузер он не уезжает.
 * Путь считается от корня репозитория, потому что собранный тест лежит глубже
 * своего исходника, а движок — снаружи `web/`.
 */
const engine = async <T>(path: string): Promise<T> =>
  (await import(pathToFileURL(join(repoRoot, path)).href)) as T;

const { rawExtraContent } = await engine<typeof import("../../engine/dist/generated/content-extra.js")>(
  "engine/dist/generated/content-extra.js",
);
const { uiCopy } = await engine<typeof import("../../engine/dist/ui-copy.js")>("engine/dist/ui-copy.js");

/** Подстановки в реестре именуются по-русски; значение для теста роли не играет. */
const fill = (params: readonly string[]): Record<string, string> =>
  Object.fromEntries(params.map((name) => [name, `‹${name}›`]));

test("каждая строка реестра читается клиентом так же, как движком", () => {
  const shown = rawExtraContent.uiCopy.filter((entry) => entry.group !== "DEV");
  assert.ok(shown.length >= 100, `в реестре только ${shown.length} строк для продукта`);

  for (const entry of shown) {
    const params = fill(entry.params);
    assert.equal(copy(entry.id, params), uiCopy(entry.id, params), `${entry.id}: тексты разошлись`);
  }
  assert.deepEqual(copyIds().sort(), shown.map((entry) => entry.id).sort());
});

test("служебная панель прототипа в браузер не уезжает", () => {
  const dev = rawExtraContent.uiCopy.filter((entry) => entry.group === "DEV");
  assert.ok(dev.length > 0, "группа DEV пропала из реестра — тест потерял смысл");
  for (const entry of dev) assert.equal(hasCopy(entry.id), false, `${entry.id}: строка прототипа в клиенте`);
});

test("неизвестный идентификатор и забытая подстановка падают", () => {
  assert.throws(() => copy("UI_НЕТ_ТАКОЙ_СТРОКИ"), /нет строки/);
  assert.throws(() => copy("UI_PAY_BUTTON"), /не передана подстановка \{цена\}/);
  assert.throws(() => copy("UI_ROUTE_TITLE", { цена: 1 }), /подстановки \{цена\} в тексте нет/);
});

test("подстановка встаёт в текст", () => {
  assert.equal(copy("UI_PAY_BUTTON", { цена: 590 }), "Открыть — 590 ₽");
  assert.equal(copy("UI_MAP_ZONE_NEAR", { полюс: "импульсы" }), "перевес — импульсы");
});

test("группа читается целиком и в порядке файла", () => {
  const wait = copyGroup("WAIT").map((item) => item.id);
  assert.deepEqual(
    wait,
    rawExtraContent.uiCopy.filter((entry) => entry.group === "WAIT").map((entry) => entry.id),
  );
});
