/**
 * Линтер контента (E11-06).
 *
 * Проверяет тексты, которые видит человек, и сохранённые эталоны. Реестр запретов
 * один — `content/forbidden.md`; сопоставление — `forbidden.ts`, формы речи —
 * `forms.ts`. Второго списка слов здесь нет.
 *
 * Отказ и предупреждение различаются так же, как в валидаторе выхода модели:
 * жёсткий и по контексту — отказ (команда падает), подозрение — предупреждение
 * (команда не падает). Barnum из подозрения в отказ не поднимается: линтер
 * показывает место человеку, а не режет готовый контент.
 *
 * Объёмы читаются из `docs/06-report-structure.md` и сверяются с
 * `docs/11-ui-page-spec.md`. На отдельный абзац lookup действует потолок блока:
 * один абзац не может быть длиннее всего блока. Нижняя граница 80 слов — на
 * собранный блок из трёх абзацев, её здесь не проверяем: линтер видит абзацы
 * по отдельности.
 */

import { readFileSync } from "node:fs";

import { rawContent } from "./generated/content.js";
import { rawExtraContent } from "./generated/content-extra.js";
import { scanText, type ForbiddenHit } from "./forbidden.js";
import type { ForbiddenDegree, ForbiddenScope } from "./content-extra-types.js";
import { wordCount } from "./words.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Диапазон слов, прочитанный из документов, а не заданный в коде. */
export interface WordRange {
  min: number;
  max: number;
}

export interface CorpusEntry {
  file: string;
  /** Человекочитаемое место внутри файла: идентификатор, пара, заголовок. */
  place: string;
  scope: ForbiddenScope;
  text: string;
  /**
   * Потолок (и необязательный пол) объёма. Пол задаём только там, где документ
   * говорит о целом готовом тексте, а не об абзаце lookup.
   */
  volume?: { min?: number; max: number; source: string };
}

export type FindingKind = "отказ" | "предупреждение";

export interface Finding {
  kind: FindingKind;
  file: string;
  place: string;
  /** Идентификатор группы реестра или `объём`. */
  group: string;
  form: string;
  match: string;
  reason: string;
  action: string;
}

export interface LintReport {
  entries: number;
  rejects: Finding[];
  warnings: Finding[];
}

const extra = rawExtraContent;
const { groups } = extra.forbidden;

const ALL_DEGREES: ForbiddenDegree[] = ["жёсткий", "по контексту", "подозрение"];

const groupTitle = (id: string): string => groups.find((group) => group.id === id)?.title ?? id;

const groupDegree = (id: string): ForbiddenDegree | null =>
  groups.find((group) => group.id === id)?.degree ?? null;

/** Группы, чьё совпадение обязано быть отказом: всё, кроме подозрений. */
export const rejectGroups = (): string[] =>
  groups.filter((group) => group.degree !== "подозрение").map((group) => group.id);

let lookupVolumeCache: WordRange | null = null;

/** Объём lookup-блока ступеней 1–3: одно место в docs/06, сверка с docs/11. */
export function lookupVolume(): WordRange {
  if (lookupVolumeCache) return lookupVolumeCache;
  const doc6 = repoFile("docs/06-report-structure.md");
  const from = doc6.indexOf("## Объём");
  if (from < 0) throw new Error("docs/06-report-structure.md: нет раздела «Объём»");
  const row = doc6
    .slice(from)
    .split("\n")
    .find((line) => /Блок ступени 1/.test(line) && /lookup/i.test(line));
  const range = /(\d+)\s*[–—-]\s*(\d+)/.exec(row ?? "");
  if (!range) throw new Error("docs/06-report-structure.md: в строке lookup-блока нет диапазона слов");
  const min = Number(range[1]);
  const max = Number(range[2]);
  if (!(min > 0 && max > min)) throw new Error("docs/06-report-structure.md: диапазон lookup-блока бессмыслен");

  const doc11 = repoFile("docs/11-ui-page-spec.md");
  const mentioned = doc11.includes(`${min}–${max}`) || doc11.includes(`${min}-${max}`);
  if (!mentioned) {
    throw new Error(
      `docs/11-ui-page-spec.md: нет объёма ${min}–${max} слов, который стоит в docs/06`,
    );
  }
  lookupVolumeCache = { min, max };
  return lookupVolumeCache;
}

const lookupCeiling = (source: string): CorpusEntry["volume"] => {
  const range = lookupVolume();
  return { max: range.max, source };
};

