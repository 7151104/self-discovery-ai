/**
 * Контраст (E6-03).
 *
 * Приёмка: основной текст не ниже 7:1, вспомогательный не ниже 4.5:1.
 * Проверяется на всех объявленных парах «текст на поверхности», а не на глаз
 * и не на одной паре.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { COLOR_ROLES, NEUTRALS, SEMANTIC_COLORS, SEMANTIC_DERIVED, TOKENS } from "./tokens.js";
import { contrastRatio, parseHex, relativeLuminance, round2 } from "../src/color.js";

const hex = (name: string): string => {
  const value = TOKENS[name];
  if (value === undefined) throw new Error(`нет токена --${name}`);
  return value;
};

test("каждая объявленная пара держит свой порог контраста", () => {
  for (const role of COLOR_ROLES) {
    const ratio = contrastRatio(hex(role.foreground), hex(role.background));
    assert.ok(ratio >= role.min, `${role.role}: ${round2(ratio)}:1 при пороге ${role.min}:1`);
  }
});

test("основной текст проверен не ниже 7:1 хотя бы на трёх поверхностях", () => {
  const strict = COLOR_ROLES.filter((role) => role.min >= 7);
  assert.ok(strict.length >= 3, `пар с порогом 7:1 всего ${strict.length}`);
});

test("вспомогательный текст проверен не ниже 4.5:1", () => {
  const soft = COLOR_ROLES.filter((role) => role.foreground === "color-text-soft");
  assert.ok(soft.length >= 2);
  for (const role of soft) assert.ok(role.min >= 4.5);
});

test("все цвета — корректные шестизначные значения", () => {
  for (const token of [...NEUTRALS, ...SEMANTIC_COLORS, ...SEMANTIC_DERIVED]) {
    assert.doesNotThrow(() => parseHex(token.hex), `${token.name}: ${token.hex}`);
  }
});

test("нейтральная шкала монотонна по светлоте: поверхности светлее текста", () => {
  const luminance = NEUTRALS.map((token) => relativeLuminance(parseHex(token.hex)));
  assert.deepEqual(
    luminance.map((value) => round2(value)),
    [...luminance].sort((first, second) => second - first).map((value) => round2(value)),
    "шкала обязана идти от самой светлой поверхности к самому тёмному тексту",
  );
});
