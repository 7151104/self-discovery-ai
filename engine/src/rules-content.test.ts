/**
 * E2-12: сверка правил кода с их строками в контенте.
 *
 * Ни одно правило скоринга не должно существовать только в коде. Каждая
 * таблица `content/scoring-rules.md` и каждый раздел файла среза сверяется
 * здесь построчно: удалили строку правила — тест падает и показывает, что
 * именно разошлось. Числа строк проверяются отдельно, иначе удаление
 * последней строки таблицы прошло бы незамеченным.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDisagreement,
  bandFromMean,
  buildProfile,
  buildProfileFromBank,
  checkThreshold,
  nextSliceAfter,
  rawContent,
  sameSubtype,
  scoreCoordinate,
  sliceOwnedCodes,
  subtypeRegistry,
  DISAGREEMENT_RULES,
  LADDER_CAP,
  SCORED_SLICES,
} from "./index.js";
import { applySlice } from "./slices.js";
import { applyNodes } from "./nodes.js";
import { demoProfile, sliceAnswers } from "./slice-fixtures.js";
import type { BankAnswers, Confidence, DisagreementKind, LadderAnswers, Profile } from "./types.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const rules = repoFile("content/scoring-rules.md");
const sliceFile = (slice: string): string => {
  const file = rawContent.slices.find((candidate) => candidate.id === slice)?.file;
  if (!file) throw new Error(`${slice}: у среза нет файла`);
  return repoFile(`content/slices/${file}`);
};

/**
 * Первая таблица после метки: строки без шапки и без разделителя. Шапка
 * сверяется по первой колонке — иначе её удаление съело бы строку правила молча.
 */
function tableAfter(source: string, marker: string, header?: string): string[][] {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `в контенте нет раздела «${marker}»`);

  const rows: string[][] = [];
  for (const line of source.slice(start).split("\n").slice(1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (rows.length) break;
      continue;
    }
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push(cells);
  }

  assert.ok(rows.length > 1, `таблица после «${marker}» пуста`);
  if (header !== undefined) assert.equal(rows[0]?.[0], header, `у таблицы «${marker}» пропала или изменилась шапка`);
  return rows.slice(1);
}

const numbersIn = (cell: string): number[] =>
  cell
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value));

const ladderAnswers: LadderAnswers = {
  L1: "B",
  L2: "C",
  L3: "A",
  L4: "B",
  L5: "D",
  L6: 5,
  L7: 2,
  L8: "A",
  L9: 5,
  L10: 4,
  L11: 4,
  L12: "Тащу всё сам и бросаю у финиша.",
};

const bankAnswers = ((): BankAnswers => {
  const answers: BankAnswers = {};
  for (const line of repoFile("examples/demo-person-answers.md").split("\n")) {
    const row = /^\|\s*(\d+)\s*\|\s*([A-G]|[1-5])\s*\|$/.exec(line.trim());
    if (!row) continue;
    const value = row[2] ?? "";
    answers[`Q${row[1]}`] = /^[1-5]$/.test(value) ? (Number(value) as 1 | 2 | 3 | 4 | 5) : value;
  }
  return answers;
})();

const ladderProfile = (): Profile => applyNodes(buildProfile(ladderAnswers), ladderAnswers);

/**
 * Лестница заполняет часть координат только при определённых ответах: например
 * координату 4 — когда L5 = A или C. Поэтому «лестница закрывает координату»
 * проверяется по нескольким наборам ответов, а не по одному демо-человеку.
 */
const ladderVariants = (): Profile[] =>
  (["A", "B", "C", "D"] as const).flatMap((l5) =>
    (["C", "E"] as const).map((l2) => buildProfile({ ...ladderAnswers, L5: l5, L2: l2 })),
  );

// ── Общая арифметика ──────────────────────────────────────────────────────────