function add(
  out: CorpusEntry[],
  file: string,
  place: string,
  scope: ForbiddenScope,
  text: string,
  volume?: CorpusEntry["volume"],
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  out.push({ file, place, scope, text: trimmed, volume });
}

const LEGAL_FILES = [
  "content/legal/privacy-policy.md",
  "content/legal/consent.md",
  "content/legal/offer.md",
] as const;

function collectAnalysis(out: CorpusEntry[]): void {
  const volume = lookupCeiling("блок ступеней 1–3, docs/06 и docs/11");
  const step1 = "content/step1-branches.md";
  const step2 = "content/step2-branches.md";
  const step3 = "content/step3-contradictions.md";
  const step0 = "content/step0-welcome.md";

  for (const [question, branches] of Object.entries(rawContent.step1.branches)) {
    for (const [key, branch] of Object.entries(branches)) {
      add(out, step1, `ветка ${question} / ${key}`, "разбор", branch.text, volume);
    }
  }
  for (const row of rawContent.step1.matrix) {
    add(out, step1, `сшивка ${row.first} × ${row.second}`, "разбор", row.text, volume);
  }

  for (const [question, branches] of Object.entries(rawContent.step2.branches)) {
    for (const [key, branch] of Object.entries(branches)) {
      add(out, step2, `ветка ${question} / ${key}`, "разбор", branch.text, volume);
    }
  }
  for (const [question, branches] of Object.entries(rawContent.step2.scales)) {
    for (const branch of branches) {
      add(out, step2, `шкала ${question} / ${branch.from}–${branch.to}`, "разбор", branch.text, volume);
    }
  }
  for (const row of rawContent.step2.matrix) {
    add(out, step2, `сшивка ${row.first} × ${row.range.from}–${row.range.to}`, "разбор", row.text, volume);
  }

  for (const node of rawContent.step3.nodes) {
    add(out, step3, `узел ${node.id}`, "разбор", node.text, volume);
  }

  for (const metaphor of rawContent.step0.metaphors) {
    add(out, step0, `метафора ${metaphor.season} — ${metaphor.theme}`, "разбор", metaphor.text, volume);
  }

  for (const interlude of extra.interludes) {
    const file = `content/slices/${interlude.file}`;
    add(out, file, `промежуточный блок · заголовок`, "интерфейс", interlude.heading);
    for (const pair of interlude.pairs) {
      add(
        out,
        file,
        `промежуточный блок ${pair.first} × ${pair.second}`,
        "разбор",
        pair.text,
        volume,
      );
    }
  }

  const fullMapFile = `content/slices/${extra.fullMap.file}`;
  for (const interlude of extra.fullMap.interludes) {
    add(out, fullMapFile, `полная карта · блок ${interlude.number} · заголовок`, "интерфейс", interlude.heading);
    for (const pair of interlude.pairs) {
      add(
        out,
        fullMapFile,
        `полная карта · блок ${interlude.number} · ${pair.first} × ${pair.second}`,
        "разбор",
        pair.text,
        volume,
      );
    }
  }
}

function collectQuestions(out: CorpusEntry[]): void {
  const ladder = "content/questions-ladder.md";
  for (const question of rawContent.questions) {
    add(out, ladder, `вопрос ${question.id}`, "вопросы", question.text);
    for (const option of question.options) {
      add(out, ladder, `вопрос ${question.id} · вариант ${option.key}`, "вопросы", option.text);
    }
    if (question.scale) {
      add(out, ladder, `вопрос ${question.id} · полюс низкий`, "вопросы", question.scale.low);
      add(out, ladder, `вопрос ${question.id} · полюс высокий`, "вопросы", question.scale.high);
    }
  }

  const bank = "content/questions-full-bank.md";
  for (const question of rawContent.bank) {
    add(out, bank, `вопрос ${question.id}`, "вопросы", question.text);
    for (const option of question.options) {
      add(out, bank, `вопрос ${question.id} · вариант ${option.key}`, "вопросы", option.text);
    }
  }

  for (const slice of rawContent.slices) {
    if (!slice.file) continue;
    const file = `content/slices/${slice.file}`;
    for (const question of slice.questions) {
      add(out, file, `добор ${question.id}`, "вопросы", question.text);
      for (const option of question.options) {
        add(out, file, `добор ${question.id} · вариант ${option.key}`, "вопросы", option.text);
      }
    }
    if (slice.threshold) {
      slice.threshold.followUps.forEach((text, index) => {
        add(out, file, `уточняющий ${index + 1}`, "вопросы", text);
      });
    }
  }

  extra.fullMap.threshold.followUps.forEach((text, index) => {
    add(out, `content/slices/${extra.fullMap.file}`, `уточняющий ${index + 1}`, "вопросы", text);
  });
}

