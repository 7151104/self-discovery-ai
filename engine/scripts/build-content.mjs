// Собирает content/*.md и docs/02-coordinates.md в engine/src/generated/content.ts.
//
// Markdown остаётся единственным источником правды: тексты, вопросы и варианты
// правит основатель в .md, движок их только читает. Условия срабатывания узлов
// и арифметика скоринга живут в коде — их нельзя выразить прозой без двусмысленности.
//
// Запуск: npm run build:content

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Убирает fenced-блоки, чтобы примеры формата не попадали в разбор. */
function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```$/gm, "");
}

function lines(text) {
  return stripFences(text).split("\n").map((l) => l.replace(/\s+$/, ""));
}

/** Строки markdown-таблицы без шапки и разделителя. */
function tableRows(block) {
  return block
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

/** Одна таблица, начиная со строки заголовка и до первой строки без `|`. */
function tableAt(src, headerIndex) {
  const block = [];
  for (let i = headerIndex; i < src.length; i += 1) {
    if (!src[i].trim().startsWith("|")) break;
    block.push(src[i]);
  }
  return tableRows(block);
}

const unwrap = (s) => s.replace(/^\*\*(.*)\*\*$/, "$1").replace(/^`(.*)`$/, "$1").trim();

/** Абзац после заголовка: строки до следующего заголовка или пустой строки. */
function paragraphAfter(src, index) {
  const out = [];
  for (let i = index; i < src.length; i += 1) {
    const line = src[i];
    if (line.startsWith("#")) break;
    if (line.trim() === "") {
      if (out.length) break;
      continue;
    }
    out.push(line.trim());
  }
  return out.join(" ");
}

// ── 16 координат: имена и определения из docs/02 ──────────────────────────────

function parseCoordinates() {
  const src = lines(read("docs/02-coordinates.md"));
  const out = [];
  src.forEach((line, i) => {
    const m = /^### (\d+)\. (.+)$/.exec(line);
    if (!m) return;
    out.push({ id: Number(m[1]), name: m[2].trim(), description: paragraphAfter(src, i + 1) });
  });
  if (out.length !== 16) throw new Error(`docs/02-coordinates.md: найдено ${out.length} координат вместо 16`);
  return out;
}

// ── Вопросы лестницы ──────────────────────────────────────────────────────────

function parseQuestions() {
  const src = lines(read("content/questions-ladder.md"));
  const out = [];
  const leads = {};
  let current = null;
  let step = 0;

  const push = () => {
    if (!current) return;
    if (!current.text) throw new Error(`${current.id}: не найден текст вопроса`);
    if (current.type === "выбор" && current.options.length < 2)
      throw new Error(`${current.id}: у вопроса типа «выбор» меньше двух вариантов`);
    if (current.type === "шкала" && !current.scale)
      throw new Error(`${current.id}: у шкального вопроса нет подписей полюсов`);
    out.push(current);
    current = null;
  };

  for (const line of src) {
    const head = /^### (L\d+) · (выбор|шкала|открытый) · (\S+) · координаты (.+)$/.exec(line);
    if (head) {
      push();
      current = {
        id: head[1],
        type: head[2],
        source: head[3],
        coordinates: head[4].split(",").map((n) => Number(n.trim())),
        step,
        text: "",
        options: [],
        scale: null,
      };
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("---")) push();

    const stepHead = /^## Ступень (\d)/.exec(line);
    if (stepHead) step = Number(stepHead[1]);
    const lead = /^\*\*Подводка:\*\*\s*«(.+)»$/.exec(line);
    if (lead) leads[step] = lead[1].trim();

    if (!current) continue;

    const option = /^- \*\*([A-G])\*\* — (.+)$/.exec(line);
    if (option) {
      current.options.push({ key: option[1], text: option[2].trim() });
      continue;
    }
    const scale = /^Шкала: (.+?) · (.+)$/.exec(line);
    if (scale) {
      current.scale = { low: scale[1].trim(), high: scale[2].trim() };
      continue;
    }
    const bold = /^\*\*(.+)\*\*$/.exec(line);
    if (bold && !current.text) current.text = bold[1].trim();
  }
  push();

  if (out.length !== 12) throw new Error(`questions-ladder.md: найдено ${out.length} вопросов вместо 12`);
  for (const step of [1, 2, 3, 4]) {
    if (!leads[step]) throw new Error(`questions-ladder.md: нет подводки к ступени ${step}`);
    if (!out.some((q) => q.step === step)) throw new Error(`questions-ladder.md: у ступени ${step} нет вопросов`);
  }
  return { questions: out, leads };
}

// ── Полный банк 35+3 ──────────────────────────────────────────────────────────

const BANK_TYPES = ["шкала", "выбор", "открытый"];
const BANK_DIRECTIONS = ["прямой", "обратный"];
const BANK_ROLES = ["ключевой", "низкий вес"];

/** Ячейка вариантов: `**A** ровно · **B** рывками`. Пустая ячейка — «—». */
function parseBankOptions(cell, id) {
  if (cell === "—") return [];
  const out = cell.split("·").map((part) => {
    const m = /^\*\*([A-G])\*\*\s+(.+)$/.exec(part.trim());
    if (!m) throw new Error(`${id}: не разобран вариант «${part.trim()}»`);
    return { key: m[1], text: m[2].trim() };
  });
  const keys = out.map((option) => option.key);
  if (new Set(keys).size !== keys.length) throw new Error(`${id}: варианты повторяются`);
  return out;
}

function parseFullBank() {
  const src = lines(read("content/questions-full-bank.md"));
  const out = [];
  let block = "";
  let inFormat = false;

  for (const line of src) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      block = heading[1].trim();
      inFormat = block.startsWith("Формат записи");
      continue;
    }
    if (inFormat || !line.trim().startsWith("|")) continue;

    const cells = tableRows([line])[0];
    if (!cells || cells.length !== 7) continue;
    const [id, text, type, coordinates, direction, role, options] = cells;
    if (!/^(Q\d+|О\d+)$/.test(id)) continue;

    if (!text || /\*\*|\||·/.test(text)) throw new Error(`${id}: в тексте вопроса осталась разметка`);
    if (!BANK_TYPES.includes(type)) throw new Error(`${id}: неизвестный тип «${type}»`);
    if (!BANK_DIRECTIONS.includes(direction)) throw new Error(`${id}: неизвестное направление «${direction}»`);
    if (role !== "—" && !BANK_ROLES.includes(role)) throw new Error(`${id}: неизвестная роль «${role}»`);
    if (type !== "шкала" && direction !== "прямой")
      throw new Error(`${id}: инверсия определена только для шкал, направление обязано быть прямым`);

    const ids = coordinates.split(",").map((n) => Number(n.trim()));
    if (!ids.length || ids.some((n) => !Number.isInteger(n) || n < 1 || n > 16))
      throw new Error(`${id}: не разобраны координаты «${coordinates}»`);

    const parsed = parseBankOptions(options, id);
    if (type === "выбор" && parsed.length < 2) throw new Error(`${id}: у вопроса типа «выбор» меньше двух вариантов`);
    if (type !== "выбор" && parsed.length) throw new Error(`${id}: варианты есть только у типа «выбор»`);

    out.push({ id, type, text, coordinates: ids, direction, role: role === "—" ? null : role, options: parsed, block });
  }

  const closed = out.filter((question) => question.type !== "открытый");
  const open = out.filter((question) => question.type === "открытый");
  if (closed.length !== 35 || open.length !== 3)
    throw new Error(`questions-full-bank.md: закрытых ${closed.length}, открытых ${open.length}, ожидалось 35 и 3`);

  closed.forEach((question, i) => {
    if (question.id !== `Q${i + 1}`) throw new Error(`questions-full-bank.md: вместо Q${i + 1} записан ${question.id}`);
  });
  open.forEach((question, i) => {
    if (question.id !== `О${i + 1}`) throw new Error(`questions-full-bank.md: вместо О${i + 1} записан ${question.id}`);
  });

  return out;
}

// ── Ступень 0 ─────────────────────────────────────────────────────────────────

function parseStep0() {
  const src = lines(read("content/step0-welcome.md"));
  const themes = [];
  const metaphors = [];

  const tableStart = src.findIndex((l) => l.startsWith("| Период "));
  if (tableStart < 0) throw new Error("step0-welcome.md: не найдена таблица тем периода");
  for (const cells of tableAt(src, tableStart)) {
    if (cells[0] === "Период") continue;
    if (!cells[0] || !cells[1]) break;
    themes.push({ season: cells[0], theme: cells[1] });
  }

  src.forEach((line, i) => {
    const m = /^\*\*(Весна|Лето|Осень|Зима) — (.+)\*\*$/.exec(line);
    if (!m) return;
    metaphors.push({ season: m[1], theme: m[2].trim(), text: paragraphAfter(src, i + 1) });
  });

  if (themes.length !== 4 || metaphors.length !== 4)
    throw new Error(`step0-welcome.md: тем ${themes.length}, метафор ${metaphors.length}, ожидалось 4 и 4`);
  return { themes, metaphors };
}

// ── Ветви ступеней 1–2 ────────────────────────────────────────────────────────

/** Разбирает `### A — метка` + абзац внутри секций `## L{n} — ...`. */
function parseBranches(src) {
  const branches = {};
  const scales = {};
  let question = null;

  src.forEach((line, i) => {
    const section = /^## (L\d+) —/.exec(line);
    if (section) {
      question = section[1];
      return;
    }
    if (line.startsWith("## ")) {
      question = null;
      return;
    }
    if (!question) return;

    const branch = /^### ([A-G]) — (.+)$/.exec(line);
    if (branch) {
      (branches[question] ??= {})[branch[1]] = {
        label: branch[2].trim(),
        text: paragraphAfter(src, i + 1),
      };
      return;
    }
    const scale = /^\*\*(\d)(?:[–-](\d))?:\*\*\s*(.+)$/.exec(line);
    if (scale) {
      const from = Number(scale[1]);
      const to = scale[2] ? Number(scale[2]) : from;
      (scales[question] ??= []).push({ from, to, text: scale[3].trim() });
    }
  });

  return { branches, scales };
}

