/**
 * Пять синтетических профилей лестницы: разные главные узлы.
 *
 * Файлы — `examples/synthetic/*.md`. Это скоринг, не эталоны текстов разбора.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { applyNodes } from "./nodes.js";
import { buildProfile } from "./scoring.js";
import type { LadderAnswers, ScaleAnswer } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(repoRoot, "examples/synthetic");

const SCALE = new Set(["1", "2", "3", "4", "5"]);

interface SyntheticProfile {
  file: string;
  node: string;
  answers: LadderAnswers;
}

const parseFile = (file: string): SyntheticProfile => {
  const source = readFileSync(join(directory, file), "utf8");
  const node = source.match(/\*\*Узел:\*\*\s+(NODE_[A-Z_]+)/)?.[1];
  assert.ok(node, `${file}: нет строки «Узел»`);
  const answers: LadderAnswers = {};
  for (const match of source.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|$/gm)) {
    const id = Number(match[1]);
    const raw = match[2]!.trim();
    if (id === 12) {
      answers.L12 = raw;
      continue;
    }
    const key = `L${id}` as keyof LadderAnswers;
    answers[key] = (SCALE.has(raw) ? (Number(raw) as ScaleAnswer) : raw) as never;
  }
  assert.equal(Object.keys(answers).length, 12, `${file}: в таблице не двенадцать ответов`);
  assert.ok((answers.L12?.split(/\s+/).filter(Boolean).length ?? 0) >= 15, `${file}: L12 короче порога`);
  return { file, node, answers };
};

const profiles = (): SyntheticProfile[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map(parseFile);

test("пять файлов, пять разных главных узлов", () => {
  const items = profiles();
  assert.equal(items.length, 5, `синтетики ${items.length}, нужно пять`);
  const nodes = items.map((item) => {
    const profile = applyNodes(buildProfile(item.answers), item.answers);
    assert.equal(profile.dominantNode, item.node, `${item.file}: ожидался ${item.node}, получился ${profile.dominantNode}`);
    return profile.dominantNode;
  });
  assert.equal(new Set(nodes).size, 5, `узлы повторились: ${nodes.join(", ")}`);
});
