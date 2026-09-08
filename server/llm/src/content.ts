/**
 * Чтение правил, которые слою нужны, прямо из markdown.
 *
 * Правило проекта: источник правды — `content/` и `docs/`, а не строки в коде.
 * Сборщик движка (`engine/scripts/build-content.mjs`) три нужных здесь раздела
 * пока не разбирает, а трогать его нельзя — он принадлежит движку. Поэтому слой
 * читает их сам, теми же правилами разметки, и падает при расхождении формата,
 * а не подставляет значение по умолчанию.
 *
 * Разбираются три таблицы:
 *   объём отчёта по машинному типу   — `docs/06-report-structure.md`, «Объём»;
 *   маркеры регистров medium и low   — `content/forbidden.md`, «Формулировки-исключения»;
 *   потолки confidence лестницы      — `content/scoring-rules.md`, «Что лестница закрывает и что нет».
 *
 * Когда сборщик станет свободен, эти три разбора уезжают в него без правок здесь:
 * наружу отдаются функции, а не путь к файлу.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Confidence } from "./engine.js";

/** Корень репозитория ищется по `package.json`, а не по числу `..` в пути. */
function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      readFileSync(join(directory, "package.json"), "utf8");
      return directory;
    } catch {
      directory = dirname(directory);
    }
  }
  throw new Error("llm/content: не найден корень репозитория");
}

const ROOT = repositoryRoot();

/** Файл репозитория по пути от его корня: от текущего каталога процесса не зависит. */
export const readRepoFile = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

const read = (relative: string): string[] => readRepoFile(relative).split("\n");

/** Строки таблицы, которая начинается на `from`: ячейки без обрамляющих труб. */
function tableAfter(lines: string[], from: number, file: string, section: string): string[][] {
  const start = lines.findIndex((line, index) => index >= from && line.trimStart().startsWith("|"));
  if (start < 0) throw new Error(`${file}: в разделе «${section}» нет таблицы`);

  const rows: string[][] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith("|")) break;
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    rows.push(
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  }
  if (rows.length < 2) throw new Error(`${file}: таблица раздела «${section}» пуста`);
  return rows.slice(1);
}

function sectionAt(lines: string[], heading: string, file: string): number {
  const index = lines.findIndex((line) => line.trim() === heading);
  if (index < 0) throw new Error(`${file}: не найден раздел «${heading}»`);
  return index;
}

/** Формы в ячейке: `слово` · `основа*`. Разметка та же, что в реестре запретов. */
const formsIn = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.trim());

// ── Объём отчёта по машинному типу ────────────────────────────────────────────

/** Машинный тип отчёта из `docs/06-report-structure.md`. */
export type ReportType = string;

export interface WordRange {
  min: number;
  max: number;
}

const VOLUMES_FILE = "docs/06-report-structure.md";

function parseVolumes(): Map<ReportType, WordRange> {
  const lines = read(VOLUMES_FILE);
  const rows = tableAfter(lines, sectionAt(lines, "## Объём", VOLUMES_FILE), VOLUMES_FILE, "Объём");
  const volumes = new Map<ReportType, WordRange>();

  for (const cells of rows) {
    const [, typeCell, wordsCell] = cells;
    if (!typeCell || !wordsCell) continue;
    const types = formsIn(typeCell);
    if (!types.length) continue;
    const range = /(\d+)\s*[–—-]\s*(\d+)/.exec(wordsCell);
    if (!range) throw new Error(`${VOLUMES_FILE}: в строке «${typeCell}» не читается объём «${wordsCell}»`);
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (!(min > 0 && max > min)) throw new Error(`${VOLUMES_FILE}: объём «${wordsCell}» бессмыслен`);
    for (const type of types) volumes.set(type, { min, max });
  }

  if (!volumes.has("финал_лестницы") || !volumes.has("бесплатный_полный"))
    throw new Error(`${VOLUMES_FILE}: в таблице объёма нет обоих бесплатных типов отчёта`);
  return volumes;
}

let volumesCache: Map<ReportType, WordRange> | null = null;

/** Объём по машинному типу отчёта. Неизвестный тип — ошибка, а не «как-нибудь». */
export function volumeOf(type: ReportType): WordRange {
  volumesCache ??= parseVolumes();
  const range = volumesCache.get(type);
  if (!range) throw new Error(`llm/content: тип отчёта «${type}» не описан в ${VOLUMES_FILE}`);
  return range;
}