function collectInterface(out: CorpusEntry[]): void {
  const doorsFile = "content/doors.md";
  for (const [id, label] of Object.entries(extra.doors.nodes)) {
    add(out, doorsFile, `дверь узла ${id}`, "интерфейс", label);
  }
  for (const [id, label] of Object.entries(extra.doors.slices)) {
    add(out, doorsFile, `дверь среза ${id}`, "интерфейс", label);
  }
  for (const [nodeId, row] of Object.entries(extra.doors.applied)) {
    for (const [sliceId, label] of Object.entries(row)) {
      if (label) add(out, doorsFile, `прикладная дверь ${nodeId} × ${sliceId}`, "интерфейс", label);
    }
  }

  for (const entry of extra.uiCopy) {
    add(out, "content/ui-copy.md", entry.id, "интерфейс", entry.text);
  }

  for (const item of extra.crisis.texts) {
    add(out, "content/crisis.md", item.id, "интерфейс", item.text);
  }
  for (const contact of extra.crisis.contacts) {
    add(out, "content/crisis.md", `${contact.id} · название`, "интерфейс", contact.title);
  }

  for (const email of extra.emails.emails) {
    add(out, "content/emails.md", `${email.id} · тема`, "интерфейс", email.subject);
    email.body.forEach((paragraph, index) => {
      add(out, "content/emails.md", `${email.id} · абзац ${index + 1}`, "интерфейс", paragraph);
    });
  }
  for (const footer of extra.emails.footer) {
    add(out, "content/emails.md", footer.id, "интерфейс", footer.text);
  }

  for (const screen of extra.payScreens) {
    const file = `content/slices/${screen.file}`;
    add(out, file, `экран оплаты · обещание`, "интерфейс", screen.promise);
    screen.contents.forEach((part, index) => {
      add(out, file, `экран оплаты · состав ${index + 1}`, "интерфейс", part);
    });
    add(out, file, `экран оплаты · отказ`, "интерфейс", screen.decline);
  }

  for (const caption of extra.share.captions) {
    add(out, "content/share.md", caption.id, "интерфейс", caption.text);
  }

  for (const disclaimer of extra.disclaimers) {
    add(out, "content/legal/disclaimers.md", disclaimer.id, "интерфейс", disclaimer.text);
  }

  for (const [step, lead] of Object.entries(rawContent.leads)) {
    add(out, "content/questions-ladder.md", `подводка ступени ${step}`, "интерфейс", lead);
  }
  add(out, "content/step1-branches.md", "заголовок блока", "интерфейс", rawContent.step1.heading);
  add(out, "content/step2-branches.md", "заголовок блока", "интерфейс", rawContent.step2.heading);
  add(out, "content/step3-contradictions.md", "заголовок блока", "интерфейс", rawContent.step3.heading);
  add(out, "content/step4-open-synthesis.md", "заголовок блока", "интерфейс", rawContent.step4.heading);

  for (const slice of rawContent.slices) {
    const file = slice.file ? `content/slices/${slice.file}` : "content/slices/README.md";
    add(out, file, `название среза ${slice.id}`, "интерфейс", slice.title);
  }
  add(
    out,
    `content/slices/${extra.fullMap.file}`,
    "название полной карты",
    "интерфейс",
    extra.fullMap.title,
  );
  add(
    out,
    `content/slices/${extra.fullMap.file}`,
    "обещание полной карты",
    "интерфейс",
    extra.fullMap.promise,
  );

  for (const path of LEGAL_FILES) {
    add(out, path, "документ", "интерфейс", repoFile(path));
  }
}

function collectExamples(out: CorpusEntry[]): void {
  const file = "examples/demo-report-output.md";
  const source = repoFile(file);
  const sections = source.split(/^## /m);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const newline = trimmed.indexOf("\n");
    const title = newline < 0 ? trimmed : trimmed.slice(0, newline).trim();
    const body = newline < 0 ? "" : trimmed.slice(newline).trim();
    if (!body) continue;
    add(out, file, title, "разбор", body);
  }
}

