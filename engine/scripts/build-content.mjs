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

// ── Полный банк 40+3 ──────────────────────────────────────────────────────────

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
  if (closed.length !== 40 || open.length !== 3)
    throw new Error(`questions-full-bank.md: закрытых ${closed.length}, открытых ${open.length}, ожидалось 40 и 3`);

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
const SLICE_TABLE_HEADER = "ID|Вопрос|Тип|Коорд.|Варианты|Зачем в отчёте";

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
  let header = false;

  for (const line of body) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const section = heading[1].trim();
      const numbered = /^Порция (\d)/.exec(section);
      inside = Boolean(numbered) || section.startsWith("Вопросы-доборы");
      if (numbered) portion = Number(numbered[1]);
      header = false;
      continue;
    }
    if (!inside || !line.trim().startsWith("|")) continue;

    const cells = tableRows([line])[0];
    if (!cells || cells.length !== 6) continue;
    const [id, text, type, coordinates, options, purpose] = cells;

    // Шапка таблицы обязательна: без неё колонки читаются по счёту, а не по смыслу.
    if (id === "ID") {
      if (cells.join("|") !== SLICE_TABLE_HEADER)
        throw new Error(`${file}: шапка таблицы вопросов — «${cells.join(" | ")}», ожидалась «${SLICE_TABLE_HEADER.split("|").join(" | ")}»`);
      header = true;
      continue;
    }
    if (!/^S\d+$/.test(id)) continue;
    if (!header) throw new Error(`${file} ${id}: вопрос записан до шапки таблицы`);

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

  return { checks, followUps };
}

/**
 * Обязательный вход среза: раздел «Вход: …», внутри него формулировка в блоке
 * кода и строка «Минимум N слов». Есть не у всех срезов — тогда null. Вход
 * выдаётся как первый вопрос первой порции, поэтому его текст нужен машине.
 */
function parseSliceEntry(file, raw) {
  // Читает исходный текст, а не `body`: формулировка входа лежит в блоке кода,
  // а `lines()` такие блоки вырезает.
  const all = raw.split("\n");
  const start = all.findIndex((l) => /^## Вход[:\s]/.test(l));
  if (start < 0) return null;
  const end = all.findIndex((l, i) => i > start && l.startsWith("## "));
  const section = all.slice(start, end < 0 ? undefined : end).join("\n");

  const block = /^```\n([\s\S]*?)^```$/m.exec(section);
  if (!block) throw new Error(`${file}: у обязательного входа нет формулировки в блоке кода`);
  const minimum = /^Минимум (\d+) слов/m.exec(section);
  if (!minimum) throw new Error(`${file}: у обязательного входа не указан минимум слов`);

  return { text: block[1].trim(), minWords: Number(minimum[1]) };
}

/** Колонка «Координаты» в README: номера через запятую или «все 16». */
function parseSliceCoordinates(cell) {
  if (/^все 16$/.test(cell.trim())) return Array.from({ length: 16 }, (_, i) => i + 1);
  const out = cell.split(",").map((n) => Number(n.trim()));
  if (out.some((n) => !Number.isInteger(n) || n < 1 || n > 16))
    throw new Error(`content/slices/README.md: не разобраны координаты «${cell}»`);
  return out;
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

/**
 * Файлы срезов, объявленные в таблице, но ещё не написанные: строка
 * «**Ещё не написан:** `файл` — …». Пометка обязательна и проверяется в обе
 * стороны, чтобы «нет файла» не превращалось в тихо пропущенный срез.
 */
function parsePendingFiles(index) {
  const out = new Map();
  for (const line of index) {
    const m = /^\*\*Ещё не написан:\*\*\s*`([^`]+)`\s*—\s*дверь «([^»]+)»/.exec(line.trim());
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function parseSlices() {
  const index = lines(read("content/slices/README.md"));
  const start = index.findIndex((l) => l.startsWith("| Файл "));
  if (start < 0) throw new Error("content/slices/README.md: не найдена таблица срезов");
  const extraStart = index.findIndex((l) => l.startsWith("| slice_id "));
  if (extraStart < 0) throw new Error("content/slices/README.md: не найдена таблица срезов без доборов");

  const pending = parsePendingFiles(index);
  const written = new Set(readdirSync(join(root, "content/slices")).filter((f) => f.endsWith(".md")));
  for (const file of pending.keys()) {
    if (written.has(file))
      throw new Error(`content/slices/${file} написан — убери пометку «Ещё не написан» из README`);
  }

  const slices = [];
  for (const cells of tableAt(index, start)) {
    if (cells[0] === "Файл" || !cells[1]) continue;
    const file = unwrap(cells[0]);

    // Срез объявлен, файла доборов ещё нет: дверь и цена известны, вопросов нет.
    if (pending.has(file)) {
      slices.push({
        id: unwrap(cells[1]),
        file: null,
        plannedFile: file,
        title: pending.get(file),
        price: Number(cells[2]),
        questionCount: cells[3],
        coordinates: parseSliceCoordinates(cells[4]),
        promise: "",
        questions: [],
        subtypes: [],
        threshold: null,
        entry: null,
        nextDoors: [],
      });
      continue;
    }
    if (!written.has(file))
      throw new Error(`content/slices/${file} не найден — если файла ещё нет, пометь его «Ещё не написан» в README`);

    const rawSlice = read(`content/slices/${file}`);
    const body = lines(rawSlice);

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
      plannedFile: null,
      title: title[1],
      price: Number(cells[2]),
      questionCount: cells[3],
      coordinates: parseSliceCoordinates(cells[4]),
      promise: promise.join(" ").replace(/\s+/g, " ").trim(),
      questions,
      subtypes: parseSliceSubtypes(file, body),
      threshold: parseSliceThreshold(file, body),
      entry: parseSliceEntry(file, rawSlice),
      nextDoors: parseSliceDoors(file, body),
    });
  }

  for (const cells of tableAt(index, extraStart)) {
    if (cells[0] === "slice_id" || !cells[1]) continue;
    slices.push({
      id: unwrap(cells[0]),
      file: null,
      plannedFile: null,
      title: cells[2],
      price: Number(cells[1]),
      questionCount: cells[3],
      coordinates: [],
      promise: "",
      questions: [],
      subtypes: [],
      threshold: null,
      entry: null,
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

  const ladder = read("content/questions-ladder.md");
  const minimum = /Минимум для генерации:\s*(\d+)\s*слов/.exec(ladder);
  if (!minimum) throw new Error("questions-ladder.md: не найден минимум слов открытого ответа");

  return {
    heading: blockHeading(lines(raw), "## Заголовок на странице"),
    prompt: blocks[0],
    offerTemplate: blocks[1],
    minWords: Number(minimum[1]),
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
// Файл добора обязан быть назван в README — в таблице состава или в таблице добора из
// банка. Считать файлы против одной таблицы нельзя: у slice_full_map своих формулировок
// нет, и в таблицу состава он не попадает (content/slices/README.md).
const sliceIndex = read("content/slices/README.md");
for (const file of sliceFiles) {
  if (!sliceIndex.includes(`\`${file}\``)) throw new Error(`content/slices/${file}: файл не назван в README`);
}