test("таблица «Среднее → полоса» описывает ровно то, что считает bandFromMean", () => {
  const rows = tableAfter(rules, "Среднее → полоса:", "Среднее");
  const bands: Record<string, string> = {
    низкая: "low",
    "скорее низкая": "mid-low",
    середина: "mid",
    "скорее высокая": "mid-high",
    высокая: "high",
  };

  const covered = new Set<string>();
  for (const [range, band] of rows) {
    const bounds = /^([\d.]+)–([\d.]+)$/.exec(range ?? "");
    assert.ok(bounds, `не разобран диапазон «${range}»`);
    const expected = bands[band ?? ""];
    assert.ok(expected, `в коде нет полосы «${band}»`);
    covered.add(expected);

    for (let value = Number(bounds[1]); value <= Number(bounds[2]) + 1e-9; value += 0.1) {
      const mean = Number(value.toFixed(1));
      assert.equal(bandFromMean(mean), expected, `среднее ${mean} по контенту даёт «${band}»`);
    }
  }

  assert.equal(covered.size, 5, "в контенте описаны не все пять полос");
  assert.equal(rows.length, 5, "строк в таблице полос стало другое число");
});

test("таблица «Mapping L-вопросов лестницы» совпадает с координатами вопросов", () => {
  const rows = tableAfter(rules, "## Mapping L-вопросов лестницы", "L");
  assert.equal(rows.length, rawContent.questions.length, "в таблице соответствий не все вопросы лестницы");

  for (const [ladder, bank, coordinates] of rows) {
    const question = rawContent.questions.find((candidate) => candidate.id === ladder);
    assert.ok(question, `в лестнице нет вопроса ${ladder}`);
    assert.deepEqual(question.coordinates, numbersIn(coordinates ?? ""), `${ladder}: координаты разошлись`);
    assert.ok(
      bank === "О1" || rawContent.bank.some((candidate) => candidate.id === bank),
      `${ladder}: в банке нет вопроса ${bank}`,
    );
  }
});

// ── Лестница ──────────────────────────────────────────────────────────────────

test("таблица «Что лестница закрывает и что нет» совпадает с профилем и потолками", () => {
  const rows = tableAfter(rules, "### Что лестница закрывает и что нет", "Координаты");
  const variants = ladderVariants();
  const described = new Set<number>();

  for (const [ids, source, cap] of rows) {
    for (const id of numbersIn(ids ?? "")) {
      described.add(id);
      const filled = variants.find((candidate) => (candidate.coordinates[id]?.sources.length ?? 0) > 0);

      if (source === "нет") {
        assert.equal(filled, undefined, `координата ${id} записана закрытой, а лестница её заполняет`);
        assert.equal(cap, "**unknown**");
        continue;
      }

      // 15 приходит из синтеза открытого ответа, а не из арифметики лестницы.
      if (id !== 15) {
        assert.ok(filled, `координата ${id} описана, но ни при каких ответах лестницы не заполняется`);
        for (const question of source?.match(/L\d+/g) ?? []) {
          assert.ok(
            variants.some((candidate) =>
              (candidate.coordinates[id]?.sources ?? []).some((used) => used.startsWith(`${question}:`)),
            ),
            `координата ${id}: ${question} назван источником, но в профиль не попадает`,
          );
        }
      }

      const expected = (cap ?? "").startsWith("high") ? undefined : (cap as Confidence);
      assert.equal(LADDER_CAP[id], expected, `координата ${id}: потолок в коде и в контенте разошёлся`);
    }
  }

  assert.equal(described.size, 16, "таблица обязана описывать все 16 координат");
});

