/**
 * Правила слоя читаются из markdown, а не из строк в коде.
 *
 * Три раздела, три источника: объём по типу отчёта — `docs/06-report-structure.md`,
 * маркеры регистров и слова отрицания — `content/forbidden.md`, потолок confidence
 * координаты — `content/scoring-rules.md`. Тест сверяет разобранные значения с
 * текстом файлов: расхождение здесь означает, что код и контент разъехались.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { assemblerPrompt, ladderCapOf, negationWords, overlaySlices, readRepoFile, registerMarkers, reportTypeOfSlice, reportTypes, sliceOverlay, volumeOf } from "./content.js";

test("объём разобран по каждому машинному типу отчёта из документа", () => {
  const document = readRepoFile("docs/06-report-structure.md");
  const types = reportTypes();

  assert.ok(types.includes("финал_лестницы"));
  assert.ok(types.includes("бесплатный_полный"));
  assert.ok(types.length >= 7, `типов отчёта разобрано только ${types.length}`);

  for (const type of types) {
    const range = volumeOf(type);
    assert.ok(document.includes(`\`${type}\``), `тип «${type}» взялся не из документа`);
    assert.ok(document.includes(`${range.min}–${range.max}`), `объём типа «${type}» взялся не из документа`);
  }

  assert.deepEqual(volumeOf("финал_лестницы"), { min: 250, max: 350 });
  assert.deepEqual(volumeOf("бесплатный_полный"), { min: 900, max: 1200 });
  assert.deepEqual(volumeOf("срез_узел"), { min: 800, max: 1200 });
  assert.deepEqual(volumeOf("полная_карта"), { min: 1500, max: 2500 });
  assert.throws(() => volumeOf("отчёт_которого_нет"), /не описан/);
});

test("маркеры регистров и слова отрицания взяты из реестра запретов", () => {
  const registry = readRepoFile("content/forbidden.md");
  const markers = registerMarkers();

  for (const marker of [...markers.medium, ...markers.low]) {
    assert.ok(registry.includes(`\`${marker}\``), `формулировка «${marker}» взялась не из реестра`);
  }
  assert.ok(markers.medium.length >= 4, "у регистра medium в реестре помечено меньше формулировок, чем было");
  assert.ok(markers.low.length >= 1);

  const negations = negationWords();
  assert.deepEqual(negations, ["не", "ни", "нет", "без", "ничего"]);
  for (const word of negations) assert.ok(registry.includes(`\`${word}\``));
});

test("в надстройке каждого среза есть блок, ассемблер читается из файла", () => {
  const assembler = assemblerPrompt();
  assert.ok(assembler.includes("РОЛЬ"));
  assert.ok(assembler.includes("РЕГИСТРЫ"));
  for (const slice of overlaySlices()) {
    const overlay = sliceOverlay(slice);
    assert.ok(overlay.length > 80, `${slice}: надстройка слишком короткая`);
  }
  assert.equal(reportTypeOfSlice("slice_node_finish"), "срез_узел");
  assert.equal(reportTypeOfSlice("slice_work"), "срез_работа");
  assert.equal(reportTypeOfSlice("slice_full_map"), "полная_карта");
  assert.throws(() => reportTypeOfSlice("slice_compatibility"), /нет машинного типа/);
});

test("потолок confidence координаты 15 — из правил скоринга", () => {
  const rules = readRepoFile("content/scoring-rules.md");
  assert.ok(rules.includes("| 15 | L12 (открытый, только LLM) | medium |"), "строка правила изменилась");

  assert.equal(ladderCapOf(15), "medium", "сюжет из открытого ответа выше medium в лестнице не поднимается");
  assert.equal(ladderCapOf(11), "high");
  assert.equal(ladderCapOf(1), null, "координату, которую лестница не закрывает, потолок не описывает");
});