/** Все человекочитаемые тексты продукта и эталон разбора. */
export function collectCorpus(): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  collectAnalysis(out);
  collectQuestions(out);
  collectInterface(out);
  collectExamples(out);
  return out;
}

function actionFor(hit: ForbiddenHit): string {
  if (hit.degree === "жёсткий") {
    return `Убрать формулировку: группа «${groupTitle(hit.group)}» — жёсткий запрет, исключений нет.`;
  }
  if (hit.degree === "по контексту") {
    return "Переписать без этой формы или поставить в то же предложение отрицание либо разрешённую формулировку из реестра.";
  }
  return "Подозрение: решить, законна ли форма в этом месте. Команду не роняет.";
}

function findingOf(entry: CorpusEntry, hit: ForbiddenHit): Finding {
  const kind: FindingKind = hit.degree === "подозрение" ? "предупреждение" : "отказ";
  return {
    kind,
    file: entry.file,
    place: entry.place,
    group: hit.group,
    form: hit.form,
    match: hit.match,
    reason: hit.reason,
    action: actionFor(hit),
  };
}

function volumeFinding(entry: CorpusEntry, count: number): Finding {
  const volume = entry.volume!;
  const bounds =
    volume.min !== undefined ? `${volume.min}–${volume.max}` : `не больше ${volume.max}`;
  return {
    kind: "отказ",
    file: entry.file,
    place: entry.place,
    group: "объём",
    form: "слов",
    match: `${count}`,
    reason: `слов ${count}, предел ${bounds} (${volume.source})`,
    action: `Уложить текст в ${bounds} слов — ${volume.source}.`,
  };
}

/** Проверка одного текста: реестр плюс объём, если он задан. */
export function lintEntry(entry: CorpusEntry): Finding[] {
  const findings: Finding[] = [];
  for (const hit of scanText(entry.text, entry.scope, { degrees: ALL_DEGREES })) {
    findings.push(findingOf(entry, hit));
  }
  if (entry.volume) {
    const count = wordCount(entry.text);
    const tooLong = count > entry.volume.max;
    const tooShort = entry.volume.min !== undefined && count < entry.volume.min;
    if (tooLong || tooShort) findings.push(volumeFinding(entry, count));
  }
  return findings;
}

/**
 * Образец для проверки группы: форма как в реестре, без отрицания вокруг.
 * Звёздочка дописывается буквой, чтобы сработала основа.
 */
export function sampleFor(form: string): string {
  const body = form.endsWith("*") ? `${form.slice(0, -1)}ый` : form;
  return `Вот формулировка: ${body}.`;
}

/** Проверка произвольного фрагмента в заданной области — для тестов на отказ. */
export function lintSnippet(text: string, scope: ForbiddenScope, volume?: CorpusEntry["volume"]): Finding[] {
  return lintEntry({ file: "образец", place: "заведомо плохой текст", scope, text, volume });
}

export function lintCorpus(entries: CorpusEntry[] = collectCorpus()): LintReport {
  const rejects: Finding[] = [];
  const warnings: Finding[] = [];
  for (const entry of entries) {
    for (const finding of lintEntry(entry)) {
      (finding.kind === "отказ" ? rejects : warnings).push(finding);
    }
  }
  return { entries: entries.length, rejects, warnings };
}

function formatFinding(finding: Finding): string {
  const found =
    finding.group === "объём"
      ? `слов ${finding.match}`
      : `«${finding.match}» (форма «${finding.form}»)`;
  return [
    `${finding.kind}  ${finding.file} · ${finding.place}`,
    `  группа ${finding.group} · найдено ${found}`,
    `  почему: ${finding.reason}`,
    `  что делать: ${finding.action}`,
  ].join("\n");
}

/** Человекочитаемый отчёт по-русски: файл, место, группа, формулировка, что делать. */
export function formatLintReport(report: LintReport): string {
  const lines: string[] = [
    `Проверено текстов: ${report.entries}`,
    `Отказов: ${report.rejects.length}`,
    `Предупреждений: ${report.warnings.length}`,
  ];
  const listed = [...report.rejects, ...report.warnings];
  if (listed.length) {
    lines.push("");
    for (const finding of listed) lines.push(formatFinding(finding), "");
  } else {
    lines.push("", "Запрещённых формулировок и нарушений объёма нет.");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Нужен тесту: степень группы без обхода файла реестра. */
export const degreeOf = (group: string): ForbiddenDegree | null => groupDegree(group);