export function reportTypes(): ReportType[] {
  volumesCache ??= parseVolumes();
  return [...volumesCache.keys()];
}

// ── Маркеры регистров ─────────────────────────────────────────────────────────

/**
 * Формулировки, которыми регистр опознаётся в тексте. Живут в реестре запретов
 * как разрешённые исключения с пометкой регистра: там же, где запрещены
 * утверждения без оговорки.
 */
export interface RegisterMarkers {
  medium: string[];
  low: string[];
}

const MARKERS_FILE = "content/forbidden.md";

function parseRegisterMarkers(): RegisterMarkers {
  const lines = read(MARKERS_FILE);
  const rows = tableAfter(
    lines,
    sectionAt(lines, "## Формулировки-исключения", MARKERS_FILE),
    MARKERS_FILE,
    "Формулировки-исключения",
  );

  const markers: RegisterMarkers = { medium: [], low: [] };
  for (const cells of rows) {
    const [formCell, reasonCell] = cells;
    if (!formCell || !reasonCell) continue;
    if (/регистр\s+`medium`/i.test(reasonCell)) markers.medium.push(...formsIn(formCell));
    if (/регистр\s+`low`/i.test(reasonCell)) markers.low.push(...formsIn(formCell));
  }

  if (!markers.medium.length || !markers.low.length)
    throw new Error(`${MARKERS_FILE}: в исключениях не помечены формулировки регистров medium и low`);
  return markers;
}

let markersCache: RegisterMarkers | null = null;

export function registerMarkers(): RegisterMarkers {
  markersCache ??= parseRegisterMarkers();
  return markersCache;
}

// ── Слова отрицания ───────────────────────────────────────────────────────────

/**
 * Слова, которыми реестр считает совпадение законным: раздел «Как читать реестр»,
 * абзац про значение `отрицание`. Тот же список ведёт сканер движка; здесь он
 * нужен затем, чтобы валидатор мог применить правило отрицания к группе, которую
 * он поднял из подозрения в ошибку.
 */
function parseNegations(): string[] {
  const lines = read(MARKERS_FILE);
  const start = lines.findIndex((line) => /Значение\s+`отрицание`\s+означает/.test(line));
  if (start < 0) throw new Error(`${MARKERS_FILE}: не найден абзац про значение «отрицание»`);

  const paragraph: string[] = [];
  for (let index = start; index < lines.length && lines[index]!.trim(); index += 1) paragraph.push(lines[index]!);

  const found = formsIn(paragraph.join(" ")).filter((form) => form !== "отрицание");
  if (found.length < 3) throw new Error(`${MARKERS_FILE}: слова отрицания не разобраны`);
  return found;
}

let negationsCache: string[] | null = null;

export function negationWords(): string[] {
  negationsCache ??= parseNegations();
  return negationsCache;
}

// ── Потолки confidence лестницы ───────────────────────────────────────────────

const CAPS_FILE = "content/scoring-rules.md";

function parseLadderCaps(): Map<number, Confidence> {
  const lines = read(CAPS_FILE);
  const rows = tableAfter(
    lines,
    sectionAt(lines, "### Что лестница закрывает и что нет", CAPS_FILE),
    CAPS_FILE,
    "Что лестница закрывает и что нет",
  );

  const caps = new Map<number, Confidence>();
  for (const cells of rows) {
    const [coordinateCell, , capCell] = cells;
    if (!coordinateCell || !capCell) continue;
    const cap = /\b(high|medium|low)\b/.exec(capCell);
    if (!cap) continue;
    for (const id of coordinateCell.split(",").map((part) => Number(part.trim()))) {
      if (Number.isInteger(id)) caps.set(id, cap[1] as Confidence);
    }
  }

  if (!caps.size) throw new Error(`${CAPS_FILE}: потолки confidence лестницы не разобраны`);
  return caps;
}

let capsCache: Map<number, Confidence> | null = null;

/**
 * Потолок confidence координаты в бесплатной лестнице. `null` — координата
 * лестницей не закрывается вовсе.
 */
export function ladderCapOf(coordinate: number): Confidence | null {
  capsCache ??= parseLadderCaps();
  return capsCache.get(coordinate) ?? null;
}
