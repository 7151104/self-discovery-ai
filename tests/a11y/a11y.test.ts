/**
 * Автотесты доступности на состояниях s0–paid_done (E11-05).
 *
 * Проверяется то, что клиент реально собирает: дерево, роли, имена,
 * порядок фокуса, цели 44 px. Синтетическая цель 20 px обязана падать.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadKit } from "../kit.js";
import { repoRoot } from "../paths.js";
import { PAGE_STATES } from "../states.js";
import { liveTrees } from "../visual/live.js";
import { showcaseTree } from "../visual/showcase.js";
import { assertNoFindings, auditTouch, auditTree, MIN_TARGET_PX, tabStops } from "./audit.js";

test("цель меньше 44 px ломает проверку", async () => {
  const kit = await loadKit();
  const lookup = {
    rules: kit.parseCss(".tiny-target { min-height: 20px; min-width: 20px; width: 20px; height: 20px; }"),
    tokens: kit.TOKENS,
    rootFontSizePx: kit.ROOT_FONT_SIZE_PX,
  };
  const tree = kit.h("button", { class: "tiny-target", type: "button" }, "x");
  const findings = auditTouch(tree, kit, lookup);
  assert.ok(
    findings.some((item) => item.code === "target"),
    "цель 20 px должна быть нарушением",
  );
  assert.ok(MIN_TARGET_PX === 44);
});

test("язык объявлен в оболочках страницы и витрины", () => {
  const page = readFileSync(join(repoRoot, "web/page/index.html"), "utf8");
  const showcase = readFileSync(join(repoRoot, "web/showcase/index.html"), "utf8");
  assert.match(page, /<html lang="ru">/);
  assert.match(showcase, /<html lang="ru">/);
  assert.match(page, /color-scheme" content="only light"/);
  assert.match(showcase, /color-scheme" content="only light"/);
  const shell = readFileSync(join(repoRoot, "server/src/http/page-shell.ts"), "utf8");
  const legal = readFileSync(join(repoRoot, "server/src/legal-page.ts"), "utf8");
  assert.match(shell, /color-scheme" content="only light"/);
  assert.match(legal, /color-scheme" content="only light"/);
});

test("ноль нарушений на состояниях витрины", async () => {
  const kit = await loadKit();
  const lookup = kit.componentLookup();
  for (const state of PAGE_STATES) {
    const findings = auditTree(await showcaseTree(state), kit, lookup);
    try {
      assertNoFindings(findings);
    } catch (error) {
      throw new Error(`витрина ${state}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

test("ноль нарушений на состояниях живого клиента", async () => {
  const kit = await loadKit();
  const lookup = kit.componentLookup();
  const live = await liveTrees();
  try {
    for (const state of PAGE_STATES) {
      const findings = auditTree(live.trees[state], kit, lookup);
      try {
        assertNoFindings(findings);
      } catch (error) {
        throw new Error(`живой ${state}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await live.close();
  }
});

test("порядок фокуса совпадает с деревом: без положительного tabindex, группа радио — один Tab", async () => {
  const kit = await loadKit();
  const tree = await showcaseTree("s0");
  const keys = kit.focusable(tree);
  assert.equal(
    keys.some((node) => node.attrs["tabindex"] === "-1" || node.attrs["tabIndex"] === -1),
    false,
  );
  assert.equal(
    keys.some((node) => {
      const raw = node.attrs["tabindex"] ?? node.attrs["tabIndex"];
      return typeof raw === "number" ? raw > 0 : typeof raw === "string" && Number(raw) > 0;
    }),
    false,
    "положительный tabindex меняет визуальный порядок",
  );
  const radios = keys.filter((node) => node.attrs["type"] === "radio");
  assert.ok(radios.length >= 2, "не из чего собрать группу");
  const stops = tabStops(tree, kit).filter((node) => node.attrs["type"] === "radio");
  const names = new Set(stops.map((node) => String(node.attrs["name"] ?? "")));
  assert.equal(stops.length, names.size, "в группе больше одного Tab-стопа");
});