const sliceQuestions = content.slices.reduce((sum, slice) => sum + slice.questions.length, 0);

console.log(
  `content.ts собран: ${content.coordinates.length} координат, ${content.questions.length} вопросов лестницы, ` +
    `${content.bank.length} вопросов банка, ${sliceQuestions} вопросов-доборов, ` +
    `${content.step3.nodes.length} узлов, ${content.slices.length} срезов`,
);

// ── Тексты этапа E5: промежуточные блоки срезов, подписи дверей, дисклеймеры ───
//
// Собираются во второй производный файл engine/src/generated/content-extra.ts.
// Разбор выше этот блок не трогает: тексты E5 приходят партиями, и каждая партия
// добавляет свой раздел, не переписывая уже собранное.

/** `A–E` → ["A","B","C","D","E"]. */
function expandOptionKeys(spec, where) {
  const range = /^([A-G])[–-]([A-G])$/.exec(spec.trim());
  if (!range) throw new Error(`${where}: не разобран диапазон вариантов «${spec}»`);
  const from = range[1].charCodeAt(0);
  const to = range[2].charCodeAt(0);
  if (to < from) throw new Error(`${where}: диапазон «${spec}» записан в обратную сторону`);
  return Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i));
}

/** Ключи вариантов, перечисленных прямо в строке вопроса добора. */
function sliceQuestionKeys(body, id) {
  const row = body.find((line) => line.trim().startsWith(`| ${id} |`));
  if (!row) throw new Error(`не найден вопрос ${id} в таблице порции`);
  const cells = tableRows([row])[0] ?? [];
  return [...(cells[1] ?? "").matchAll(/\*\*([A-G])\*\*/g)].map((match) => match[1]);
}

/** Таблица под заголовком: первая строка с `|` после него и до первой строки без `|`. */
function tableUnder(src, heading, where) {
  const start = src.findIndex((line) => line.startsWith(heading));
  if (start < 0) throw new Error(`${where}: не найден раздел «${heading}»`);
  const header = src.findIndex((line, i) => i > start && line.trim().startsWith("|"));
  if (header < 0) throw new Error(`${where}: в разделе «${heading}» нет таблицы`);
  return tableAt(src, header);
}

const INTERLUDE_HEADING = "## Промежуточный блок после порции 1";

/**
 * Промежуточные блоки прикладных срезов (E5-04): пара ответов первой порции →
 * готовый текст. Срез без такого раздела просто не попадает в список.
 */
function parseSliceInterludes(slices) {
  const out = [];

  for (const slice of slices) {
    if (!slice.file) continue;
    const body = lines(read(`content/slices/${slice.file}`));
    if (!body.some((line) => line.startsWith(INTERLUDE_HEADING))) continue;

    const start = body.findIndex((line) => line.startsWith(INTERLUDE_HEADING));
    const end = body.findIndex((line, i) => i > start && line.startsWith("## "));
    const section = body.slice(start, end < 0 ? undefined : end);

    const headingLine = section.find((line) => line.startsWith("**Заголовок блока:**"));
    if (!headingLine) throw new Error(`${slice.file}: у промежуточного блока нет заголовка`);
    const axesLine = section.find((line) => line.startsWith("**Оси:**"));
    if (!axesLine) throw new Error(`${slice.file}: у промежуточного блока не объявлены оси`);

    const axes = axesLine
      .replace("**Оси:**", "")
      .split("·")
      .map((part) => {
        const m = /^(S\d+)\s*—\s*(.+)$/.exec(part.trim());
        if (!m) throw new Error(`${slice.file}: не разобрана ось «${part.trim()}»`);
        return { id: m[1], keys: expandOptionKeys(m[2], `${slice.file}, ось ${m[1]}`) };
      });
    if (axes.length !== 2) throw new Error(`${slice.file}: у промежуточного блока ожидались две оси`);

    const pairs = [];
    const seen = new Set();
    for (const cells of tableUnder(section, INTERLUDE_HEADING, slice.file)) {
      if (cells.length !== 3) continue;
      if (!/^[A-G]$/.test(cells[0]) || !/^[A-G]$/.test(cells[1])) continue;
      const key = `${cells[0]}${cells[1]}`;
      if (seen.has(key)) throw new Error(`${slice.file}: пара ${cells[0]}×${cells[1]} записана дважды`);
      if (!cells[2]) throw new Error(`${slice.file}: у пары ${cells[0]}×${cells[1]} нет текста`);
      seen.add(key);
      pairs.push({ first: cells[0], second: cells[1], text: cells[2] });
    }
    if (!pairs.length) throw new Error(`${slice.file}: таблица промежуточного блока пуста`);

    out.push({
      slice: slice.id,
      file: slice.file,
      heading: unwrap(headingLine.replace("**Заголовок блока:**", "").trim()),
      axes,
      questionKeys: {
        first: sliceQuestionKeys(body, axes[0].id),
        second: sliceQuestionKeys(body, axes[1].id),
      },
      pairs,
    });
  }

  return out;
}

