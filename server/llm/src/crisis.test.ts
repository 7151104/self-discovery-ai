/**
 * E4-06: кризисный контур в генерации.
 *
 * Детектор срабатывает до провайдера. Корпус похожих формулировок из
 * `content/crisis.md` обязан проходить: ложное срабатывание выключит контур.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ANSWERS, DEMO_PERSON, envelope, demoTask } from "./fixtures.js";
import { DEFAULTS } from "./config.js";
import { avoidInstruction, crisisGate } from "./crisis.js";
import { detectCrisis, rawExtraContent, buildPage } from "./engine.js";
import { answering } from "./fake-provider.js";
import { buildStep4Prompt, instructionOf } from "./prompt.js";
import { generateLadderFinal } from "./step4.js";

const base = {
  retry: { ...DEFAULTS.retry, timeoutMs: 50 },
  cost: DEFAULTS.cost,
  spentKopecks: 0,
  sleep: async (): Promise<void> => undefined,
};

const asWritten = (form: string): string => (form.endsWith("*") ? `${form.slice(0, -1)}ось` : form);

const usual =
  "Беру на себя больше, чем могу вынести, тащу всё сам, никого не подключаю, а к концу выдыхаюсь и бросаю почти у финиша, потом злюсь на себя.";

const crisisAnswer = `${usual} ${asWritten(rawExtraContent.crisis.triggers.find((item) => item.id === "CRISIS_SUICIDE")!.forms[0]!)}.`;

test("кризисный крючок не ставит задание при блокирующей формулировке", () => {
  assert.equal(crisisGate("хочу умереть и не вижу смысла"), "skip");
  assert.equal(crisisGate("обычный открытый ответ про круг дел"), "enqueue");
});

test("кризисный открытый ответ не доходит до провайдера", async () => {
  const task = demoTask();
  const crisisTask = { ...task, input: { ...task.input, openAnswer: crisisAnswer } };
  const provider = answering(envelope());
  const outcome = await generateLadderFinal({ ...base, task: crisisTask, provider });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "кризис");
  assert.equal(provider.callCount, 0, "кризисный текст не должен уходить в модель");
  assert.equal(outcome.attempts, 0);
});

test("похожие, но не кризисные формулировки доходят до провайдера", async () => {
  assert.ok(rawExtraContent.crisis.safe.length >= 8, "корпус похожих формулировок на месте");

  for (const phrase of rawExtraContent.crisis.safe) {
    const answer = `${usual} ${asWritten(phrase)}.`;
    assert.equal(detectCrisis(answer).blocked, false, `ложное срабатывание: «${phrase}»`);
    assert.equal(crisisGate(answer), "enqueue", `крючок срезал «${phrase}»`);

    const provider = answering(envelope());
    const outcome = await generateLadderFinal({
      ...base,
      task: demoTask({ ...DEMO_ANSWERS, L12: answer }),
      provider,
    });
    assert.equal(provider.callCount, 1, `провайдера не вызвали на «${phrase}»`);
    assert.ok(outcome.ok, outcome.ok ? "" : outcome.details.join("; "));
  }
});

test("тема с оговоркой уходит в задание, а провайдер вызывается", async () => {
  const loss = rawExtraContent.crisis.triggers.find((item) => item.id === "CRISIS_LOSS")!;
  const answer = `${usual} ${asWritten(loss.forms[0]!)}.`;
  const decision = detectCrisis(answer);
  assert.equal(decision.blocked, false);
  assert.deepEqual(decision.avoid, ["CRISIS_LOSS"]);

  const prompt = buildStep4Prompt(demoTask({ ...DEMO_ANSWERS, L12: answer }), "0123456789abcdef", decision.avoid);
  const instruction = avoidInstruction(decision.avoid);
  assert.ok(instruction);
  assert.ok(instructionOf(prompt).includes(instruction));
  assert.ok(instructionOf(prompt).includes(loss.title));

  const provider = answering(envelope());
  const outcome = await generateLadderFinal({
    ...base,
    task: demoTask({ ...DEMO_ANSWERS, L12: answer }),
    provider,
  });
  assert.equal(provider.callCount, 1);
  assert.ok(outcome.ok);
});

test("движок не отдаёт задание на кризис, слой это повторяет", () => {
  const page = buildPage(DEMO_PERSON, { ...DEMO_ANSWERS, L12: crisisAnswer });
  assert.equal(page.internal.llmTask, null);
  assert.equal(page.view.offer, null);
  assert.ok(page.view.crisis);
});
