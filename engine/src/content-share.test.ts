/**
 * Публичный режим и шеринг (E5-10).
 *
 * Две проверки важнее тона. Первая: публичная страница не обещает того, чего не
 * показывает, — сервер отдаёт карту, фразу и первые два блока (E3-08), и микрокопия
 * говорит ровно про них. Вторая: публичный вид живой, и это сказано обеим сторонам —
 * тому, кто делится, и тому, кто открыл ссылку (`docs/14-state.md`, вопрос 22).
 *
 * Подписи картинки проверяются отдельно: в них стоят реквизиты основателя, и подпись с
 * выдуманным доменом уходит в чужие чаты навсегда.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { shareCaption, shareCaptionIds, shareCaptionRaw, shareFormats, shareLayers, shareReady } from "./share.js";
import { uiCopy, uiCopyGroup } from "./ui-copy.js";
import { scanTexts, describeHit } from "./forbidden.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const shareStrings = uiCopyGroup("SHARE");
const publicStrings = uiCopyGroup("PUBLIC");
const captions = shareCaptionIds().map((id) => shareCaptionRaw(id));
const allTexts = [...shareStrings, ...publicStrings].map((entry) => entry.text);

test("картинка описана слоями, подписями и двумя форматами", () => {
  assert.deepEqual(shareLayers().map((layer) => layer.name), ["Крючок", "Карта", "Подпись"]);
  for (const layer of shareLayers()) {
    assert.ok(layer.content.length > 5, `${layer.name}: не сказано, что в слое`);
    assert.ok(layer.source.length > 5, `${layer.name}: не сказано, откуда слой берётся`);
  }

  assert.deepEqual(shareCaptionIds(), ["SHARE_IMAGE_MAP_CAPTION", "SHARE_IMAGE_SIGNATURE", "SHARE_IMAGE_ALT"]);
  for (const caption of captions) {
    assert.ok(caption.where.length > 5, `${caption.id}: не сказано, где подпись стоит`);
  }

  const formats = shareFormats();
  assert.equal(formats.length, 2, "форматов должно быть два: превью ссылки и вертикальная картинка");
  assert.ok(formats.some((format) => format.width > format.height), "нет горизонтального формата для превью");
  assert.ok(formats.some((format) => format.height > format.width), "нет вертикального формата");
});

test("имя продукта и домен — подстановки из реестра юридических текстов", () => {
  const listed = new Set(
    [...repoFile("content/legal/README.md").matchAll(/`\{\{([А-ЯЁA-Z_]+)\}\}`/g)].map((match) => match[1]!),
  );
  const used = captions.flatMap((caption) => caption.placeholders);
  assert.ok(used.includes("НАЗВАНИЕ_ПРОДУКТА") && used.includes("ДОМЕН"), "в подписях нет имени продукта и домена");
  for (const name of used) {
    assert.ok(listed.has(name), `{{${name}}} не описана в content/legal/README.md`);
  }

  const source = repoFile("content/share.md");
  const outsideBraces = source.replace(/\{\{[^}]*\}\}/g, " ");
  assert.ok(
    !/[a-zа-яё-]+\.(ru|рф|com|io|app)\b/i.test(outsideBraces.replace(/мой-сервис\.ру/g, " ")),
    "в файле стоит правдоподобная заглушка домена: она разъедется с настоящим адресом",
  );
});

test("подпись собирается только с заполненными реквизитами", () => {
  const identity = { НАЗВАНИЕ_ПРОДУКТА: "Имя", ДОМЕН: "домен" };
  assert.equal(shareCaption("SHARE_IMAGE_SIGNATURE", identity), "Имя · домен");
  assert.ok(!/[{}]/.test(shareCaption("SHARE_IMAGE_ALT", identity)), "в подписи остались скобки");
  assert.equal(shareCaption("SHARE_IMAGE_MAP_CAPTION"), "Семь полос из шестнадцати");

  assert.throws(
    () => shareCaption("SHARE_IMAGE_SIGNATURE", { ДОМЕН: "домен" }),
    /\{\{НАЗВАНИЕ_ПРОДУКТА\}\} не заполнен/,
  );
  assert.throws(() => shareCaptionRaw("SHARE_IMAGE_QR"), /нет подписи SHARE_IMAGE_QR/);

  assert.equal(shareReady(identity), true);
  assert.equal(shareReady({ ДОМЕН: "домен" }), false, "картинка собралась без имени продукта");
});

test("на картинке нет ответов, разбора, имени человека и обещаний точности", () => {
  const onImage = [...shareLayers().map((layer) => `${layer.name} ${layer.content}`), ...captions.map((c) => c.text)];
  for (const text of onImage) {
    assert.ok(!/ответ|разбор|балл|результат/i.test(text), `на картинку попало лишнее: ${text}`);
    assert.ok(!/(?:^|[^а-яё])(имя|дата рождения) человека/i.test(text), `на картинке личные данные: ${text}`);
    assert.ok(!/точн|полн(ая|ую) карт/i.test(text), `картинка обещает точность: ${text}`);
  }

  const source = repoFile("content/share.md");
  assert.match(source, /## Чего на картинке нет/, "не записано, чего на картинке нет");
  assert.ok(
    /Приглашение живёт на публичной странице/.test(source),
    "не сказано, почему призыва к действию на картинке нет",
  );
});

test("публичная страница обещает только то, что отдаёт сервер", () => {
  const ids = publicStrings.map((entry) => entry.id);
  for (const id of ["UI_PUBLIC_TITLE", "UI_PUBLIC_LIVE", "UI_PUBLIC_HIDDEN", "UI_PUBLIC_EMPTY", "UI_PUBLIC_REVOKED"]) {
    assert.ok(ids.includes(id), `в группе PUBLIC нет строки ${id}`);
  }

  for (const entry of publicStrings) {
    assert.ok(
      !/(узел|сюжет|срез|весь разбор|разбор целиком)/i.test(entry.text),
      `${entry.id}: публичная страница называет то, чего на ней нет`,
    );
  }

  assert.match(uiCopy("UI_PUBLIC_HIDDEN"), /карт/i);
  assert.ok(
    /закрыт/i.test(uiCopy("UI_PUBLIC_HIDDEN")),
    "не сказано, что остальное осталось на закрытой части страницы",
  );
  assert.equal(uiCopy("UI_PUBLIC_TITLE", { имя: "Игорь" }), "Страница Игорь");
});

test("живой публичный вид сказан обеим сторонам", () => {
  const owner = uiCopy("UI_SHARE_LIVE");
  assert.ok(/сейчас/i.test(owner), "хозяину страницы не сказано, что по ссылке видно текущее состояние");
  assert.ok(/(изменишь|поменя|правк)/i.test(owner), "не сказано, что позднейшая правка меняет и то, что видно");

  const visitor = uiCopy("UI_PUBLIC_LIVE", { имя: "Игорь" });
  assert.ok(/сейчас/i.test(visitor), "постороннему не сказано, что он видит состояние на сейчас");

  assert.match(uiCopy("UI_SHARE_LINK", { ссылка: "адрес" }), /адрес/);
  assert.ok(/никогда|не откроется/i.test(uiCopy("UI_SHARE_CLOSED")), "не сказано, что старая ссылка мертва");
  assert.match(uiCopy("UI_PUBLIC_REVOKED"), /не открывается/);
  assert.match(repoFile("content/ui-copy.md"), /вопрос 22/, "в реестре нет ссылки на нерешённый вопрос о живом виде");
});

test("«сделать свою» приглашает, не продавая", () => {
  const own = uiCopy("UI_PUBLIC_MAKE_OWN");
  const hint = uiCopy("UI_PUBLIC_MAKE_OWN_HINT");
  assert.ok(own.length < 20, "кнопка «сделать свою» переросла в предложение");
  assert.ok(/(?:^|[^а-яё])не влияет/i.test(hint), "не сказано, что своя страница не меняет чужую");
  for (const text of [own, hint]) {
    assert.ok(!/(узнай|пройди|бесплатно|всего|скорее|попробуй)/i.test(text), `продажа в приглашении: ${text}`);
  }
});

test("слова «тест» нет ни в микрокопии шеринга, ни на картинке, ни в описании", () => {
  for (const text of [...allTexts, ...captions.map((caption) => caption.text)]) {
    assert.ok(!/(?:^|[^а-яё])тест/i.test(text), `продукт назван тестом: ${text}`);
    assert.ok(!/(?:^|[^а-яё])(вы|вас|вам|ваш)(?:[^а-яё]|$)/i.test(text), `обращение не на «ты»: ${text}`);
  }

  // Раздел запретов слово «тест» называет — этим он и работает; остальной файл его не знает.
  const source = repoFile("content/share.md");
  const bans = source.indexOf("## Чего на картинке нет");
  assert.ok(bans > 0, "в файле нет раздела запретов");
  assert.ok(!/(?:^|[^а-яё])тест/i.test(source.slice(0, bans)), "продукт назван тестом в описании картинки");
  assert.match(source.slice(bans), /Слова «тест»/, "запрет на слово «тест» не записан");
});

test("тексты публичного режима и шеринга проходят реестр запрещённых формулировок", () => {
  const texts = [...allTexts, ...captions.map((caption) => caption.text), ...shareLayers().map((l) => l.content)];
  const found = scanTexts(texts, "интерфейс");
  assert.deepEqual(
    found.map(({ text, hit }) => describeHit(text, hit)),
    [],
  );
});

test("подписи картинки и реестр микрокопии не повторяют друг друга", () => {
  const registry = new Set([...shareStrings, ...publicStrings].map((entry) => entry.text));
  for (const caption of captions) {
    assert.ok(!registry.has(caption.text), `${caption.id}: та же строка лежит в двух источниках правды`);
  }
  const rows = repoFile("content/ui-copy.md")
    .split("\n")
    .filter((line) => line.startsWith("| `UI_"));
  for (const row of rows) {
    assert.ok(
      !/\{\{/.test(row),
      `в реестре микрокопии появился реквизит: они живут в content/share.md и content/legal/ — ${row}`,
    );
  }
});
