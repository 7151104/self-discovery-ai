/**
 * Сверка эталонных снимков состояний s0–paid_done (E11-04).
 *
 * 7 состояний × 2 ширины × 2 источника = 28 эталонов.
 * Обновление — только `npm run snapshots:update`.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readdirSync } from "node:fs";
import { PAGE_STATES } from "../states.js";
import { web } from "../load.js";
import { capture } from "./capture.js";
import { compareSnapshot } from "./compare.js";
import { productContext } from "./context.js";
import { baselinesDir } from "./files.js";
import { liveTrees } from "./live.js";
import { showcaseTree } from "./showcase.js";
import { VIEWPORT_LIST } from "./viewport.js";

test("в эталонах ровно 28 файлов: семь состояний, две ширины, витрина и живой клиент", () => {
  const files = readdirSync(baselinesDir()).filter((name) => name.endsWith(".txt")).sort();
  assert.equal(files.length, PAGE_STATES.length * VIEWPORT_LIST.length * 2, files.join(", "));
});

test("состав состояний совпадает с таблицей docs/11-ui-page-spec.md", async () => {
  const { specPageStates, uiSpec } = await web<{
    specPageStates: (doc: string) => string[];
    uiSpec: () => string;
  }>("showcase/spec.js");
  assert.deepEqual([...PAGE_STATES], specPageStates(uiSpec()));
});

test("снимки витрины совпадают с эталоном", async () => {
  const ctx = await productContext();
  for (const state of PAGE_STATES) {
    const tree = await showcaseTree(state);
    for (const viewport of VIEWPORT_LIST) {
      compareSnapshot("showcase", state, viewport, capture(tree, { source: "витрина", state, viewport }, ctx));
    }
  }
});

test("снимки живого клиента совпадают с эталоном", async () => {
  const ctx = await productContext();
  const live = await liveTrees();
  try {
    for (const state of PAGE_STATES) {
      const tree = live.trees[state];
      for (const viewport of VIEWPORT_LIST) {
        compareSnapshot("live", state, viewport, capture(tree, { source: "живой", state, viewport }, ctx));
      }
    }
  } finally {
    await live.close();
  }
});
