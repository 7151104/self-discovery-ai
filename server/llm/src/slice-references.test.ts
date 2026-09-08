/**
 * E5-12: эталонные тексты платных срезов.
 *
 * Провайдера модели нет, эталон написан по промпту среза и по профилю,
 * посчитанному движком. Тест закрывает приёмку: валидатор не отклоняет ни один
 * эталон; если появился новый срез в `SCORED_SLICES` или файл в `content/slices/`,
 * а эталона нет — падаем. Совместимость в первый релиз не входит (вопрос 10) и
 * файла доборов у неё нет, поэтому эталона она не требует.
 */

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { reportTypeOfSlice, readRepoFile } from "./content.js";
import {
  applySlice,
  checkThreshold,
  buildFullMapProfile,
  fullMap,
  fullMapQuestions,
  fullMapThreshold,
  rawContent,
  SCORED_SLICES,
  type BankAnswers,
  type LadderAnswers,
  type Profile,
  type ScaleAnswer,
  type SliceAnswers,
  type SliceTextFindings,
} from "./engine.js";
import { DEMO_ANSWERS } from "./fixtures.js";
import { buildSlicePrompt, instructionOf } from "./prompt.js";
import { findingsForSlice, sliceTaskOf } from "./slice.js";
import { describeViolation, validateText } from "./validator.js";
import { demoProfile } from "../../../engine/dist/slice-fixtures.js";

const SLICES_DIR = fileURLToPath(new URL("../../../content/slices/", import.meta.url));

const ANSWERS_FILE = "examples/demo-slice-answers.md";
const BANK_FILE = "examples/demo-person-answers.md";

/** Сюжет и задача периода — синтез открытых; движок текст не разбирает. */
const SYNTHESIS = {
  storyline: { value: "тащит один и бросает у финиша", code: "solo_then_drop", confidence: "medium" as const },
  periodTask: { value: "выход в видимость", code: "visibility", confidence: "medium" as const },
};

const sliceIdOf = (filename: string): string => {
  const match = /^# Срез:\s*`([^`]+)`/m.exec(readRepoFile(`content/slices/${filename}`));
  assert.ok(match, `${filename}: в шапке нет идентификатора среза`);
  return match[1]!;
};

const examplePath = (filename: string): string => `examples/demo-slice-${filename.replace(/\.md$/, "")}.md`;