/**
 * Строка матрицы сшивок. Ячейка может быть `*` (любой ответ) и нести
 * дополнительные условия: `C + L3=A`.
 */
function parseMatrixSpec(cell) {
  const parts = cell.split("+").map((p) => p.trim());
  const extra = {};
  for (const part of parts.slice(1)) {
    const m = /^(L\d+)\s*=\s*([A-G])$/.exec(part);
    if (!m) throw new Error(`Матрица: не разобрано условие «${part}»`);
    extra[m[1]] = m[2];
  }
  return { key: parts[0], extra };
}

function parseMatrix(src, headingPrefix, secondColumnIsRange) {
  const start = src.findIndex((l) => l.startsWith(headingPrefix));
  if (start < 0) throw new Error(`Не найдена матрица «${headingPrefix}»`);
  const end = src.findIndex((l, i) => i > start && l.startsWith("## "));
  const rows = tableRows(src.slice(start, end < 0 ? undefined : end));

  const out = [];
  for (const cells of rows) {
    if (!cells[2] || cells[0] === "L1" || cells[0] === "L5") continue;
    const first = parseMatrixSpec(cells[0]);
    if (secondColumnIsRange) {
      const range = /^(\d)(?:[–-](\d))?$/.exec(cells[1]);
      if (!range) throw new Error(`Матрица «цена силы»: не разобран диапазон «${cells[1]}»`);
      out.push({
        first: first.key,
        firstExtra: first.extra,
        range: { from: Number(range[1]), to: range[2] ? Number(range[2]) : Number(range[1]) },
        text: cells[2],
      });
    } else {
      const second = parseMatrixSpec(cells[1]);
      out.push({
        first: first.key,
        firstExtra: first.extra,
        second: second.key,
        secondExtra: second.extra,
        text: cells[2],
      });
    }
  }
  if (!out.length) throw new Error(`Матрица «${headingPrefix}» пуста`);
  return out;
}

