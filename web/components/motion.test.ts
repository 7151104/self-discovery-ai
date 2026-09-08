/**
 * Приёмка E6-09: анимации, переходы и снижение движения.
 *
 * Три требования маршрута проверяются здесь по отдельности:
 *   1. ни одна анимация на пути прохождения не длиннее 600 мс;
 *   2. при снижении движения переходы выключены полностью;
 *   3. ввод не блокируется анимацией.
 *
 * Третье — самое важное и самое лёгкое проиграть, поэтому оно проверяется с
 * трёх сторон: порядком вызовов в модуле движения, разметкой (во время паузы
 * порция остаётся включённой) и стилями (движение не перехватывает нажатия).
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { durationMs, parseCss, resolveVars, type Rule } from "../src/css.js";
import { renderToString } from "../src/dom.js";
import {
  answerDuringMotion,
  collectingPause,
  enterFlag,
  motionReduced,
  scrollToNewBlock,
  REDUCED_MOTION_QUERY,
  type MotionHost,
} from "../src/motion.js";
import { componentCss, componentFiles } from "../src/test-support.js";
import { COLLECTING_PAUSE_MS, COLLECTING_PAUSE_RANGE, MAX_DURATION_MS, TOKENS } from "../tokens/tokens.js";
import { renderBlock } from "./block.js";

/** Окно на верёвочке: время идёт только тогда, когда его двигает тест. */
function fakeHost(reduced = false): MotionHost & { tick: (ms: number) => void; timers: number } {
  const pending = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 1;

  return {
    matchMedia: (query: string) => ({ matches: reduced && query === REDUCED_MOTION_QUERY }),
    setTimeout: (handler: () => void, ms: number) => {
      const id = next;
      next += 1;
      pending.set(id, { at: now + ms, run: handler });
      return id;
    },
    clearTimeout: (id: number) => {
      pending.delete(id);
    },
    tick(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.run();
        }
      }
    },
    get timers() {
      return pending.size;
    },
  };
}

/** Все длительности анимаций и переходов, объявленные в стилях компонентов. */
function declaredDurations(): { file: string; line: number; property: string; ms: number }[] {
  const found: { file: string; line: number; property: string; ms: number }[] = [];
  for (const file of componentFiles()) {
    for (const rule of parseCss(componentCss(file))) {
      for (const declaration of rule.declarations) {
        if (!/^(animation|transition)(-duration|-delay)?$/.test(declaration.property)) continue;
        for (const part of resolveVars(declaration.value, TOKENS).replace(/!important/g, "").split(/[\s,]+/)) {
          const ms = durationMs(part);
          if (ms !== null) found.push({ file, line: declaration.line, property: declaration.property, ms });
        }
      }
    }
  }
  return found;
}

test("ни одна анимация не длиннее 600 мс", () => {
  const durations = declaredDurations();
  assert.ok(durations.length > 0, "в стилях не нашлось ни одной длительности — тест потерял смысл");
  for (const item of durations) {
    assert.ok(item.ms <= MAX_DURATION_MS, `${item.file}:${item.line} ${item.property} — ${item.ms} мс`);
  }
});