test("таблица подтверждений уязвимости покрывает все варианты L8", () => {
  const rows = tableAfter(rules, "### Подтверждение уязвимости (координата 8)", "L8");
  const options = rawContent.questions.find((question) => question.id === "L8")?.options ?? [];

  assert.equal(rows.length, options.length, "вариантов уязвимости и строк подтверждения разное число");
  for (const [row] of rows) {
    const key = (row ?? "").split("—")[0]?.trim();
    assert.ok(
      options.some((option) => option.key === key),
      `в вопросе L8 нет варианта ${key}`,
    );
  }

  // Строка «A — не воспринимают всерьёз ← L4 = A или E» обязана работать.
  const withSupport = buildProfile({ ...ladderAnswers, L8: "A", L4: "A" });
  const withoutSupport = buildProfile({ ...ladderAnswers, L8: "A", L4: "D" });
  assert.equal(withSupport.coordinates[8]?.confidence, "high");
  assert.equal(withoutSupport.coordinates[8]?.confidence, "medium");
});

test("таблица «Согласие и конфликт по парам» описывает координаты с двумя источниками", () => {
  const rows = tableAfter(rules, "### Согласие и конфликт по парам", "Координата");
  const profile = ladderProfile();
  const paired = Object.values(profile.coordinates)
    .filter((coordinate) => coordinate.sources.length >= 2)
    .map((coordinate) => coordinate.id)
    .sort((left, right) => left - right);

  assert.deepEqual(
    rows.map((cells) => Number(cells[0])).sort((left, right) => left - right),
    paired,
    "у координаты с парой ответов обязана быть строка про согласие и конфликт",
  );
});

// ── Полный банк ───────────────────────────────────────────────────────────────

test("четыре вида ответа банка ведут себя так, как записано в таблице", () => {
  const rows = tableAfter(rules, "### Как ответ попадает в координату", "Вид ответа");

  /** Что обязан делать каждый вид ответа. Ключ — первая колонка строки таблицы. */
  const behaviour: Record<string, () => void> = {
    "Основной шкальный вопрос координаты": () => {
      // Q2 в банке обратный: ответ 5 обязан войти в среднее как 1.
      const direct = scoreCoordinate([{ kind: "шкала", question: "Q1", value: 5, reversed: false }])!;
      const reversed = scoreCoordinate([{ kind: "шкала", question: "Q2", value: 5, reversed: true }])!;
      assert.equal(direct.mean, 5);
      assert.equal(reversed.mean, 1);
    },
    "Дополняющий шкальный вопрос (координата у него не первая)": () => {
      const alone = scoreCoordinate([{ kind: "шкала", question: "Q17", value: 4, reversed: false }])!;
      const withSupport = scoreCoordinate([
        { kind: "шкала", question: "Q17", value: 4, reversed: false },
        { kind: "указание", question: "Q14", answer: "2", direction: -1, selfReport: true },
      ])!;
      assert.equal(withSupport.mean, alone.mean, "дополняющий ответ в среднее попадать не должен");
      assert.ok(withSupport.sources.includes("Q14:2"), "но стороной он голосует");
    },
    "Категориальный вопрос": () => {
      const key = scoreCoordinate([
        { kind: "шкала", question: "Q23", value: 5, reversed: false },
        { kind: "указание", question: "Q24", answer: "E", direction: -1, key: true },
      ])!;
      assert.equal(key.direction, -1, "ключевой категориальный задаёт сторону вопреки шкале");
      assert.deepEqual(key.selfReportConflicts, ["Q23:5"], "спорящая шкала уходит в расхождение");
    },
    "Открытый ответ": () => {
      const profile = buildProfileFromBank(bankAnswers);
      assert.equal(profile.coordinates[15]?.sources.length, 0);
      assert.equal(profile.coordinates[16]?.sources.length, 0);
    },
  };

  assert.deepEqual(
    rows.map((cells) => cells[0]).sort(),
    Object.keys(behaviour).sort(),
    "виды ответа в контенте и в коде разошлись",
  );
  for (const [kind, check] of Object.entries(behaviour)) check();
});