function blockHeading(src, marker) {
  const i = src.findIndex((l) => l.startsWith(marker));
  if (i < 0) throw new Error(`Не найден заголовок блока (${marker})`);
  for (let j = i + 1; j < src.length; j += 1) {
    const line = src[j].trim();
    if (line) return unwrap(line);
  }
  throw new Error(`Пустой заголовок блока (${marker})`);
}

function parseStep1() {
  const src = lines(read("content/step1-branches.md"));
  const { branches } = parseBranches(src);
  return {
    heading: blockHeading(src, "## Заголовок блока на странице"),
    branches,
    matrix: parseMatrix(src, "## Матрица L1 × L2", false),
  };
}

function parseStep2() {
  const src = lines(read("content/step2-branches.md"));
  const { branches, scales } = parseBranches(src);
  return {
    heading: blockHeading(src, "## Заголовок блока"),
    branches,
    scales,
    matrix: parseMatrix(src, "## Фразы «цена силы»", true),
  };
}

// ── Ступень 3: узлы и маршрут офферов ─────────────────────────────────────────

function parseStep3() {
  const src = lines(read("content/step3-contradictions.md"));
  const nodes = [];
  let current = null;

  for (const line of src) {
    const head = /^### (NODE_[A-Z_]+)$/.exec(line);
    if (head) {
      current = { id: head[1], condition: "", text: "" };
      nodes.push(current);
      continue;
    }
    if (!current) continue;
    const condition = /^\*\*Условие:\*\*\s*(.+)$/.exec(line);
    if (condition) current.condition = condition[1].trim();
    const text = /^\*\*Текст:\*\*\s*(.+)$/.exec(line);
    if (text && !current.text) current.text = text[1].trim();
  }

  const offers = {};
  const start = src.findIndex((l) => l.startsWith("| node_id "));
  if (start < 0) throw new Error("step3-contradictions.md: не найдена таблица офферов");
  for (const cells of tableAt(src, start)) {
    if (cells[0] === "node_id" || !cells[1]) continue;
    offers[cells[0]] = cells[1].replace(/\s*\(.*\)$/, "").trim();
  }

  const headingLine = src.find((l) => l.startsWith("**Заголовок:**"));
  if (!headingLine) throw new Error("step3-contradictions.md: не найден заголовок блока");

  for (const node of nodes) {
    if (!node.text) throw new Error(`${node.id}: нет текста`);
  }
  return { heading: headingLine.replace("**Заголовок:**", "").trim(), nodes, offers };
}

