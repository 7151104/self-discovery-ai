/**
 * Журналы без персональных данных (E9-04).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { HIDDEN, log, scrub, scrubValue, setLogSink } from "./log.js";
import { answersForStep, call, portionKey, profileAtStep, startTestServer } from "./test-support.js";
import { listEvents } from "./store.js";
import type { PageStateDto } from "./contract/index.js";

/** Образцы записей: то, что вызывающий действительно может положить в журнал. */
const SAMPLES: { fields: Record<string, unknown>; secrets: string[] }[] = [
  { fields: { profileId: "abc", name: "Аня" }, secrets: ["Аня"] },
  { fields: { profileId: "abc", birthDate: "1990-05-01" }, secrets: ["1990-05-01"] },
  {
    fields: { portion: "step:4", answer: "Я бросаю дела на девяноста процентах, когда остаётся показать" },
    secrets: ["бросаю", "девяноста"],
  },
  // То же содержимое под безобидным именем: ловится вторым правилом.
  { fields: { detail: "Аня, 1990-05-01" }, secrets: ["Аня", "1990-05-01"] },
  { fields: { value: "Обычно я берусь за дело быстро и с интересом" }, secrets: ["берусь", "интересом"] },
  { fields: { heading: "Как это складывается" }, secrets: ["складывается"] },
  { fields: { hook: "Тебе физически тяжело от незакрытого" }, secrets: ["незакрытого"] },
];

test("образцы записей журнала не содержат ни имени, ни даты рождения, ни открытого ответа", () => {
  for (const sample of SAMPLES) {
    const line = JSON.stringify(scrub(sample.fields));
    for (const secret of sample.secrets) {
      assert.ok(!line.includes(secret), `в журнал попало «${secret}»: ${line}`);
    }
  }
});

test("машинные значения проходят, человеческий текст скрывается", () => {
  assert.equal(scrubValue("portion", "step:4"), "step:4");
  assert.equal(scrubValue("slice", "slice_node_finish"), "slice_node_finish");
  assert.equal(scrubValue("status", "paid"), "paid");
  assert.equal(scrubValue("count", 3), 3);
  assert.equal(scrubValue("enabled", true), true);
  assert.equal(scrubValue("at", "2026-09-08T10:00:00.000Z"), "2026-09-08T10:00:00.000Z");

  // Голая дата человеческая: так записывают дату рождения.
  assert.equal(scrubValue("at", "1990-05-01"), HIDDEN);
  assert.equal(scrubValue("detail", "строка с пробелами"), HIDDEN);
  assert.equal(scrubValue("detail", "a".repeat(65)), HIDDEN);
  assert.equal(scrubValue("name", "abc"), HIDDEN);
  assert.equal(scrubValue("detail", { nested: "объект" }), HIDDEN);
  assert.equal(
    scrubValue("problems", "quote_not_from_answer,register_gt_confidence_probability_low_c7"),
    "quote_not_from_answer,register_gt_confidence_probability_low_c7",
  );
});

test("строка журнала уходит уже очищенной", () => {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  try {
    log("profile.created", { profileId: "abc", name: "Аня" });
  } finally {
    setLogSink(null);
  }

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(record["event"], "profile.created");
  assert.equal(record["profileId"], "abc");
  assert.equal(record["name"], HIDDEN);
});

test("события живого профиля не содержат его данных", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 3);
  await call(server.origin, "POST", `/api/p/${created.profileId}/disagreements`, {
    blockId: "step3",
    kind: "partly",
  });
  await call<PageStateDto>(server.origin, "POST", `/api/p/${created.profileId}/portions`, {
    portion: portionKey(4),
    answers: answersForStep(4),
    requestId: "four",
  });

  const events = listEvents(server.db, created.profileId);
  assert.ok(events.length >= 4);

  const text = events.map((event) => event.payload).join(" ");
  for (const secret of ["Аня", "1990-05-05", "берусь за дело"]) {
    assert.ok(!text.includes(secret), `в событиях профиля есть «${secret}»`);
  }
  // Кириллицы в событиях не остаётся вовсе: там только машинные коды.
  assert.ok(!/[А-Яа-яЁё]/.test(text.replace(/\[скрыто\]/g, "")), text);
});