/**
 * Подписи закрытых дверей (E5-05). Три реестра: по узлу — дверь его собственного
 * среза; прикладные двери под узел — тот же механизм в области жизни; по срезу —
 * общая подпись, когда тема человеку ещё не известна. Прочерк в прикладной
 * таблице означает «подпись берётся из реестра узлов».
 */
function parseDoorLabels() {
  const src = lines(read("content/doors.md"));
  const where = "content/doors.md";

  const nodes = {};
  for (const cells of tableUnder(src, "## Подписи дверей по узлу", where)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^NODE_[A-Z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${where}: у узла ${id} пустая подпись двери`);
    nodes[id] = cells[1];
  }

  const slices = {};
  for (const cells of tableUnder(src, "## Подписи дверей по срезу", where)) {
    const id = unwrap(cells[0] ?? "");
    if (id === "slice_id" || !/^slice_[a-z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${where}: у среза ${id} пустая подпись двери`);
    slices[id] = cells[1];
  }

  const appliedRows = tableUnder(src, "## Подписи прикладных дверей под узел", where);
  const header = (appliedRows[0] ?? []).map(unwrap);
  if (header.length < 2) throw new Error(`${where}: в таблице прикладных дверей нет колонок со срезами`);
  const applied = {};
  for (const cells of appliedRows.slice(1)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^NODE_[A-Z_]+$/.test(id)) continue;
    const row = {};
    for (let i = 1; i < header.length; i += 1) {
      const value = (cells[i] ?? "").trim();
      if (!value) throw new Error(`${where}: у пары ${id} × ${header[i]} пустая ячейка`);
      row[header[i]] = value === "—" ? null : value;
    }
    applied[id] = row;
  }

  if (!Object.keys(nodes).length || !Object.keys(slices).length || !Object.keys(applied).length)
    throw new Error(`${where}: один из реестров подписей пуст`);
  return { nodes, slices, applied };
}

/**
 * Дисклеймеры внутри продукта (E5-08): строка с идентификатором, текстом и списком
 * мест показа. Интерфейс берёт текст отсюда — зашитых русских строк в коде нет.
 */