// ── Платные срезы ─────────────────────────────────────────────────────────────

const SLICE_TYPES = ["выбор", "шкала", "открытый", "число"];

/** Ячейка вариантов добора: `**A** сам нашёл · **B** позвали`, `как в S4` или «—». */
function parseSliceOptions(cell, id) {
  if (cell === "—") return { options: [], sameAs: null };
  const reference = /^как в (S\d+)$/.exec(cell);
  if (reference) return { options: [], sameAs: reference[1] };

  const options = cell.split("·").map((part) => {
    const m = /^\*\*([A-G])\*\*\s+(.+)$/.exec(part.trim());
    if (!m) throw new Error(`${id}: не разобран вариант «${part.trim()}»`);
    return { key: m[1], text: m[2].trim() };
  });
  const keys = options.map((option) => option.key);
  if (new Set(keys).size !== keys.length) throw new Error(`${id}: варианты повторяются`);
  return { options, sameAs: null };
}

/**
 * Вопросы-доборы среза: таблицы из шести колонок под разделами «Вопросы-доборы»
 * или «Порция N». Формат описан в content/slices/README.md; разбор обязан падать,
 * а не угадывать, поэтому каждая ячейка проверяется.
 */
function parseSliceQuestions(file, body) {
  const out = [];
  let portion = 1;
  let inside = false;

  for (const line of body) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const section = heading[1].trim();
      const numbered = /^Порция (\d)/.exec(section);
      inside = Boolean(numbered) || section.startsWith("Вопросы-доборы");
      if (numbered) portion = Number(numbered[1]);
      continue;
    }
    if (!inside || !line.trim().startsWith("|")) continue;

    const cells = tableRows([line])[0];
    if (!cells || cells.length !== 6) continue;
    const [id, text, type, coordinates, options, purpose] = cells;
    if (!/^S\d+$/.test(id)) continue;

    if (!text || /\*\*|\||·/.test(text)) throw new Error(`${file} ${id}: в тексте вопроса осталась разметка`);
    if (!SLICE_TYPES.includes(type)) throw new Error(`${file} ${id}: неизвестный тип «${type}»`);
    if (!purpose) throw new Error(`${file} ${id}: не заполнено «Зачем в отчёте»`);

    const ids =
      coordinates === "—"
        ? []
        : coordinates.split(",").map((n) => Number(n.trim()));
    if (ids.some((n) => !Number.isInteger(n) || n < 1 || n > 16))
      throw new Error(`${file} ${id}: не разобраны координаты «${coordinates}»`);

    const parsed = parseSliceOptions(options, `${file} ${id}`);
    if (type !== "выбор" && (parsed.options.length || parsed.sameAs))
      throw new Error(`${file} ${id}: варианты есть только у типа «выбор»`);
    if (type === "выбор" && !parsed.sameAs && parsed.options.length < 2)
      throw new Error(`${file} ${id}: у вопроса типа «выбор» меньше двух вариантов`);

    out.push({
      id,
      portion,
      type,
      text,
      coordinates: ids,
      options: parsed.options,
      sameAs: parsed.sameAs,
      purpose,
    });
  }

  out.forEach((question, i) => {
    if (question.id !== `S${i + 1}`) throw new Error(`${file}: вместо S${i + 1} записан ${question.id}`);
  });

  // «как в S4» — те же варианты, что у названного вопроса.
  for (const question of out) {
    if (!question.sameAs) continue;
    const source = out.find((candidate) => candidate.id === question.sameAs);
    if (!source || !source.options.length)
      throw new Error(`${file} ${question.id}: у ${question.sameAs} нет вариантов, ссылаться не на что`);
    question.options = source.options;
  }

  return out;
}

