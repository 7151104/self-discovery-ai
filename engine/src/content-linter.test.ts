/**
 * E11-06: линтер контента.
 *
 * Два свойства важнее остального. Первое: на всём текущем контенте нет ни одного
 * отказа — ложное срабатывание выключает линтер. Второе: на заведомо плохом
 * тексте срабатывает каждая группа, чьё совпадение обязано быть отказом.
 * Предупреждения (подозрения реестра) команду не роняют и здесь не считаются
 * отказом.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { rawExtraContent } from "./generated/content-extra.js";
import {
  collectCorpus,
  formatLintReport,
  lintCorpus,
  lintSliceVolumeDeclarations,
  lintSnippet,
  lookupVolume,
  rejectGroups,
  sampleFor,
  sliceReportType,
} from "./content-linter.js";
import { wordCount } from "./words.js";

const { groups } = rawExtraContent.forbidden;

test("объём lookup-блока читается из документов, а не задан в коде", () => {
  const range = lookupVolume();
  assert.equal(range.min, 80);
  assert.equal(range.max, 150);
});

test("корпус покрывает все человекочитаемые области задачи", () => {
  const corpus = collectCorpus();
  assert.ok(corpus.length > 200, `в корпусе только ${corpus.length} текстов`);

  const files = new Set(corpus.map((entry) => entry.file));
  const required = [
    "content/step1-branches.md",
    "content/step2-branches.md",
    "content/step3-contradictions.md",
    "content/step0-welcome.md",
    "content/doors.md",
    "content/ui-copy.md",
    "content/crisis.md",
    "content/emails.md",
    "content/share.md",
    "content/legal/disclaimers.md",
    "content/legal/privacy-policy.md",
    "content/legal/consent.md",
    "content/legal/offer.md",
    "examples/demo-report-output.md",
  ];
  for (const file of required) {
    assert.ok(files.has(file), `в корпусе нет ${file}`);
  }
  assert.ok(
    [...files].some((file) => file.startsWith("content/slices/") && file.endsWith(".md")),
    "в корпусе нет промежуточных блоков и экранов оплаты срезов",
  );

  const scopes = new Set(corpus.map((entry) => entry.scope));
  for (const scope of ["разбор", "вопросы", "интерфейс"] as const) {
    assert.ok(scopes.has(scope), `нет текстов области ${scope}`);
  }
});

test("текущий контент проходит линтер без отказов", () => {
  const report = lintCorpus();
  const dump = report.rejects.map((item) => `${item.file} · ${item.place} · ${item.group} · ${item.match}`).join("\n");
  assert.equal(report.rejects.length, 0, `ложные отказы:\n${dump}`);
  assert.ok(report.entries > 200, `проверено только ${report.entries} текстов`);
});

test("на заведомо плохом тексте срабатывает каждая группа отказа", () => {
  const ids = rejectGroups();
  assert.ok(ids.length >= 10, `групп отказа только ${ids.length}`);

  for (const id of ids) {
    const group = groups.find((item) => item.id === id)!;
    const form = group.entries[0]!.forms[0]!;
    const findings = lintSnippet(sampleFor(form), group.scopes[0]!);
    const hit = findings.find((item) => item.kind === "отказ" && item.group === id);
    assert.ok(hit, `${id}: образец «${sampleFor(form)}» не дал отказа этой группы`);
  }
});

test("подозрение не роняет проверку", () => {
  const findings = lintSnippet("Многие люди в глубине души этого не замечают", "разбор");
  assert.equal(
    findings.filter((item) => item.kind === "отказ").length,
    0,
    "подозрение Barnum стало отказом",
  );
  assert.ok(
    findings.some((item) => item.kind === "предупреждение" && item.group === "FORBIDDEN_BARNUM"),
    "Barnum-шаблон не показан даже предупреждением",
  );
});

test("отрицание снимает контекстный запрет и в линтере", () => {
  const excused = lintSnippet("Это не является диагнозом и не заменяет специалиста.", "интерфейс");
  assert.equal(
    excused.filter((item) => item.kind === "отказ").length,
    0,
    "отрицание не сняло контекстный запрет",
  );
  const bare = lintSnippet("Здесь ставится диагноз.", "интерфейс");
  assert.ok(
    bare.some((item) => item.kind === "отказ" && item.group === "FORBIDDEN_MEDICAL"),
    "утверждение без отрицания обязано быть отказом",
  );
});

test("абзац длиннее потолка lookup-блока — отказ по объёму", () => {
  const range = lookupVolume();
  const long = Array.from({ length: range.max + 1 }, (_value, index) => `слово${index + 1}`).join(" ");
  const findings = lintSnippet(long, "разбор", {
    max: range.max,
    source: "блок ступеней 1–3, docs/06 и docs/11",
  });
  assert.ok(
    findings.some((item) => item.kind === "отказ" && item.group === "объём"),
    "перебор слов не дал отказа",
  );
  assert.equal(wordCount(long), range.max + 1);
});

const repoText = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

test("объём в шапке каждого среза совпадает с таблицей docs/06", () => {
  assert.equal(sliceReportType("slice_work"), "срез_работа");
  assert.equal(sliceReportType("slice_relationships"), "срез_отношения");
  assert.equal(sliceReportType("slice_decision_moment"), "разбор_решения");
  assert.equal(sliceReportType("slice_node_finish"), "срез_узел");
  assert.equal(sliceReportType("slice_full_map"), "полная_карта");
  assert.equal(sliceReportType("slice_compatibility"), null);

  const findings = lintSliceVolumeDeclarations();
  assert.deepEqual(
    findings,
    [],
    findings.map((item) => `${item.file}: ${item.reason}`).join("\n"),
  );
});

test("подмена числа в шапке среза — отказ линтера, не предупреждение", () => {
  const findings = lintSliceVolumeDeclarations((path) => {
    const text = repoText(path);
    if (path === "content/slices/work.md") return text.replace("1200–1500", "800–1200");
    return text;
  });
  const hit = findings.find((item) => item.file === "content/slices/work.md" && item.kind === "отказ");
  assert.ok(hit, "подмена объёма в slice_work не дала отказа");
  assert.equal(hit!.kind, "отказ");
  assert.equal(hit!.group, "объём");
  assert.match(hit!.reason, /slice_work/);
  assert.match(hit!.reason, /800–1200/);
  assert.match(hit!.reason, /1200–1500/);
  assert.match(hit!.reason, /docs\/06/);
  assert.equal(
    findings.some((item) => item.file === "content/slices/work.md" && item.kind === "предупреждение"),
    false,
    "расхождение объёма ушло в предупреждение",
  );
});

test("перенос строки не отрывает отрицание от перечня в юридических текстах", () => {
  const wrapped =
    "Что не входит и за что мы не берём денег: консультация, переписка со специалистом,\nпсихологическая или медицинская помощь, сопровождение.";
  const findings = lintSnippet(wrapped, "интерфейс");
  assert.equal(
    findings.filter((item) => item.kind === "отказ").length,
    0,
    findings.map((item) => `${item.group} · ${item.match}`).join("; "),
  );
});

test("отчёт линтера по-русски называет файл, место, группу и действие", () => {
  const findings = lintSnippet(sampleFor("MBTI"), "разбор");
  const report = formatLintReport({
    entries: 1,
    rejects: findings.filter((item) => item.kind === "отказ"),
    warnings: findings.filter((item) => item.kind === "предупреждение"),
  });
  assert.match(report, /отказ/);
  assert.match(report, /FORBIDDEN_METHODS/);
  assert.match(report, /MBTI/);
  assert.match(report, /что делать:/);
  assert.match(report, /образец/);
});