/** Тело отчёта: служебный заголовок до первого раздела не текст о человеке. */
const reportBody = (source: string, file: string): string => {
  const at = source.search(/^## /m);
  assert.ok(at >= 0, `${file}: нет разделов отчёта`);
  return source.slice(at).trim();
};

function parseJsonSections(source: string, heading: RegExp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pattern = new RegExp(`^## ${heading.source}\\n\\n\`\`\`json\\n([\\s\\S]*?)\`\`\``, "gm");
  for (const match of source.matchAll(pattern)) {
    out[match[1]!] = JSON.parse(match[2]!);
  }
  return out;
}

const answersFile = readRepoFile(ANSWERS_FILE);
const SLICE_ANSWERS = parseJsonSections(answersFile, /(slice_\w+)/) as Record<string, SliceAnswers>;
const SLICE_FINDINGS = parseJsonSections(answersFile, /findings (slice_\w+)/) as Record<string, SliceTextFindings>;

const bankFile = readRepoFile(BANK_FILE);

const bankClosed = ((): BankAnswers => {
  const answers: BankAnswers = {};
  for (const line of bankFile.split("\n")) {
    const row = /^\|\s*(\d+)\s*\|\s*([A-G]|[1-5])\s*\|$/.exec(line.trim());
    if (!row) continue;
    const value = row[2] ?? "";
    answers[`Q${row[1]}`] = /^[1-5]$/.test(value) ? (Number(value) as ScaleAnswer) : value;
  }
  return answers;
})();

const openFromBankFile = (id: "О2" | "О3"): string => {
  const match = new RegExp(`\\*\\*${id}:\\*\\*\\s*(.+)`).exec(bankFile);
  assert.ok(match, `${BANK_FILE}: нет открытого ${id}`);
  return match[1]!.trim();
};

function requiredReferences(): Map<string, string> {
  const required = new Map<string, string>();
  const files = readdirSync(SLICES_DIR).filter((name) => name.endsWith(".md") && name !== "README.md");
  assert.ok(files.includes("full-map.md"), "в content/slices нет full-map.md");

  for (const filename of files) {
    required.set(sliceIdOf(filename), examplePath(filename));
  }

  for (const slice of SCORED_SLICES) {
    const file = rawContent.slices.find((item) => item.id === slice)?.file;
    assert.ok(file, `${slice}: нет файла доборов в content/slices`);
    const path = examplePath(file);
    const already = required.get(slice);
    if (already) assert.equal(already, path, `${slice}: эталон из файла среза и из SCORED_SLICES разошлись`);
    else required.set(slice, path);
  }

  assert.ok(!required.has("slice_compatibility"), "совместимость в первый релиз не входит и эталона не требует");
  return required;
}

const findingsOf = (slice: string, answers: SliceAnswers): SliceTextFindings => ({
  ...findingsForSlice(slice, answers),
  ...(SLICE_FINDINGS[slice] ?? {}),
});

const profileBefore = (slice: string): Profile =>
  slice === "slice_decision_moment"
    ? applySlice("slice_decisions", demoProfile(), SLICE_ANSWERS.slice_decisions ?? {})
    : demoProfile();

test("на каждый срез из SCORED_SLICES и content/slices/ есть эталон", () => {
  const required = requiredReferences();
  assert.ok(required.size >= SCORED_SLICES.length + 1, `эталонов собрано только ${required.size}`);

  const missing: string[] = [];
  for (const [slice, path] of required) {
    try {
      readRepoFile(path);
    } catch {
      missing.push(`${slice} → ${path}`);
    }
  }
  assert.deepEqual(missing, [], "появился срез без эталонного текста");
});

test("вход каждого эталона считается движком, порог берётся", () => {
  const required = requiredReferences();

  for (const slice of SCORED_SLICES) {
    const answers = SLICE_ANSWERS[slice];
    assert.ok(answers, `${ANSWERS_FILE}: нет ответов ${slice}`);
    const before = profileBefore(slice);
    const findings = findingsOf(slice, answers);
    const after = applySlice(slice, before, answers, findings);
    const threshold = checkThreshold(slice, after, answers, findings, before);
    assert.equal(
      threshold.passed,
      true,
      `${slice}: порог не взят — ${threshold.missing.join(" · ")}`,
    );
    const prompt = buildSlicePrompt(sliceTaskOf(slice, before, answers, { before, findings }));
    assert.ok(instructionOf(prompt).length > 0, `${slice}: промпт не собрался`);
  }

  const remainder: BankAnswers = {};
  for (const question of fullMapQuestions()) {
    remainder[question.id] = question.type === "открытый" ? openFromBankFile(question.id as "О2" | "О3") : bankClosed[question.id];
  }
  const input = { ladder: DEMO_ANSWERS as LadderAnswers, bank: remainder };
  const profile = buildFullMapProfile(input, SYNTHESIS);
  const threshold = fullMapThreshold(input, profile, SYNTHESIS);
  assert.equal(threshold.passed, true, `slice_full_map: порог не взят — ${threshold.missing.join(" · ")}`);
  assert.equal(required.get("slice_full_map"), examplePath(fullMap().file));
});

test("валидатор не отклоняет ни один эталон среза", () => {
  const required = requiredReferences();
  const rejected: string[] = [];

  for (const [slice, path] of required) {
    const body = reportBody(readRepoFile(path), path);
    const type = reportTypeOfSlice(slice);
    const verdict = validateText(body, { type });
    if (!verdict.ok) {
      rejected.push(
        `${slice} (${type}): ${verdict.violations.map(describeViolation).join("; ")}`,
      );
    }
  }

  assert.deepEqual(rejected, [], "ложное отклонение эталона дороже пропуска: такой валидатор выключат");
});