/**
 * Подтипы координат из раздела «Скоринг доборов»: код и формулировка внутрь
 * профиля. Условия срабатывания живут в `engine/src/slices.ts` — прозой они
 * записаны свободно; здесь берутся только словарь кодов и тексты.
 */
function parseSliceSubtypes(file, body) {
  const start = body.findIndex((l) => l.startsWith("## Скоринг доборов"));
  if (start < 0) throw new Error(`${file}: нет раздела «Скоринг доборов»`);
  const end = body.findIndex((l, i) => i > start && l.startsWith("## "));
  const section = body.slice(start, end < 0 ? undefined : end);

  const out = [];
  section.forEach((line, i) => {
    if (!line.trim().startsWith("|")) return;
    const header = tableRows([line])[0];
    if (!header) return;
    const column = header.findIndex((cell) => ["Подтип", "Тип", "Конфигурация"].includes(cell));
    if (column < 0) return;

    for (const cells of tableAt(section, i).slice(1)) {
      const cell = cells[column];
      if (!cell) continue;
      const m = /^`([a-z_]+)`(?:\s*—\s*(.+))?$/.exec(cell);
      if (!m) throw new Error(`${file}: не разобран подтип «${cell}»`);
      const text = m[2] ?? cells[column + 1] ?? "";
      if (!text) throw new Error(`${file}: у подтипа ${m[1]} нет формулировки`);
      if (out.some((subtype) => subtype.code === m[1])) throw new Error(`${file}: подтип ${m[1]} записан дважды`);
      out.push({ code: m[1], text });
    }
  });

  if (!out.length) throw new Error(`${file}: в разделе «Скоринг доборов» не найдено ни одного подтипа`);
  return out;
}

