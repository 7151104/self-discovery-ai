/**
 * Обновление эталонных снимков. Единственное место, которое пишет в
 * `tests/visual/baselines/`. Прогон сверки этот модуль не вызывает.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { PAGE_STATES } from "../states.js";
import { capture } from "./capture.js";
import { productContext } from "./context.js";
import { baselineFile, baselinesDir, baselinePath } from "./files.js";
import { liveTrees } from "./live.js";
import { showcaseTree } from "./showcase.js";
import { VIEWPORT_LIST } from "./viewport.js";

export async function updateBaselines(): Promise<string[]> {
  const ctx = await productContext();
  mkdirSync(baselinesDir(), { recursive: true });
  const written: string[] = [];

  for (const state of PAGE_STATES) {
    const tree = await showcaseTree(state);
    for (const viewport of VIEWPORT_LIST) {
      const body = capture(tree, { source: "витрина", state, viewport }, ctx);
      writeFileSync(baselinePath("showcase", state, viewport), body);
      written.push(baselineFile("showcase", state, viewport));
    }
  }

  const live = await liveTrees();
  try {
    for (const state of PAGE_STATES) {
      const tree = live.trees[state];
      for (const viewport of VIEWPORT_LIST) {
        const body = capture(tree, { source: "живой", state, viewport }, ctx);
        writeFileSync(baselinePath("live", state, viewport), body);
        written.push(baselineFile("live", state, viewport));
      }
    }
  } finally {
    await live.close();
  }

  return written;
}

const running = process.argv[1]?.includes("update");
if (running) {
  const files = await updateBaselines();
  for (const file of files) console.log(`записан ${file}`);
  console.log(`эталонов: ${files.length}`);
}
