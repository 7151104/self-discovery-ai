/**
 * Форма снимка ловит правку отступа и цвета. Эталоны здесь не нужны:
 * сравниваются два свежих снимка с разницей в одном токене.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { capture } from "./capture.js";
import { productContext, withTokens } from "./context.js";
import { showcaseTree } from "./showcase.js";
import { VIEWPORTS } from "./viewport.js";

test("правка отступа ломает снимок", async () => {
  const ctx = await productContext();
  const tree = await showcaseTree("s0");
  const meta = { source: "витрина" as const, state: "s0", viewport: VIEWPORTS.mobile };
  const base = capture(tree, meta, ctx);
  const changed = capture(tree, meta, withTokens(ctx, { "space-3": "2rem" }));
  assert.notEqual(changed, base);
  assert.equal(changed.includes("padding: 32px"), true, "новый отступ не попал в разрешённые стили");
  assert.equal(base.includes("padding: 12px"), true, "исходный отступ страницы — space-3 = 12 px");
});

test("правка цвета ломает снимок", async () => {
  const ctx = await productContext();
  const tree = await showcaseTree("s1");
  const meta = { source: "витрина" as const, state: "s1", viewport: VIEWPORTS.mobile };
  const base = capture(tree, meta, ctx);
  const changed = capture(tree, meta, withTokens(ctx, { "color-text": "#ff00aa" }));
  assert.notEqual(changed, base);
  assert.equal(changed.includes("#ff00aa"), true);
  assert.equal(base.includes("#ff00aa"), false);
});

test("мобильная и настольная ширина дают разные снимки одного состояния", async () => {
  const ctx = await productContext();
  const tree = await showcaseTree("s0");
  const mobile = capture(tree, { source: "витрина", state: "s0", viewport: VIEWPORTS.mobile }, ctx);
  const desktop = capture(tree, { source: "витрина", state: "s0", viewport: VIEWPORTS.desktop }, ctx);
  assert.notEqual(mobile, desktop);
  assert.equal(mobile.includes("ширина: mobile"), true);
  assert.equal(desktop.includes("ширина: desktop"), true);
});

test("прогон сверки не пишет эталон: модуль compare не экспортирует запись", async () => {
  const compare = await import("./compare.js");
  assert.equal("updateBaselines" in compare, false);
  assert.equal(typeof compare.compareSnapshot, "function");
});

test("писать файлы эталонов умеет только update.ts, сверка — только читает", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { repoRoot } = await import("../paths.js");
  const compare = readFileSync(join(repoRoot, "tests/visual/compare.ts"), "utf8");
  const update = readFileSync(join(repoRoot, "tests/visual/update.ts"), "utf8");
  assert.equal(compare.includes("writeFileSync"), false);
  assert.equal(compare.includes("mkdirSync"), false);
  assert.equal(update.includes("writeFileSync"), true);
});