/** Порог генерации: пункты чек-листа и уточняющие вопросы — тексты из контента. */
function parseSliceThreshold(file, body) {
  const start = body.findIndex((l) => l.startsWith("## Порог генерации"));
  if (start < 0) throw new Error(`${file}: нет раздела «Порог генерации»`);
  const end = body.findIndex((l, i) => i > start && l.startsWith("## "));
  const section = body.slice(start, end < 0 ? undefined : end);

  const checks = [];
  const followUps = [];
  for (const line of section) {
    const check = /^- \[ \]\s*(.+)$/.exec(line.trim());
    if (check) checks.push(check[1].trim());
    const followUp = /^\d+\.\s*«(.+)»\.?$/.exec(line.trim());
    if (followUp) followUps.push(followUp[1].trim());
  }

  if (!checks.length) throw new Error(`${file}: у порога генерации нет пунктов`);
  if (!followUps.length) throw new Error(`${file}: у порога генерации нет уточняющих вопросов`);

  // Обязательный вход в свободной форме (пока только у slice_decision_moment).
  const entry = body.find((l) => /^Минимум \d+ слов/.test(l.trim()));
  const entryMinWords = entry ? Number(/\d+/.exec(entry)[0]) : null;

  return { checks, followUps, entryMinWords };
}

/** Таблица «Следующие двери»: условие текстом и один идентификатор среза. */
function parseSliceDoors(file, body) {
  const start = body.findIndex((l) => l.startsWith("## Следующие двери"));
  if (start < 0) throw new Error(`${file}: нет раздела «Следующие двери после этого среза»`);
  const table = body.findIndex((l, i) => i > start && l.trim().startsWith("|"));
  if (table < 0) throw new Error(`${file}: в разделе «Следующие двери» нет таблицы`);

  const out = [];
  for (const cells of tableAt(body, table).slice(1)) {
    if (!cells[0] || !cells[1]) continue;
    const slice = /`(slice_[a-z_]+)`/.exec(cells[1]);
    if (!slice) throw new Error(`${file}: в строке «${cells[0]}» не найден идентификатор среза`);
    out.push({ condition: cells[0], slice: slice[1] });
  }

  if (!out.length) throw new Error(`${file}: таблица «Следующие двери» пуста`);
  if (out[out.length - 1].condition !== "иначе")
    throw new Error(`${file}: последняя строка «Следующие двери» обязана быть «иначе» — предложение всегда одно`);
  return out;
}