test("длительности берутся из шкалы: литеральных секунд в стилях нет", () => {
  for (const file of componentFiles()) {
    for (const rule of parseCss(componentCss(file))) {
      for (const declaration of rule.declarations) {
        if (!/^(animation|transition)(-duration|-delay)?$/.test(declaration.property)) continue;
        assert.ok(
          !/(^|[\s(,])-?[\d.]+m?s\b/.test(declaration.value),
          `${file}:${declaration.line}: длительность «${declaration.value}» записана мимо шкалы`,
        );
      }
    }
  }
});

const reducedRules = (): Rule[] =>
  componentFiles()
    .flatMap((file) => parseCss(componentCss(file)))
    .filter((rule) => rule.at.some((at) => at.includes("prefers-reduced-motion")));

test("снижение движения выключает переходы всюду, а не в одном компоненте", () => {
  const rules = reducedRules();
  const universal = rules.find((rule) => rule.selector.split(",").some((part) => part.trim() === "*"));
  assert.ok(universal !== undefined, "нет общего выключателя: снижение движения обошло бы новые компоненты");

  const off = new Map(
    universal.declarations.map((declaration) => [
      declaration.property,
      resolveVars(declaration.value.replace(/!important/g, "").trim(), TOKENS),
    ]),
  );
  for (const property of ["animation-duration", "animation-delay", "transition-duration", "transition-delay"]) {
    assert.equal(durationMs(off.get(property) ?? ""), 0, `${property} при снижении движения не обнулён`);
  }

  for (const declaration of universal.declarations) {
    assert.match(declaration.value, /!important/, `${declaration.property}: выключатель обязан быть сильнее правил компонентов`);
  }
});

test("при снижении движения страница не едет, а оказывается на месте", () => {
  const scrolled: { behavior: string }[] = [];
  const target = { scrollIntoView: (options: { behavior: "smooth" | "auto"; block: "start" }) => scrolled.push(options) };

  scrollToNewBlock(target, fakeHost(false));
  scrollToNewBlock(target, fakeHost(true));
  assert.deepEqual(
    scrolled.map((item) => item.behavior),
    ["smooth", "auto"],
  );

  const html = reducedRules().find((rule) => rule.selector.trim() === "html");
  assert.equal(html?.declarations.find((item) => item.property === "scroll-behavior")?.value, "auto");
});

test("снижение движения читается у системы, а не угадывается", () => {
  assert.equal(motionReduced(fakeHost(true)), true);
  assert.equal(motionReduced(fakeHost(false)), false);
  // Окна нет вовсе — движение считается разрешённым, но и показывать нечего.
  assert.equal(motionReduced({ setTimeout: () => 0, clearTimeout: () => undefined }), false);
});

test("пауза «собираю» укладывается в 600–900 мс и заканчивается один раз", () => {
  assert.ok(COLLECTING_PAUSE_MS >= COLLECTING_PAUSE_RANGE.min && COLLECTING_PAUSE_MS <= COLLECTING_PAUSE_RANGE.max);

  const host = fakeHost();
  let done = 0;
  const pause = collectingPause({ host, onDone: () => (done += 1) });

  assert.equal(pause.ms, COLLECTING_PAUSE_MS);
  assert.equal(done, 0, "пауза закончилась, не начавшись");
  host.tick(COLLECTING_PAUSE_MS);
  assert.equal(done, 1);
  pause.skip();
  assert.equal(done, 1, "пауза закончилась дважды");
});

test("при снижении движения паузы нет вовсе: ни таймера, ни ожидания", () => {
  const host = fakeHost(true);
  let done = 0;
  const pause = collectingPause({ host, onDone: () => (done += 1) });

  assert.equal(pause.ms, 0);
  assert.equal(done, 1, "блок обязан появиться сразу");
  assert.equal(host.timers, 0, "заведён таймер, которого при снижении движения быть не должно");
});

test("ввод не ждёт анимацию: ответ обрабатывается до паузы и обрывает её", () => {
  const host = fakeHost();
  const order: string[] = [];
  const pause = collectingPause({ host, onDone: () => order.push("блок") });

  const accepted = answerDuringMotion(pause, () => {
    order.push("ответ");
    return "принят";
  });

  // Ответ вернулся синхронно, не дожидаясь ни одного тика времени.
  assert.equal(accepted, "принят");
  assert.deepEqual(order, ["ответ", "блок"]);
  assert.equal(host.timers, 0, "таймер паузы остался висеть после ответа");

  host.tick(COLLECTING_PAUSE_MS * 2);
  assert.deepEqual(order, ["ответ", "блок"], "пауза сработала второй раз");
});

test("появление блока — один раз: показанный блок не проявляется снова", () => {
  const seen = new Set(["step1"]);
  assert.equal(enterFlag("step2", seen), "on");
  assert.equal(enterFlag("step1", seen), "off");
  assert.equal(enterFlag("step2", seen, true), "off", "при снижении движения не проявляется ничего");

  const markup = renderToString(renderBlock({ id: "step2", heading: "H", paragraphs: ["p"], entering: true }));
  assert.match(markup, /data-enter="on"/);
  assert.match(renderToString(renderBlock({ id: "step2", heading: "H", paragraphs: ["p"] })), /data-enter="off"/);
});

test("движение не перехватывает нажатия: ни одного pointer-events: none на пути", () => {
  for (const file of componentFiles()) {
    for (const rule of parseCss(componentCss(file))) {
      for (const declaration of rule.declarations) {
        if (declaration.property !== "pointer-events") continue;
        assert.fail(`${file}:${declaration.line}: «${rule.selector}» перехватывает нажатия во время движения`);
      }
    }
  }
});

test("появление блока не трогает свойств, которые ловят нажатие", () => {
  const frames = parseCss(componentCss("motion.css")).filter((rule) => rule.at.some((at) => at.startsWith("@keyframes")));
  assert.ok(frames.length > 0, "нет ни одного кадра появления");
  const allowed = new Set(["opacity", "transform"]);
  for (const frame of frames) {
    for (const declaration of frame.declarations) {
      assert.ok(
        allowed.has(declaration.property),
        `кадр анимации меняет «${declaration.property}» — это влияет не только на вид`,
      );
    }
  }
});