function parseDisclaimers() {
  const file = "content/legal/disclaimers.md";
  const src = lines(read(file));
  const out = [];
  for (const cells of tableUnder(src, "## Реестр дисклеймеров", file)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^DISCLAIMER_[A-Z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${file}: у ${id} нет текста`);
    const where = (cells[2] ?? "")
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!where.length) throw new Error(`${file}: у ${id} не указано, где он показывается`);
    out.push({ id, text: cells[1], where });
  }
  if (!out.length) throw new Error(`${file}: реестр дисклеймеров пуст`);
  return out;
}

/**
 * Реестр запрещённых формулировок (E5-01). Группа — раздел `### ID · Название`,
 * под ним строка со степенью и областью, затем таблица форм.
 *
 * Степень и область живут у группы, а не у строки: иначе одна и та же форма
 * получает два разных запрета в разных строках, и линтер перестаёт быть правилом.
 */
function parseForbidden() {
  const file = "content/forbidden.md";
  const src = lines(read(file));
  const registry = src.findIndex((line) => line.startsWith("## Реестр"));
  if (registry < 0) throw new Error(`${file}: не найден раздел «Реестр»`);

  const splitForms = (cell) =>
    cell
      .split("·")
      .map((part) => unwrap(part.trim()))
      .filter((part) => part && part !== "—");

  const DEGREES = ["жёсткий", "по контексту", "подозрение"];
  const SCOPES = ["разбор", "вопросы", "интерфейс", "промпты"];
  const SHORTCUTS = { наружу: ["разбор", "вопросы", "интерфейс"], всюду: SCOPES };

  const groups = [];
  for (let i = registry + 1; i < src.length; i += 1) {
    if (src[i].startsWith("## ")) break;
    const heading = /^### ([A-Z_]+) · (.+)$/.exec(src[i]);
    if (!heading) continue;
    const [, id, title] = heading;

    const meta = src.slice(i + 1, i + 6).find((line) => line.includes("**Степень:**"));
    if (!meta) throw new Error(`${file}: у группы ${id} нет строки со степенью и областью`);
    const degree = unwrap((/\*\*Степень:\*\*([^·]+)/.exec(meta)?.[1] ?? "").trim());
    if (!DEGREES.includes(degree)) throw new Error(`${file}: у группы ${id} неизвестная степень «${degree}»`);
    const scopeCell = (/\*\*Область:\*\*(.+)$/.exec(meta)?.[1] ?? "").trim();
    const scopes = scopeCell
      .split("·")
      .flatMap((part) => SHORTCUTS[part.trim()] ?? [part.trim()])
      .filter(Boolean);
    for (const scope of scopes) {
      if (!SCOPES.includes(scope)) throw new Error(`${file}: у группы ${id} неизвестная область «${scope}»`);
    }

    const entries = [];
    for (const cells of tableUnder(src.slice(i), "### ", `${file}: группа ${id}`)) {
      if (cells[0] === "Форма") continue;
      const forms = splitForms(cells[0] ?? "");
      if (!forms.length) throw new Error(`${file}: в группе ${id} строка без форм`);
      const reason = cells[2] ?? "";
      if (!reason) throw new Error(`${file}: в группе ${id} форма «${forms[0]}» без обоснования`);
      const exceptions = splitForms(cells[1] ?? "");
      if (exceptions.length && degree === "жёсткий")
        throw new Error(`${file}: у жёсткого запрета «${forms[0]}» не может быть исключений`);
      // Форма с отрицанием внутри и исключение «отрицание» отменяют друг друга.
      if (exceptions.includes("отрицание")) {
        const negated = forms.find((form) => /(^|\s)(не|ни|нет|без)(\s|$)/.test(form.toLowerCase()));
        if (negated) throw new Error(`${file}: форма «${negated}» содержит отрицание и не может им же оправдываться`);
      }
      entries.push({ forms, exceptions, reason });
    }
    if (!entries.length) throw new Error(`${file}: группа ${id} пуста`);
    groups.push({ id, title, degree, scopes, entries });
  }
  if (!groups.length) throw new Error(`${file}: в реестре нет групп`);

  const allowed = tableUnder(src, "## Формулировки-исключения", file)
    .filter((cells) => cells[0] !== "Формулировка")
    .flatMap((cells) => splitForms(cells[0] ?? ""));
  if (!allowed.length) throw new Error(`${file}: список формулировок-исключений пуст`);

  const seen = new Map();
  for (const group of groups) {
    for (const entry of group.entries) {
      for (const form of entry.forms) {
        const key = form.toLowerCase().replace(/ё/g, "е");
        if (seen.has(key)) throw new Error(`${file}: форма «${form}» повторяется в ${seen.get(key)} и ${group.id}`);
        seen.set(key, group.id);
      }
    }
  }

  return { groups, allowed };
}

/**
 * Кризисные тексты, триггеры и контакты (E5-02). Файл — вход кризисного детектора
 * (E2-07): триггеры и корпус похожих, но не кризисных формулировок размечены так же,
 * как формы в реестре запретов, а тексты и контакты лежат отдельными реестрами.
 */
function parseCrisis() {
  const file = "content/crisis.md";
  const src = lines(read(file));
  const splitForms = (cell) =>
    cell
      .split("·")
      .map((part) => unwrap(part.trim()))
      .filter((part) => part && part !== "—");

  const LEVELS = ["кризис", "с оговоркой"];
  const triggers = [];
  for (let i = 0; i < src.length; i += 1) {
    const heading = /^### (CRISIS_[A-Z_]+) · (.+)$/.exec(src[i]);
    if (!heading) continue;
    const [, id, title] = heading;
    const meta = src.slice(i + 1, i + 5).find((line) => line.includes("**Уровень:**"));
    if (!meta) throw new Error(`${file}: у категории ${id} нет уровня и действия`);
    const level = unwrap((/\*\*Уровень:\*\*([^·]+)/.exec(meta)?.[1] ?? "").trim());
    if (!LEVELS.includes(level)) throw new Error(`${file}: у категории ${id} неизвестный уровень «${level}»`);
    const action = unwrap((/\*\*Действие:\*\*(.+)$/.exec(meta)?.[1] ?? "").trim());
    if (!action) throw new Error(`${file}: у категории ${id} не описано действие`);

    const forms = [];
    for (const cells of tableUnder(src.slice(i), "### ", `${file}: категория ${id}`)) {
      if (cells[0] === "Форма") continue;
      const row = splitForms(cells[0] ?? "");
      if (!row.length) throw new Error(`${file}: в категории ${id} строка без форм`);
      if (!cells[1]) throw new Error(`${file}: в категории ${id} форма «${row[0]}» без обоснования`);
      forms.push(...row);
    }
    if (!forms.length) throw new Error(`${file}: категория ${id} пуста`);
    triggers.push({ id, title, level, action, forms });
  }
  if (!triggers.length) throw new Error(`${file}: не найдено ни одной категории триггеров`);

  const safe = tableUnder(src, "## Похожие формулировки", file)
    .filter((cells) => cells[0] !== "Формулировка")
    .flatMap((cells) => splitForms(cells[0] ?? ""));
  if (!safe.length) throw new Error(`${file}: пуст корпус похожих, но не кризисных формулировок`);

  const texts = [];
  for (const cells of tableUnder(src, "## Тексты", file)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^CRISIS_[A-Z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${file}: у ${id} нет текста`);
    const where = (cells[2] ?? "")
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!where.length) throw new Error(`${file}: у ${id} не указано, где он показывается`);
    texts.push({ id, text: cells[1], where });
  }
  if (!texts.length) throw new Error(`${file}: реестр кризисных текстов пуст`);

  const contacts = [];
  for (const cells of tableUnder(src, "## Контакты помощи", file)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^CRISIS_CONTACT_[A-Z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${file}: у контакта ${id} нет описания`);
    const value = (cells[2] ?? "").trim();
    const placeholder = /^\{\{([А-ЯЁ_]+)\}\}$/.exec(value);
    contacts.push({ id, title: cells[1], value, placeholder: placeholder ? placeholder[1] : null });
  }
  if (!contacts.length) throw new Error(`${file}: реестр контактов помощи пуст`);
  if (!src.some((line) => line.startsWith("**Последняя проверка:**")))
    throw new Error(`${file}: нет строки о последней проверке актуальности контактов`);

  return { triggers, safe, texts, contacts };
}

/**
 * Реестр микрокопии (E5-03) и тексты краевых состояний (E5-06). Раздел файла —
 * группа, строка таблицы — строка интерфейса с идентификатором и местами показа.
 *
 * Подстановки вида `{имя}` вынимаются из текста: код обязан передать их значения,
 * иначе на экран уходит текст с фигурными скобками.
 */
function parseUiCopy() {
  const file = "content/ui-copy.md";
  const src = lines(read(file));
  const entries = [];
  let group = null;

  for (let i = 0; i < src.length; i += 1) {
    const heading = /^## ([A-Z_]+) · (.+)$/.exec(src[i]);
    if (heading) {
      group = { id: heading[1], title: heading[2] };
      continue;
    }
    if (src[i].startsWith("## ")) {
      group = null;
      continue;
    }
    if (!group || !src[i].trim().startsWith("|")) continue;

    const cells = tableRows([src[i]])[0];
    if (!cells) continue;
    const id = unwrap(cells[0] ?? "");
    if (!/^UI_[A-Z0-9_]+$/.test(id)) continue;
    const text = (cells[1] ?? "").trim();
    if (!text) throw new Error(`${file}: у ${id} нет текста`);
    const where = (cells[2] ?? "")
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!where.length) throw new Error(`${file}: у ${id} не указано, где он показывается`);
    const params = [...text.matchAll(/\{([а-яё]+)\}/g)].map((match) => match[1]);
    entries.push({ id, group: group.id, text, where, params });
  }

  if (!entries.length) throw new Error(`${file}: реестр микрокопии пуст`);

  const seenId = new Set();
  const seenText = new Map();
  for (const entry of entries) {
    if (seenId.has(entry.id)) throw new Error(`${file}: идентификатор ${entry.id} встречается дважды`);
    seenId.add(entry.id);
    const key = entry.text.toLowerCase();
    // Один текст двумя идентификаторами — правка пройдёт только в одном месте.
    // Исключение: подсказки пустых полос карты, у них текст по смыслу общий.
    if (seenText.has(key) && !entry.id.endsWith("_EMPTY"))
      throw new Error(`${file}: текст «${entry.text}» уже стоит у ${seenText.get(key)}`);
    seenText.set(key, entry.id);
  }
  return entries;
}

/** Полосы промежуточных блоков полной карты: грубая тройка поверх пяти полос скоринга. */
const FULL_MAP_BANDS = ["низко", "середина", "высоко"];

/**
 * Добор полной карты (E5-13): `content/slices/full-map.md`.
 *
 * Формулировок вопросов в файле нет — только идентификаторы банка в порядке порций.
 * Текст, тип и варианты каждого вопроса берутся здесь из уже разобранного банка, поэтому
 * у вопроса остаётся один источник правды и калибровка банка (E5-11) не разъезжается с
 * файлом среза.
 *
 * Ось промежуточного блока — либо полоса пары шкальных вопросов (`Q1+Q2 — полоса`), либо
 * вариант категориального вопроса (`Q29 — вариант`); ключи варианта приходят из банка.
 */
function parseFullMap(bank, slices) {
  const file = "content/slices/full-map.md";
  const src = lines(read(file));
  const byId = new Map(bank.map((question) => [question.id, question]));

  const slice = slices.find((candidate) => candidate.id === "slice_full_map");
  if (!slice) throw new Error(`${file}: срез slice_full_map не описан в content/slices/README.md`);

  const h1 = src.find((line) => line.startsWith("# "));
  const title = /—\s*«(.+)»/.exec(h1 ?? "");
  if (!title) throw new Error(`${file}: в заголовке нет названия среза в «кавычках»`);

  const promiseStart = src.findIndex((line) => line.startsWith("## Что обещаем"));
  if (promiseStart < 0) throw new Error(`${file}: нет раздела «Что обещаем в оффере»`);
  const promise = [];
  for (let i = promiseStart + 1; i < src.length; i += 1) {
    if (src[i].startsWith("## ") || src[i].startsWith("---")) break;
    if (src[i].startsWith(">")) promise.push(src[i].replace(/^>\s?/, "").trim());
  }
  if (!promise.length) throw new Error(`${file}: обещание оффера не найдено`);

  // Порции: заголовок «## Порция N — M вопросов» и таблица идентификаторов под ним.
  const portions = [];
  for (let i = 0; i < src.length; i += 1) {
    const heading = /^## Порция (\d) — (\d+) вопрос/.exec(src[i]);
    if (!heading) continue;
    const number = Number(heading[1]);
    if (number !== portions.length + 1) throw new Error(`${file}: порции идут не по порядку (${number})`);

    const questions = [];
    for (const cells of tableAt(src, src.findIndex((line, j) => j > i && line.trim().startsWith("|")))) {
      const id = unwrap(cells[0] ?? "");
      if (id === "№" || !id) continue;
      const question = byId.get(id);
      if (!question) throw new Error(`${file}: вопроса ${id} нет в content/questions-full-bank.md`);
      if (!cells[1]) throw new Error(`${file}: у ${id} не сказано, зачем он в этой порции`);
      questions.push({ ...question, portion: number, why: cells[1] });
    }
    if (questions.length !== Number(heading[2]))
      throw new Error(`${file}: в порции ${number} ${questions.length} вопросов, в заголовке ${heading[2]}`);
    portions.push({ number, questions });
  }
  if (portions.length !== 3) throw new Error(`${file}: ожидались три порции, найдено ${portions.length}`);

  const order = portions.flatMap((portion) => portion.questions.map((question) => question.id));
  const seen = new Set();
  for (const id of order) {
    if (seen.has(id)) throw new Error(`${file}: вопрос ${id} записан дважды`);
    seen.add(id);
  }

  // Ни один вопрос лестницы в добор не попадает: это Закон 2, проверяется по mapping.
  const ladderIds = new Set(ladder.questions.map((question) => question.source));
  for (const id of order) {
    if (ladderIds.has(id)) throw new Error(`${file}: ${id} уже задан на лестнице, второй раз он не задаётся`);
  }
  const missing = bank.filter((question) => !ladderIds.has(question.id) && !seen.has(question.id));
  if (missing.length)
    throw new Error(`${file}: остаток банка неполный, не хватает ${missing.map((q) => q.id).join(", ")}`);

  // Промежуточные блоки: две оси и полная матрица их ключей.
  const interludes = [];
  for (let i = 0; i < src.length; i += 1) {
    const heading = /^## Промежуточный блок (\d)/.exec(src[i]);
    if (!heading) continue;
    const number = Number(heading[1]);
    const end = src.findIndex((line, j) => j > i && line.startsWith("## "));
    const section = src.slice(i, end < 0 ? undefined : end);
    const where = `${file}, блок ${number}`;

    const headingLine = section.find((line) => line.startsWith("**Заголовок блока:**"));
    if (!headingLine) throw new Error(`${where}: нет заголовка блока`);

    const axes = ["A", "B"].map((letter) => {
      const line = section.find((candidate) => candidate.startsWith(`**Ось ${letter}:**`));
      if (!line) throw new Error(`${where}: не объявлена ось ${letter}`);
      const parts = line.replace(`**Ось ${letter}:**`, "").split("·").map((part) => part.trim());
      const head = /^(Q\d+(?:\+Q\d+)*)\s*—\s*(полоса|вариант)$/.exec(parts[0] ?? "");
      if (!head) throw new Error(`${where}: не разобрана ось ${letter} — «${parts[0]}»`);
      const ids = head[1].split("+");
      for (const id of ids) {
        if (!seen.has(id)) throw new Error(`${where}: ось ${letter} стоит на ${id}, которого нет в порциях`);
        const portion = portions.find((item) => item.questions.some((question) => question.id === id));
        if (portion.number > number)
          throw new Error(`${where}: ось ${letter} стоит на ${id} из порции ${portion.number} — она ещё не задана`);
      }

      let keys;
      if (head[2] === "полоса") {
        keys = FULL_MAP_BANDS;
      } else {
        if (ids.length !== 1) throw new Error(`${where}: ось по варианту строится на одном вопросе`);
        keys = (byId.get(ids[0]).options ?? []).map((option) => option.key);
        if (keys.length < 2) throw new Error(`${where}: у ${ids[0]} нет вариантов, оси по ним не быть`);
      }

      const poles = {};
      for (const part of parts.slice(1)) {
        const pole = /^([а-яё]+):\s*(.+)$/.exec(part);
        if (!pole) throw new Error(`${where}: не разобрана подпись полюса «${part}» оси ${letter}`);
        if (!keys.includes(pole[1])) throw new Error(`${where}: подпись полюса ${pole[1]} вне ключей оси ${letter}`);
        poles[pole[1]] = pole[2];
      }

      return { ids, kind: head[2], keys, poles };
    });

    const pairs = [];
    const pairKeys = new Set();
    for (const cells of tableUnder(section, "## Промежуточный блок", where)) {
      if (cells.length !== 3 || cells[0] === "Ось A") continue;
      if (!axes[0].keys.includes(cells[0]) || !axes[1].keys.includes(cells[1])) continue;
      const key = `${cells[0]}×${cells[1]}`;
      if (pairKeys.has(key)) throw new Error(`${where}: пара ${key} записана дважды`);
      if (!cells[2]) throw new Error(`${where}: у пары ${key} нет текста`);
      pairKeys.add(key);
      pairs.push({ first: cells[0], second: cells[1], text: cells[2] });
    }
    const expected = axes[0].keys.length * axes[1].keys.length;
    if (pairs.length !== expected)
      throw new Error(`${where}: пар ${pairs.length}, а ключи осей дают ${expected} — матрица неполная`);

    interludes.push({
      number,
      heading: unwrap(headingLine.replace("**Заголовок блока:**", "").trim()),
      axes,
      pairs,
    });
  }
  if (interludes.length !== 2) throw new Error(`${file}: ожидались два промежуточных блока`);
  if (interludes.length !== portions.length - 1)
    throw new Error(`${file}: блоков должно быть на один меньше, чем порций`);

  const listSection = (heading) => {
    const start = src.findIndex((line) => line.startsWith(heading));
    if (start < 0) throw new Error(`${file}: нет раздела «${heading}»`);
    const end = src.findIndex((line, i) => i > start && line.startsWith("## "));
    return src.slice(start + 1, end < 0 ? undefined : end);
  };

  const bullets = (heading) => {
    const out = [];
    for (const line of listSection(heading)) {
      const bullet = /^- (?!\[ \])(.+)$/.exec(line.trim());
      if (bullet) out.push(bullet[1].trim());
      else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
    }
    if (!out.length) throw new Error(`${file}: раздел «${heading}» пуст`);
    return out;
  };

  const numbered = (heading) => {
    const out = [];
    for (const line of listSection(heading)) {
      const item = /^(\d+)\.\s+(.+)$/.exec(line.trim());
      if (item) out.push(item[2].trim());
      else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
    }
    if (!out.length) throw new Error(`${file}: в разделе «${heading}» нет нумерованного списка`);
    return out;
  };

  const thresholdSection = listSection("## Порог генерации");
  const checks = thresholdSection
    .map((line) => /^- \[ \]\s*(.+)$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => match[1].trim());
  const followUps = thresholdSection
    .map((line) => /^\d+\.\s*«(.+)»\.?$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => match[1].trim());
  if (checks.length < 4) throw new Error(`${file}: у порога генерации меньше четырёх пунктов`);
  if (followUps.length < 3) throw new Error(`${file}: у порога меньше трёх уточняющих вопросов`);

  const subtypes = [];
  for (const cells of tableUnder(src, "## Скоринг добора", file)) {
    const code = /^`([a-z_]+)`$/.exec(cells[0] ?? "");
    if (!code) continue;
    if (!cells[1]) throw new Error(`${file}: у подтипа ${code[1]} нет формулировки внутрь профиля`);
    subtypes.push({ code: code[1], text: cells[1] });
  }
  if (!subtypes.length) throw new Error(`${file}: в разделе «Скоринг добора» не найдено ни одного подтипа`);

  const nextDoors = [];
  for (const cells of tableUnder(src, "## Следующие двери", file)) {
    if (!cells[0] || cells[0] === "Условие в профиле" || !cells[1]) continue;
    const target = /`(slice_[a-z_]+)`/.exec(cells[1]);
    nextDoors.push({ condition: cells[0], slice: target ? target[1] : null, note: cells[1] });
  }
  if (!nextDoors.length) throw new Error(`${file}: таблица «Следующие двери» пуста`);
  if (nextDoors[nextDoors.length - 1].condition !== "иначе")
    throw new Error(`${file}: последняя строка «Следующие двери» обязана быть «иначе»`);

  return {
    slice: slice.id,
    file: "full-map.md",
    title: title[1],
    price: slice.price,
    promise: promise.join(" ").replace(/\s+/g, " ").trim(),
    portions: portions.map((portion) => ({
      number: portion.number,
      questions: portion.questions.map((question) => ({
        id: question.id,
        type: question.type,
        text: question.text,
        coordinates: question.coordinates,
        direction: question.direction,
        role: question.role,
        options: question.options,
        why: question.why,
      })),
    })),
    interludes,
    subtypes,
    threshold: { checks, followUps },
    report: numbered("## Что обязательно попадает в отчёт"),
    accuracy: bullets("## Границы точности этого среза"),
    restrictions: bullets("## Запреты этого среза"),
    nextDoors,
  };
}

/**
 * Шеринговая картинка (E5-10): `content/share.md`.
 *
 * Подписи картинки лежат отдельно от реестра микрокопии: в них нужны имя продукта и домен,
 * а это реквизиты основателя. Пока подстановка не заполнена, картинка не собирается —
 * поэтому разбор требует, чтобы имя подстановки было описано в `content/legal/README.md`.
 */
function parseShare() {
  const file = "content/share.md";
  const src = lines(read(file));
  const listed = new Set(
    [...read("content/legal/README.md").matchAll(/`\{\{([А-ЯЁA-Z_]+)\}\}`/g)].map((match) => match[1]),
  );

  const captions = [];
  for (const cells of tableUnder(src, "## Подписи картинки", file)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^SHARE_IMAGE_[A-Z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${file}: у ${id} нет текста`);
    if (!cells[2]) throw new Error(`${file}: у ${id} не сказано, где он стоит`);
    const placeholders = [...cells[1].matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1]);
    for (const name of placeholders) {
      if (!listed.has(name)) throw new Error(`${file}: подстановка {{${name}}} не описана в content/legal/README.md`);
    }
    captions.push({ id, text: cells[1], where: cells[2], placeholders });
  }
  if (!captions.length) throw new Error(`${file}: реестр подписей картинки пуст`);

  const formats = [];
  for (const cells of tableUnder(src, "## Форматы", file)) {
    const size = /^(\d{3,4})×(\d{3,4})$/.exec(cells[1] ?? "");
    if (!size) continue;
    formats.push({ name: cells[0], width: Number(size[1]), height: Number(size[2]), purpose: cells[2] ?? "" });
  }
  if (formats.length !== 2) throw new Error(`${file}: форматов должно быть два, найдено ${formats.length}`);

  const layers = [];
  for (const cells of tableUnder(src, "## Что стоит на картинке", file)) {
    if (!cells[0] || cells[0] === "Слой" || !cells[1]) continue;
    layers.push({ name: cells[0], content: cells[1], source: cells[2] ?? "" });
  }
  if (!layers.length) throw new Error(`${file}: не описано, что стоит на картинке`);

  return { layers, captions, formats };
}

/**
 * Письма (E5-07): `content/emails.md`.
 *
 * Почта — не основной носитель, и решение о её сборе не принято (открытый вопрос 6). Поэтому
 * у каждого письма обязательно поле «Без почты»: место на странице, которое говорит то же
 * самое. Письмо без такого поля — единственный носитель своего содержания, и разбор падает.
 */
function parseEmails() {
  const file = "content/emails.md";
  const src = lines(read(file));

  const emails = [];
  for (let i = 0; i < src.length; i += 1) {
    const heading = /^## (EMAIL_[A-Z_]+) · (.+)$/.exec(src[i]);
    if (!heading) continue;
    const [, id, title] = heading;
    const end = src.findIndex((line, j) => j > i && line.startsWith("## "));
    const section = src.slice(i, end < 0 ? undefined : end);

    const field = (label) => {
      const line = section.find((candidate) => candidate.startsWith(`**${label}:**`));
      if (!line) throw new Error(`${file}: у ${id} нет поля «${label}»`);
      const value = line.replace(`**${label}:**`, "").trim();
      if (!value) throw new Error(`${file}: у ${id} пустое поле «${label}»`);
      return value;
    };

    const subject = field("Тема");
    if (subject.endsWith(".")) throw new Error(`${file}: тема ${id} заканчивается точкой`);

    const body = [];
    for (const line of section) {
      if (!line.startsWith(">")) continue;
      const text = line.replace(/^>\s?/, "").trim();
      if (text) body.push(text);
    }
    if (body.length < 2) throw new Error(`${file}: у ${id} меньше двух абзацев тела`);

    emails.push({ id, title, when: field("Когда"), subject, withoutEmail: field("Без почты"), body });
  }
  if (!emails.length) throw new Error(`${file}: не найдено ни одного письма`);

  const footer = [];
  for (const cells of tableUnder(src, "## Общие части подвала", file)) {
    const id = unwrap(cells[0] ?? "");
    if (!/^EMAIL_FOOTER_[A-Z_]+$/.test(id)) continue;
    if (!cells[1]) throw new Error(`${file}: у ${id} нет текста`);
    const where = (cells[2] ?? "")
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!where.length) throw new Error(`${file}: у ${id} не указано, где он показывается`);
    footer.push({ id, text: cells[1], where });
  }
  if (!footer.length) throw new Error(`${file}: реестр общих частей подвала пуст`);

  const params = (text) => [...text.matchAll(/\{([а-яё]+)\}/g)].map((match) => match[1]);
  for (const email of emails) {
    email.params = [...new Set([...params(email.subject), ...email.body.flatMap(params)])];
  }

  const seen = new Set();
  for (const entry of [...emails, ...footer]) {
    if (seen.has(entry.id)) throw new Error(`${file}: идентификатор ${entry.id} встречается дважды`);
    seen.add(entry.id);
  }

  return { emails, footer };
}

/**
 * Экраны оплаты (E5-09): раздел «Экран оплаты» в каждом файле среза.
 *
 * Обещание на экране — то же, что в оффере, поэтому здесь оно не переписывается: в разделе
 * живёт только состав и отказ. Цены в разделе нет намеренно — на экране она одна и приходит
 * из шапки файла, второй записи ей быть негде (`docs/11-ui-page-spec.md`).
 */
function parsePayScreens(slices, fullMap) {
  const HEADING = "## Экран оплаты";
  const known = [
    ...slices.filter((slice) => slice.file).map((slice) => ({ id: slice.id, file: slice.file, promise: slice.promise, price: slice.price })),
    { id: fullMap.slice, file: fullMap.file, promise: fullMap.promise, price: fullMap.price },
  ];

  const out = [];
  for (const slice of known) {
    const path = `content/slices/${slice.file}`;
    const src = lines(read(path));
    const start = src.findIndex((line) => line.startsWith(HEADING));
    if (start < 0) throw new Error(`${path}: нет раздела «Экран оплаты» — срез нельзя показать на оплате`);
    const end = src.findIndex((line, i) => i > start && line.startsWith("## "));
    const section = src.slice(start, end < 0 ? undefined : end);

    const field = (label) => {
      const line = section.find((candidate) => candidate.startsWith(`**${label}:**`));
      if (!line) throw new Error(`${path}: в разделе «Экран оплаты» нет строки «${label}»`);
      return line.replace(`**${label}:**`, "").trim();
    };

    const contents = field("Что внутри")
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (contents.length < 3) throw new Error(`${path}: в составе меньше трёх частей — это уже не состав`);
    const decline = field("Отказ");

    for (const text of [...contents, decline]) {
      if (/₽|\bруб/.test(text)) throw new Error(`${path}: цена записана в тексте экрана, а на экране она одна`);
    }

    out.push({ slice: slice.id, file: slice.file, price: slice.price, promise: slice.promise, contents, decline });
  }

  if (!out.length) throw new Error("content/slices: ни одного экрана оплаты");
  return out;
}

/**
 * Имя, домен и пути к логотипу. ORIGIN обязан быть https://DOMAIN без пути:
 * иначе постоянные ссылки и подпись на картинке разъедутся.
 */
function parseIdentity() {
  const file = "content/identity.md";
  const src = lines(read(file));
  const map = {};
  for (const cells of tableUnder(src, "## Реквизиты", file)) {
    const key = unwrap(cells[0] ?? "");
    if (!/^[A-Z_]+$/.test(key)) continue;
    const value = (cells[1] ?? "").trim();
    if (!value) throw new Error(`${file}: у ${key} нет значения`);
    map[key] = value;
  }
  const required = ["PRODUCT_NAME_RU", "PRODUCT_NAME_EN", "DOMAIN", "ORIGIN", "LOGO_MARK", "LOGO_WORDMARK"];
  for (const key of required) {
    if (!map[key]) throw new Error(`${file}: нет ключа ${key}`);
  }
  let origin;
  try {
    origin = new URL(map.ORIGIN);
  } catch {
    throw new Error(`${file}: ORIGIN не является адресом`);
  }
  if (origin.protocol !== "https:") throw new Error(`${file}: ORIGIN должен быть https`);
  if (origin.pathname !== "/" && origin.pathname !== "") throw new Error(`${file}: ORIGIN не должен содержать путь`);
  if (origin.host !== map.DOMAIN) throw new Error(`${file}: хост ORIGIN обязан совпадать с DOMAIN`);
  if (!map.LOGO_MARK.startsWith("/web/assets/") || !map.LOGO_WORDMARK.startsWith("/web/assets/")) {
    throw new Error(`${file}: логотип должен жить в /web/assets/`);
  }
  return {
    nameRu: map.PRODUCT_NAME_RU,
    nameEn: map.PRODUCT_NAME_EN,
    domain: map.DOMAIN,
    origin: map.ORIGIN.replace(/\/+$/, ""),
    logoMark: map.LOGO_MARK,
    logoWordmark: map.LOGO_WORDMARK,
  };
}

const extra = {
  interludes: parseSliceInterludes(content.slices),
  doors: parseDoorLabels(),
  disclaimers: parseDisclaimers(),
  forbidden: parseForbidden(),
  crisis: parseCrisis(),
  uiCopy: parseUiCopy(),
  fullMap: parseFullMap(content.bank, content.slices),
};
extra.payScreens = parsePayScreens(content.slices, extra.fullMap);
extra.emails = parseEmails();
extra.share = parseShare();
extra.identity = parseIdentity();

writeFileSync(
  join(outDir, "content-extra.ts"),
  `// СГЕНЕРИРОВАНО из content/slices/*.md, content/doors.md, content/legal/, content/forbidden.md, content/crisis.md, content/ui-copy.md, content/emails.md, content/share.md, content/identity.md — не редактировать.\n` +
    `// Источник правды — markdown. Пересборка: npm run build:content\n\n` +
    `import type { RawExtraContent } from "../content-extra-types.js";\n\n` +
    `export const rawExtraContent: RawExtraContent = ${JSON.stringify(extra, null, 2)};\n`,
  "utf8",
);

console.log(
  `content-extra.ts собран: ${extra.interludes.length} промежуточных блоков ` +
    `(${extra.interludes.reduce((sum, item) => sum + item.pairs.length, 0)} пар), ` +
    `${Object.keys(extra.doors.nodes).length} подписей дверей по узлам, ` +
    `${Object.keys(extra.doors.slices).length} по срезам, ${extra.disclaimers.length} дисклеймеров, ` +
    `реестр запретов: ${extra.forbidden.groups.length} групп, ` +
    `${extra.forbidden.groups.reduce((sum, group) => sum + group.entries.flatMap((entry) => entry.forms).length, 0)} форм, ` +
    `кризис: ${extra.crisis.triggers.length} категорий триггеров, ${extra.crisis.texts.length} текстов, ` +
    `микрокопия: ${extra.uiCopy.length} строк в ${new Set(extra.uiCopy.map((item) => item.group)).size} группах, ` +
    `полная карта: ${extra.fullMap.portions.reduce((sum, portion) => sum + portion.questions.length, 0)} вопросов ` +
    `в ${extra.fullMap.portions.length} порциях, ${extra.fullMap.interludes.reduce((sum, item) => sum + item.pairs.length, 0)} пар в блоках, ` +
    `${extra.payScreens.length} экранов оплаты, ` +
    `письма: ${extra.emails.emails.length} писем и ${extra.emails.footer.length} общих частей подвала, ` +
    `шеринг: ${extra.share.captions.length} подписей картинки в ${extra.share.formats.length} форматах`,
);