function parseSlices() {
  const index = lines(read("content/slices/README.md"));
  const start = index.findIndex((l) => l.startsWith("| Файл "));
  if (start < 0) throw new Error("content/slices/README.md: не найдена таблица срезов");
  const extraStart = index.findIndex((l) => l.startsWith("| slice_id "));
  if (extraStart < 0) throw new Error("content/slices/README.md: не найдена таблица срезов без доборов");

  const slices = [];
  for (const cells of tableAt(index, start)) {
    if (cells[0] === "Файл" || !cells[1]) continue;
    const file = unwrap(cells[0]);
    const body = lines(read(`content/slices/${file}`));

    const h1 = body.find((l) => l.startsWith("# "));
    const title = /—\s*«(.+)»/.exec(h1 ?? "");
    if (!title) throw new Error(`${file}: в заголовке нет названия среза в «кавычках»`);

    const promiseStart = body.findIndex((l) => l.startsWith("## Что обещаем"));
    if (promiseStart < 0) throw new Error(`${file}: нет раздела «Что обещаем в оффере»`);
    const promise = [];
    for (let i = promiseStart + 1; i < body.length; i += 1) {
      if (body[i].startsWith("## ") || body[i].startsWith("---")) break;
      if (body[i].startsWith(">")) promise.push(body[i].replace(/^>\s?/, "").trim());
    }
    if (!promise.length) throw new Error(`${file}: обещание оффера не найдено`);

    const questions = parseSliceQuestions(file, body);
    // Колонка «Вопросов» в README — контрольное число: «10», «20», «описание + 8».
    const expected = /(\d+)\s*$/.exec(cells[3]);
    if (!expected) throw new Error(`content/slices/README.md: не разобрано число вопросов «${cells[3]}»`);
    if (questions.length !== Number(expected[1]))
      throw new Error(`${file}: вопросов ${questions.length}, в README указано ${expected[1]}`);

    slices.push({
      id: unwrap(cells[1]),
      file,
      title: title[1],
      price: Number(cells[2]),
      questionCount: cells[3],
      coordinates: cells[4].split(",").map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n)),
      promise: promise.join(" ").replace(/\s+/g, " ").trim(),
      questions,
      subtypes: parseSliceSubtypes(file, body),
      threshold: parseSliceThreshold(file, body),
      nextDoors: parseSliceDoors(file, body),
    });
  }

  for (const cells of tableAt(index, extraStart)) {
    if (cells[0] === "slice_id" || !cells[1]) continue;
    slices.push({
      id: unwrap(cells[0]),
      file: null,
      title: cells[2],
      price: Number(cells[1]),
      questionCount: cells[3],
      coordinates: [],
      promise: "",
      questions: [],
      subtypes: [],
      threshold: null,
      nextDoors: [],
    });
  }

  if (!slices.length) throw new Error("content/slices: срезы не разобраны");
  return slices;
}

// ── Ступень 4: промпт и шаблон оффера ─────────────────────────────────────────

function parseStep4() {
  const raw = read("content/step4-open-synthesis.md");
  const blocks = [...raw.matchAll(/^```(?:\w+)?\n([\s\S]*?)^```$/gm)].map((m) => m[1].trim());
  if (blocks.length < 2) throw new Error("step4-open-synthesis.md: ожидались промпт и шаблон оффера");

  return {
    heading: blockHeading(lines(raw), "## Заголовок на странице"),
    prompt: blocks[0],
    offerTemplate: blocks[1],
  };
}

// ── Сборка ────────────────────────────────────────────────────────────────────

const ladder = parseQuestions();

const content = {
  coordinates: parseCoordinates(),
  questions: ladder.questions,
  bank: parseFullBank(),
  leads: ladder.leads,
  step0: parseStep0(),
  step1: parseStep1(),
  step2: parseStep2(),
  step3: parseStep3(),
  step4: parseStep4(),
  slices: parseSlices(),
};

const outDir = join(root, "engine/src/generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "content.ts"),
  `// СГЕНЕРИРОВАНО из content/*.md и docs/02-coordinates.md — не редактировать.\n` +
    `// Источник правды — markdown. Пересборка: npm run build:content\n\n` +
    `import type { RawContent } from "../content-types.js";\n\n` +
    `export const rawContent: RawContent = ${JSON.stringify(content, null, 2)};\n`,
  "utf8",
);

const sliceFiles = readdirSync(join(root, "content/slices")).filter((f) => f.endsWith(".md") && f !== "README.md");
const listed = content.slices.filter((s) => s.file).length;
if (sliceFiles.length !== listed)
  throw new Error(`content/slices: файлов ${sliceFiles.length}, в таблице ${listed}`);

const sliceQuestions = content.slices.reduce((sum, slice) => sum + slice.questions.length, 0);

console.log(
  `content.ts собран: ${content.coordinates.length} координат, ${content.questions.length} вопросов лестницы, ` +
    `${content.bank.length} вопросов банка, ${sliceQuestions} вопросов-доборов, ` +
    `${content.step3.nodes.length} узлов, ${content.slices.length} срезов`,
);