test("четыре вида ответа добора ведут себя так, как записано в таблице", () => {
  const rows = tableAfter(rules, "### Как ответ добора попадает в координату", "Вид ответа");
  const slice = "slice_node_finish";

  const behaviour: Record<string, () => void> = {
    "Ответ, по которому определяется подтип": () => {
      const before = demoProfile();
      const after = applySlice(slice, before, sliceAnswers(slice));
      assert.notEqual(after.coordinates[11]?.code, before.coordinates[11]?.code, "подтип обязан задать код координаты");
      assert.ok(
        after.coordinates[11]?.sources.some((source) => source.startsWith(`${slice}:S`)),
        "решающий ответ добора обязан попасть в источники",
      );
    },
    "Подтверждающий ответ": () => {
      const before = demoProfile();
      const answers = sliceAnswers(slice);
      // S1 определяет подтип, остальные только подтверждают: без S1 код не меняется.
      const withoutKey = { ...answers, S1: undefined };
      const after = applySlice(slice, before, withoutKey);
      assert.equal(after.coordinates[11]?.code, before.coordinates[11]?.code, "подтверждающий ответ код не меняет");
    },
    "Прежнее чтение координаты (лестница, банк)": () => {
      // at_80 из лестницы и pre_show_polish из добора — одна линия словаря.
      assert.ok(sameSubtype("pre_show_polish", "at_80"));
      const after = applySlice(slice, demoProfile(), sliceAnswers(slice));
      assert.equal(after.coordinates[11]?.confidence, "high", "согласное прежнее чтение поднимает уверенность");
    },
    "Открытый ответ": () => {
      // Три типа зависания из slice_decision_moment опираются на открытые ответы:
      // движок их не выводит, они приходят разобранными.
      const answers = sliceAnswers("slice_decision_moment");
      const codesOf = (profile: Profile): string[] => profile.configurations.map((item) => item.code);

      const withoutText = applySlice("slice_decision_moment", demoProfile(), answers);
      const withText = applySlice("slice_decision_moment", demoProfile(), answers, { codes: ["permission_seeking"] });

      assert.ok(!codesOf(withoutText).includes("permission_seeking"), "движок открытый текст сам не читает");
      assert.ok(codesOf(withText).includes("permission_seeking"), "разобранный текст приходит отдельным входом");
    },
  };

  assert.deepEqual(
    rows.map((cells) => cells[0]).sort(),
    Object.keys(behaviour).sort(),
    "виды ответа добора в контенте и в коде разошлись",
  );
  for (const check of Object.values(behaviour)) check();
});

test("таблица «Что даёт каждая координата» описывает все 16 и называет существующие вопросы", () => {
  const rows = tableAfter(rules, "### Что даёт каждая координата", "Координата");
  const profile = buildProfileFromBank(bankAnswers);

  assert.equal(rows.length, 16, "в таблице банка описаны не все координаты");
  for (const [id, mean, pointers] of rows) {
    const coordinate = Number(id);
    const named = [...(mean ?? "").matchAll(/Q\d+/g), ...(pointers ?? "").matchAll(/Q\d+/g)].map((match) => match[0]);

    if (!named.length) {
      assert.ok([15, 16].includes(coordinate), `координата ${coordinate} без вопросов — так бывает только у 15 и 16`);
      assert.equal(profile.coordinates[coordinate]?.sources.length, 0);
      continue;
    }

    assert.ok(profile.coordinates[coordinate]?.sources.length, `банк не заполнил координату ${coordinate}`);
    for (const question of named) {
      const bank = rawContent.bank.find((candidate) => candidate.id === question);
      assert.ok(bank, `в банке нет вопроса ${question}`);
      assert.ok(
        bank.coordinates.includes(coordinate),
        `${question} записан в координату ${coordinate}, а в банке у него координаты ${bank.coordinates.join(", ")}`,
      );
    }
  }
});

