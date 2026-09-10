/**
 * E2-04: скоринг доборов, подтипы координат и флаги.
 *
 * На каждый срез — подготовленный набор ответов с ожидаемым подтипом и флагом.
 * Отдельно сверяется состав подтипов: код знает ровно те, что записаны в файле
 * среза, и ни одного своего.
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { rawContent } from "./generated/content.js";
import { applySlice, sameSubtype, sliceOwnedCodes, subtypeRegistry, SCORED_SLICES } from "./slices.js";
import { demoProfile, sliceAnswers, textLonger } from "./slice-fixtures.js";
import type { Profile, SliceAnswers } from "./types.js";

const repoFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const sliceFile = (slice: string): string => {
  const found = rawContent.slices.find((candidate) => candidate.id === slice);
  assert.ok(found?.file, `${slice}: нет файла среза`);
  return repoFile(`content/slices/${found?.file}`);
};

const coordinate = (profile: Profile, id: number) => {
  const state = profile.coordinates[id];
  assert.ok(state, `нет координаты ${id}`);
  return state;
};

test("правила скоринга есть у всех восьми срезов с доборами", () => {
  const withFile = rawContent.slices.filter((slice) => slice.file).map((slice) => slice.id);
  assert.deepEqual([...SCORED_SLICES].sort(), [...withFile].sort());
});

test("состав подтипов в коде совпадает с текстом файла среза", () => {
  for (const slice of SCORED_SLICES) {
    const inContent = (rawContent.slices.find((candidate) => candidate.id === slice)?.subtypes ?? []).map(
      (subtype) => subtype.code,
    );
    const inCode = Object.keys(sliceOwnedCodes(slice));
    assert.deepEqual([...inCode].sort(), [...inContent].sort(), `${slice}: подтипы кода и контента разошлись`);

    // Каждый подтип упомянут в файле среза машинным кодом в обратных кавычках.
    const source = sliceFile(slice);
    for (const code of inCode) {
      assert.ok(source.includes(`\`${code}\``), `${slice}: подтипа ${code} нет в файле среза`);
    }
  }
});

test("каждый флаг из кода назван в файле своего среза", () => {
  const flagsOf = (slice: string): string[] => {
    const before = demoProfile();
    const after = applySlice(slice, before, sliceAnswers(slice));
    return after.flags.filter((flag) => !before.flags.includes(flag));
  };

  for (const slice of SCORED_SLICES) {
    const source = sliceFile(slice);
    for (const flag of flagsOf(slice)) {
      assert.ok(source.includes(`\`${flag}\``), `${slice}: флаг ${flag} не назван в файле среза`);
    }
  }
});

test("единый словарь подтипов: у каждого кода одна координата и известное уточнение", () => {
  const registry = subtypeRegistry();
  const pairs = new Set<string>();
  const bySlice = new Map<string, number | null>();

  for (const entry of registry) {
    const pair = `${entry.coordinate}:${entry.code}`;
    assert.ok(!pairs.has(pair), `код ${entry.code} записан на координату ${entry.coordinate} дважды`);
    pairs.add(pair);

    // Код полюса «оба режима по ситуации» общий для осей; подтип среза — нет.
    if (entry.source !== "ядро") {
      assert.ok(!bySlice.has(entry.code), `подтип ${entry.code} объявлен в двух срезах`);
      bySlice.set(entry.code, entry.coordinate);
    }
    assert.ok(entry.value.length > 3, `${entry.code}: нет формулировки`);
    if (!entry.refines) continue;
    const parent = registry.find((candidate) => candidate.code === entry.refines);
    assert.ok(parent, `${entry.code}: уточняет неизвестный код ${entry.refines}`);
    assert.equal(parent?.coordinate, entry.coordinate, `${entry.code}: уточняет код другой координаты`);
  }
});

test("словарь сводит разную точность координаты 13 у лестницы, банка и добора", () => {
  // Лестница знает только «нужен внешний срок», банк — вариант Q29,
  // добор — конкретный пусковой механизм. Это одно положение, а не три.
  assert.ok(sameSubtype("needs_external_pull", "on_request"));
  assert.ok(sameSubtype("needs_external_pull", "responds_to_request"));
  assert.ok(sameSubtype("on_request", "responds_to_request"));
  assert.ok(!sameSubtype("self_starting", "responds_to_request"));

  // Координата 14: банк называл режим «analysis», срез — «analytic».
  assert.ok(sameSubtype("analysis", "analytic"));
  assert.ok(!sameSubtype("analysis", "pressure_gated"));
  assert.ok(sameSubtype("at_80", "pre_show_plan"));
  assert.ok(sameSubtype("releases", "slow_short"));
  assert.ok(sameSubtype("releases", "fast_short"));
});

test("slice_node_finish: обрыв до показа с укрытием в доработке и флаг рационализации", () => {
  const profile = applySlice("slice_node_finish", demoProfile(), sliceAnswers("slice_node_finish"));

  assert.equal(coordinate(profile, 11).code, "pre_show_polish");
  assert.equal(coordinate(profile, 11).confidence, "high");
  assert.ok(coordinate(profile, 11).flags.includes("rationalized_polish"));
  // S7=A подтверждает выбранную в L8 уязвимость: координата 8 поднимается.
  assert.equal(coordinate(profile, 8).confidence, "high");
});

test("slice_node_finish: без адреса страха координата 8 не поднимается выше medium", () => {
  const answers = { ...sliceAnswers("slice_node_finish"), S7: "D" };
  const profile = applySlice("slice_node_finish", demoProfile(), answers);
  assert.equal(coordinate(profile, 8).confidence, "medium");
});

test("slice_motivation: пусковой механизм и расхождение с самооценкой", () => {
  const profile = applySlice("slice_motivation", demoProfile(), sliceAnswers("slice_motivation"));

  assert.equal(coordinate(profile, 13).code, "responds_to_request");
  assert.ok(profile.flags.includes("self_report_mismatch_11"));
  // Мотив назван, но подтверждение открытым текстом считает LLM: потолок medium.
  assert.equal(coordinate(profile, 10).code, "closeness");
  assert.equal(coordinate(profile, 10).confidence, "medium");
});

test("slice_stress: клапана нет, ранний сигнал не различается", () => {
  const profile = applySlice("slice_stress", demoProfile(), sliceAnswers("slice_stress"));

  assert.equal(coordinate(profile, 12).code, "no_outlet");
  assert.ok(coordinate(profile, 7).flags.includes("no_early_signal"));
  // S1 и S2 стоят в той же активной стойке, что и код координаты 9.
  assert.equal(coordinate(profile, 9).confidence, "high");
});

test("slice_stress: несогласие S4 и S5 даёт «не умею отказывать» и флаг расхождения", () => {
  const answers = { ...sliceAnswers("slice_stress"), S2: "C", S3: "A", S4: 5, S5: 6 };
  const profile = applySlice("slice_stress", demoProfile(), answers);

  assert.equal(coordinate(profile, 12).code, "has_outlet", "первая подходящая строка таблицы выигрывает");
  assert.ok(profile.flags.includes("self_report_mismatch_12"));
});

test("slice_reactivity: мишень и режим реакции, расхождение с самооценкой", () => {
  const profile = applySlice("slice_reactivity", demoProfile(), sliceAnswers("slice_reactivity"));

  assert.equal(coordinate(profile, 8).code, "truth_hit");
  assert.equal(coordinate(profile, 8).confidence, "medium", "high даёт только совпадение с открытым S9");
  assert.equal(coordinate(profile, 7).code, "fast_long");
  assert.equal(coordinate(profile, 7).confidence, "high");
  assert.ok(profile.flags.includes("self_report_mismatch_7"));
});

test("slice_decisions: решение вырывает срок, решённое остаётся открытым", () => {
  const profile = applySlice("slice_decisions", demoProfile(), sliceAnswers("slice_decisions"));

  assert.equal(coordinate(profile, 14).code, "pressure_gated");
  assert.ok(coordinate(profile, 14).flags.includes("open_after_close"));
  assert.ok(coordinate(profile, 5).flags.includes("commitment_reversal"));
});

test("slice_node_finish: обрыв до показа с укрытием в плане", () => {
  const answers = { ...sliceAnswers("slice_node_finish"), S1: "A", S2: "D" };
  const profile = applySlice("slice_node_finish", demoProfile(), answers);
  assert.equal(coordinate(profile, 11).code, "pre_show_plan");
});

test("slice_stress: клапан был, в перегрузе им не пользуется", () => {
  const answers = { ...sliceAnswers("slice_stress"), S2: "A", S3: "A" };
  const profile = applySlice("slice_stress", demoProfile(), answers);
  assert.equal(coordinate(profile, 12).code, "unused_outlet");
});

test("slice_stress: S2=C/D не отдаёт has_outlet клеткам без клапана в моменте", () => {
  const withOutlet = applySlice("slice_stress", demoProfile(), { ...sliceAnswers("slice_stress"), S2: "C", S3: "A" });
  assert.equal(coordinate(withOutlet, 12).code, "has_outlet");
  const burned = applySlice("slice_stress", demoProfile(), { ...sliceAnswers("slice_stress"), S2: "E", S3: "C" });
  assert.equal(coordinate(burned, 12).code, "learned_self_reliance");
});

test("slice_reactivity: замечает поздно, отпускает быстро", () => {
  const answers = { ...sliceAnswers("slice_reactivity"), S8: "C", S3: "A" };
  const profile = applySlice("slice_reactivity", demoProfile(), answers);
  assert.equal(coordinate(profile, 7).code, "slow_short");
});

test("slice_decisions: собирал данные, сдвинуло внутренним откликом", () => {
  const answers = { ...sliceAnswers("slice_decisions"), S2: "A", S3: "D" };
  const profile = applySlice("slice_decisions", demoProfile(), answers);
  assert.equal(coordinate(profile, 14).code, "incubation");
});

const choiceKeys = (slice: string, id: string): string[] => {
  const question = rawContent.slices.find((candidate) => candidate.id === slice)?.questions.find((item) => item.id === id);
  assert.ok(question, `${slice} ${id}: нет вопроса`);
  assert.ok((question?.options.length ?? 0) > 0, `${slice} ${id}: не выбор`);
  return question!.options.map((option) => option.key);
};

const ownedOn = (slice: string, coordinateId: number, extra: SliceAnswers): string => {
  const profile = applySlice(slice, demoProfile(), { ...sliceAnswers(slice), ...extra });
  const code = coordinate(profile, coordinateId).code;
  assert.ok(code, `${slice}: ${JSON.stringify(extra)} не поставил код`);
  assert.equal(sliceOwnedCodes(slice)[code], coordinateId, `${slice}: ${JSON.stringify(extra)} → ${code}, не подтип среза`);
  return code;
};

test("таблицы подтипов покрывают все сочетания ответов, от которых зависит порог", () => {
  for (const s1 of choiceKeys("slice_node_finish", "S1")) {
    for (const s2 of choiceKeys("slice_node_finish", "S2")) {
      ownedOn("slice_node_finish", 11, { S1: s1, S2: s2 });
    }
  }
  for (const s2 of choiceKeys("slice_stress", "S2")) {
    for (const s3 of choiceKeys("slice_stress", "S3")) {
      ownedOn("slice_stress", 12, { S2: s2, S3: s3 });
    }
  }
  for (const s8 of choiceKeys("slice_reactivity", "S8")) {
    for (const s3 of choiceKeys("slice_reactivity", "S3")) {
      ownedOn("slice_reactivity", 7, { S8: s8, S3: s3 });
    }
  }
  for (const s2 of choiceKeys("slice_decisions", "S2")) {
    for (const s3 of choiceKeys("slice_decisions", "S3")) {
      ownedOn("slice_decisions", 14, { S2: s2, S3: s3 });
    }
  }
});

test("slice_work: сильная и дорогая зоны становятся конфигурацией профиля", () => {
  const profile = applySlice("slice_work", demoProfile(), sliceAnswers("slice_work"));

  assert.deepEqual(
    profile.configurations.map((configuration) => configuration.code),
    ["starter_no_finisher"],
  );
  assert.ok((profile.configurations[0]?.value.length ?? 0) > 10, "формулировка берётся из файла среза");
  // S1=C и S18=A согласны: вход по чужому запросу, своего старта не было.
  assert.equal(coordinate(profile, 13).code, "on_request");
  assert.equal(coordinate(profile, 13).confidence, "high");
  assert.ok(profile.flags.includes("self_report_mismatch_10"));
});

test("slice_relationships: конфигурация отдаления и односторонняя поддержка", () => {
  const profile = applySlice("slice_relationships", demoProfile(), sliceAnswers("slice_relationships"));

  assert.deepEqual(
    profile.configurations.map((configuration) => configuration.code),
    ["pursue_then_flee"],
  );
  assert.ok(profile.flags.includes("one_way_support"));
  assert.ok(profile.flags.includes("self_report_mismatch_12"));
  assert.equal(coordinate(profile, 12).code, "cooperation");
});

test("slice_decision_moment: без срока и свидетеля решение произойти не может", () => {
  const profile = applySlice("slice_decision_moment", demoProfile(), sliceAnswers("slice_decision_moment"));

  assert.deepEqual(
    profile.configurations.map((configuration) => configuration.code),
    ["no_forcing_function"],
  );
  // Профиль срез не пересчитывает: координаты остаются теми же.
  assert.equal(coordinate(profile, 11).code, coordinate(demoProfile(), 11).code);
});

test("подтип из разбора открытых ответов принимается только по словарю среза", () => {
  const answers = sliceAnswers("slice_decision_moment");
  const profile = applySlice("slice_decision_moment", demoProfile(), answers, { codes: ["permission_seeking"] });
  assert.ok(profile.configurations.some((configuration) => configuration.code === "permission_seeking"));

  assert.throws(
    () => applySlice("slice_decision_moment", demoProfile(), answers, { codes: ["procedure_stall"] }),
    /нет в файле среза/,
  );
});

test("добор не выдумывает координат: без ответов профиль не меняется", () => {
  const before = demoProfile();
  const after = applySlice("slice_node_finish", before, {});

  assert.deepEqual(after.coordinates, before.coordinates);
  assert.deepEqual(after.flags, before.flags);
  assert.deepEqual(after.configurations, []);
});

test("дата рождения в скоринге доборов не участвует: во входе её нет", () => {
  const answers = sliceAnswers("slice_node_finish");
  assert.ok(!Object.keys(answers).some((key) => /birth|дата|рожд/i.test(key)));
  assert.ok(textLonger(16).length > 0);
});
