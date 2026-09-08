/**
 * Сборка дерева витрины: та же `renderPersonalPage`, без рамки телефона
 * и без подписей разделов. Рамка — оформление витрины, не продукт.
 */

import { web } from "../load.js";
import { SHOWCASE_KEYS, type PageStateId } from "../states.js";
import type { Child } from "./capture.js";

type PageStates = Record<string, unknown>;

export async function showcaseTree(state: PageStateId): Promise<Child> {
  const { pageStates } = await web<{ pageStates: PageStates }>("showcase/page-states.js");
  const { viewLabels } = await web<{ viewLabels: (page: unknown) => unknown }>("showcase/labels.js");
  const { renderPersonalPage } = await web<{
    renderPersonalPage: (page: unknown, labels: unknown) => Child;
  }>("src/page.js");
  const key = SHOWCASE_KEYS[state];
  const page = pageStates[key];
  if (page === undefined) throw new Error(`витрина: нет состояния ${state}`);
  return renderPersonalPage(page, viewLabels(page));
}