test("таблица «Куда указывают варианты» работает как записана", () => {
  const rows = tableAfter(rules, "**Куда указывают варианты.**", "Вопрос");
  assert.equal(rows.length, 4, "строк с направлениями вариантов стало другое число");

  const side = (coordinate: number, question: string, answer: string): string | null =>
    buildProfileFromBank({ ...bankAnswers, [question]: answer }).coordinates[coordinate]?.code ?? null;

  for (const [row, high, low] of rows) {
    const parsed = /^(Q\d+) в координате (\d+)$/.exec(row ?? "");
    assert.ok(parsed, `не разобрана строка «${row}»`);
    const question = parsed[1]!;
    const coordinate = Number(parsed[2]);

    for (const cell of [high, low]) {
      for (const key of (cell ?? "").split(",").map((part) => part.trim())) {
        if (!/^[A-G]$/.test(key)) continue;
        assert.ok(
          side(coordinate, question, key) !== null,
          `${question}=${key}: координата ${coordinate} осталась без кода`,
        );
      }
    }
  }
});

test("таблица категорий координаты 14 совпадает с тем, что считает движок", () => {
  const rows = tableAfter(rules, "**Координата 14 — категориальная.**", "Категория");
  assert.equal(rows.length, 4, "категорий координаты 14 стало другое число");

  const values = new Set(
    rows.map((cells) => cells[0]).filter((value): value is string => typeof value === "string"),
  );
  const produced = buildProfileFromBank(bankAnswers).coordinates[14]?.value;
  assert.ok(produced && values.has(produced), `движок выдал категорию «${produced}», которой нет в таблице`);
});

// ── Доборы срезов ─────────────────────────────────────────────────────────────

test("подтипы каждого среза в коде и в его файле совпадают построчно", () => {
  for (const slice of SCORED_SLICES) {
    const inContent = rawContent.slices.find((candidate) => candidate.id === slice)?.subtypes ?? [];
    const inCode = Object.keys(sliceOwnedCodes(slice)).sort();

    assert.deepEqual(
      inContent.map((subtype) => subtype.code).sort(),
      inCode,
      `${slice}: состав подтипов в коде и в файле среза разошёлся`,
    );
    for (const subtype of inContent) {
      assert.ok(sliceFile(slice).includes(`\`${subtype.code}\``), `${slice}: код ${subtype.code} не назван в файле`);
    }
  }
});

test("у каждого пункта порога и каждой двери среза есть строка в его файле", () => {
  for (const slice of SCORED_SLICES) {
    const content = rawContent.slices.find((candidate) => candidate.id === slice)!;
    const profile = demoProfile();
    const answers = sliceAnswers(slice);

    // checkThreshold падает сам, если число условий в коде разошлось с чек-листом.
    const threshold = checkThreshold(slice, applySlice(slice, profile, answers), answers, {}, profile);
    assert.ok(content.threshold!.checks.length > 0, `${slice}: у порога нет пунктов`);
    assert.ok(content.threshold!.followUps.length > 0, `${slice}: у порога нет уточняющих вопросов`);
    for (const missing of threshold.missing) {
      assert.ok(content.threshold!.checks.includes(missing), `${slice}: невзятый пункт «${missing}» не из контента`);
    }

    const next = nextSliceAfter(slice, profile, answers);
    assert.ok(
      content.nextDoors.some((door) => door.slice === next),
      `${slice}: выбранная дверь ${next} не записана в таблице «Следующие двери»`,
    );
  }
});

