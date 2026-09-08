/**
 * Сквозной прогон финала лестницы на поддельном провайдере.
 *
 * Здесь сходятся все задачи слоя: промпт из контента (E4-02), проверка текста
 * (E4-04), регистры (E4-05), сюжет для координаты 15 (E4-07) и изоляция
 * пользовательского текста (E4-09). Сети нет ни в одном тесте.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ANSWERS, DEMO_PERSON, GOOD_STATEMENTS, GOOD_STORYLINE, GOOD_TEXT, demoTask, envelope } from "./fixtures.js";
import { DEFAULTS } from "./config.js";
import { FakeProvider, answering } from "./fake-provider.js";
import { buildPage, unknownCoordinates } from "./engine.js";
import { generateLadderFinal, type Step4Outcome } from "./step4.js";

const base = {
  retry: { ...DEFAULTS.retry, timeoutMs: 50 },
  cost: DEFAULTS.cost,
  spentKopecks: 0,
  sleep: async (): Promise<void> => undefined,
};

const run = (provider: FakeProvider): Promise<Step4Outcome> =>
  generateLadderFinal({ ...base, task: demoTask(), provider });

test("хороший ответ модели превращается в блок ступени 4 и сюжет для профиля", async () => {
  const provider = answering(envelope());
  const outcome = await run(provider);

  assert.ok(outcome.ok, outcome.ok ? "" : outcome.details.join("; "));
  if (!outcome.ok) return;

  assert.equal(outcome.block.step, 4);
  assert.equal(outcome.block.source, "llm");
  assert.equal(outcome.block.paragraphs.length, 3);
  assert.equal(outcome.block.paragraphs.join("\n\n"), GOOD_TEXT);
  assert.deepEqual(outcome.storyline, GOOD_STORYLINE);
  assert.equal(outcome.statements.length, GOOD_STATEMENTS.length);
  assert.deepEqual(outcome.warnings, []);
  assert.equal(provider.callCount, 1);
  assert.equal(provider.calls[0]!.expects, "json");
  assert.equal(provider.calls[0]!.temperature, 0);
});

test("сюжет закрывает координату 15, а невалидный выход её не касается", async () => {
  const before = buildPage(DEMO_PERSON, DEMO_ANSWERS);
  assert.ok(
    unknownCoordinates(before.internal.profile).some((coordinate) => coordinate.id === 15),
    "до синтеза координата 15 пуста",
  );

  const outcome = await run(answering(envelope()));
  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  const after = buildPage(DEMO_PERSON, DEMO_ANSWERS, { storyline: outcome.storyline });
  assert.ok(
    !unknownCoordinates(after.internal.profile).some((coordinate) => coordinate.id === 15),
    "сюжет обязан закрыть координату 15",
  );
  assert.equal(after.internal.profile.coordinates[15]!.code, GOOD_STORYLINE.code);
  assert.equal(after.internal.profile.coordinates[15]!.confidence, "medium");
  assert.deepEqual(after.internal.profile.coordinates[15]!.sources, ["L12"]);

  const broken = await run(answering(envelope({ storyline: { code: "НЕ КОД" } })));
  assert.equal(broken.ok, false, "невалидный сюжет обязан быть отклонён");
  if (!broken.ok) assert.equal(broken.reason, "машинный выход");

  const untouched = buildPage(DEMO_PERSON, DEMO_ANSWERS);
  assert.ok(
    unknownCoordinates(untouched.internal.profile).some((coordinate) => coordinate.id === 15),
    "отклонённый выход в профиль не пишется",
  );
});

test("уверенность сюжета не может обойти потолок лестницы", async () => {
  const outcome = await run(answering(envelope({ storyline: { confidence: "high" } })));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "сюжет");
    assert.match(outcome.details[0]!, /потолка лестницы medium/);
  }
});

test("запрещённая формулировка в тексте отклоняет генерацию", async () => {
  const text = GOOD_TEXT.replace(
    "Механизм я вижу, начала у него — нет.",
    "Механизм я вижу, начала у него — нет. Не переживай, всё наладится.",
  );
  const outcome = await generateLadderFinal({
    ...base,
    task: demoTask(),
    provider: answering(
      envelope({
        text,
        statements: [
          ...GOOD_STATEMENTS,
          { phrase: "Не переживай, всё наладится.", kind: "неизвестное", coordinate: null },
        ],
      }),
    ),
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "текст");
    assert.ok(outcome.details.some((detail) => detail.includes("FORBIDDEN_TONE")));
  }
});

test("несоответствие регистра отклоняет генерацию отдельной причиной", async () => {
  const outcome = await generateLadderFinal({
    ...base,
    task: demoTask(),
    provider: answering(
      envelope({
        statements: GOOD_STATEMENTS.map((statement) =>
          statement.kind === "вопрос" ? { ...statement, kind: "утверждение" as const } : statement,
        ),
      }),
    ),
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "регистры");
    assert.ok(outcome.details.some((detail) => detail.startsWith("регистр сильнее confidence")));
  }
});

test("отказ провайдера и предел стоимости — разные причины отказа", async () => {
  const failing = new FakeProvider({ turns: [{ kind: "отказ", failure: "постоянный отказ", code: "auth" }] });
  const refused = await generateLadderFinal({ ...base, task: demoTask(), provider: failing });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, "провайдер");

  const priced = answering(envelope(), {
    pricing: { inputKopecksPerMillion: 1_000_000, outputKopecksPerMillion: 1_000_000 },
  });
  const capped = await generateLadderFinal({
    ...base,
    task: demoTask(),
    provider: priced,
    cost: { profileLimitKopecks: 1 },
  });
  assert.equal(capped.ok, false);
  if (!capped.ok) assert.equal(capped.reason, "предел стоимости");
  assert.equal(priced.callCount, 0, "исчерпанный предел не должен доходить до провайдера");
});

test("временный отказ провайдера доигрывается повтором внутри слоя", async () => {
  const provider = new FakeProvider({
    turns: [{ kind: "отказ", failure: "временный отказ", code: "503" }, { kind: "ответ", text: envelope() }],
  });
  const outcome = await generateLadderFinal({ ...base, task: demoTask(), provider });

  assert.ok(outcome.ok);
  if (outcome.ok) assert.equal(outcome.attempts, 2);
});