test("таблица единого словаря подтипов совпадает с картой уточнений в коде", () => {
  const rows = tableAfter(rules, "### Единый словарь подтипов", "Координата");
  const refining = subtypeRegistry().filter((entry) => entry.refines !== null);
  const described = new Set<string>();

  const expect = (id: number, code: string, coarse: string): void => {
    described.add(code);
    const entry = refining.find((candidate) => candidate.code === code && candidate.coordinate === id);
    assert.ok(entry, `код ${code} записан уточнением координаты ${id}, а в коде такой связи нет`);
    assert.equal(entry.refines, coarse, `${code}: в коде уточняет ${entry.refines}, в контенте — ${coarse}`);
  };

  for (const [coordinate, coarseCell, refinements] of rows) {
    const id = Number(coordinate);
    const coarse = (coarseCell ?? "").replace(/`/g, "");

    // Запись «`код` (→ `уточнение`)» — второй шаг той же линии.
    for (const part of (refinements ?? "").split(",")) {
      const chain = [...part.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!);
      if (!chain.length) continue;
      expect(id, chain[0]!, coarse);
      for (let step = 1; step < chain.length; step += 1) expect(id, chain[step]!, chain[step - 1]!);
    }
  }

  for (const entry of refining) {
    assert.ok(
      described.has(entry.code),
      `код ${entry.code} уточняет ${entry.refines}, но строки в «Едином словаре подтипов» у него нет`,
    );
  }
});

test("коды, которыми контент описывает профиль, существуют в едином словаре", () => {
  const rows = tableAfter(sliceFile("slice_decision_moment"), "**Применение профиля (главное в срезе).**", "Профиль");
  const registry = subtypeRegistry();

  // Флаги координат: собираются из тех же наборов доборов, что и в тесте флагов.
  const flagsOf = new Map<number, Set<string>>();
  for (const slice of SCORED_SLICES) {
    const profile = applySlice(slice, demoProfile(), sliceAnswers(slice));
    for (const coordinate of Object.values(profile.coordinates)) {
      const known = flagsOf.get(coordinate.id) ?? new Set<string>();
      for (const flag of coordinate.flags) known.add(flag);
      flagsOf.set(coordinate.id, known);
    }
  }

  let checked = 0;
  for (const [profileCell] of rows) {
    const parsed = /^(\d+) = `([a-z_]+)`/.exec(profileCell ?? "");
    if (!parsed) continue;
    checked += 1;
    const coordinate = Number(parsed[1]);
    const code = parsed[2]!;

    const known =
      registry.some((entry) => entry.code === code && entry.coordinate === coordinate) ||
      (flagsOf.get(coordinate)?.has(code) ?? false);
    assert.ok(known, `координата ${coordinate}: ни подтипа, ни флага ${code} движок не ставит`);
  }

  assert.ok(checked >= 5, "в таблице профиля не нашлось строк с кодами — разбор сломался");
});

// ── Флаги ─────────────────────────────────────────────────────────────────────

test("каждый флаг, который движок умеет ставить, назван в контенте", () => {
  const texts = [rules, ...SCORED_SLICES.map(sliceFile)].join("\n");

  const flags = new Set<string>();
  const collect = (profile: Profile): void => {
    for (const flag of profile.flags) flags.add(flag);
    for (const coordinate of Object.values(profile.coordinates)) for (const flag of coordinate.flags) flags.add(flag);
  };

  collect(ladderProfile());
  collect(buildProfile({ ...ladderAnswers, L2: "E", L11: 5 }));
  collect(buildProfileFromBank(bankAnswers));
  collect(buildProfileFromBank({ ...bankAnswers, Q12: 5, Q13: 5, Q23: 5, Q24: "C" }));
  for (const slice of SCORED_SLICES) collect(applySlice(slice, demoProfile(), sliceAnswers(slice)));
  for (const kind of Object.keys(DISAGREEMENT_RULES) as DisagreementKind[]) {
    for (const step of [1, 2, 3] as const) collect(applyDisagreement(ladderProfile(), { step, kind }));
  }

  assert.ok(flags.size > 5, "флагов собралось подозрительно мало");
  for (const flag of flags) {
    const generic = flag.replace(/_\d+$/, "");
    const named =
      texts.includes(flag) ||
      texts.includes(`${generic}_{номер координаты}`) ||
      texts.includes(`${generic}_{ступень}`) ||
      texts.includes(generic);
    assert.ok(named, `флаг ${flag} существует только в коде`);
  }
});