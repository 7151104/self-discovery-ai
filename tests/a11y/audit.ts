/**
 * Проверка доступности по дереву разметки и объявленным стилям.
 *
 * Браузера нет: те же приёмы, что у `web/components/layout.test.ts` и
 * `focusable` в `web/src/test-support.ts`. Это ловит имена, роли, порядок
 * фокуса и цели меньше 44 px. Чего это не ловит — живой фокус в окне;
 * клавиатурное прохождение лестницы — отдельный автотест.
 */

import { walkTree, type Child, type VNode } from "../visual/capture.js";
import type { Kit, Lookup } from "../kit.js";

export const MIN_TARGET_PX = 44;

export type Finding = { code: string; message: string };

const INTERACTIVE = new Set(["button", "a", "summary", "textarea", "select", "input"]);

const classesOf = (node: VNode): string[] => String(node.attrs["class"] ?? "").split(/\s+/).filter(Boolean);

const describe = (node: VNode): string => {
  const cls = classesOf(node).join(".");
  return cls ? `${node.tag}.${cls}` : node.tag;
};

const tabIndexOf = (node: VNode): number => {
  const raw = node.attrs["tabindex"] ?? node.attrs["tabIndex"];
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw !== "") return Number(raw);
  return 0;
};

const isInteractive = (node: VNode, tags: Set<string>): boolean =>
  tags.has(node.tag) || (typeof node.attrs["tabIndex"] === "number" && node.attrs["tabIndex"] >= 0);

const hiddenFromStyles = (kit: Kit, lookup: Lookup, node: VNode): boolean =>
  classesOf(node).some((name) => {
    const height = kit.declaredPx(lookup, `.${name}`, "height");
    return height !== null && height <= kit.tokenPixels("border-hair");
  });

const textOf = (node: Child): string => {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node !== "object") return node;
  if (node.attrs["aria-hidden"] === true || node.attrs["aria-hidden"] === "true") return "";
  return node.children.map((child) => textOf(child)).join(" ");
};

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

function labelsByFor(tree: Child): Map<string, string> {
  const found = new Map<string, string>();
  walkTree(tree, (node) => {
    if (node.tag !== "label") return;
    const id = node.attrs["for"];
    if (typeof id !== "string" || id === "") return;
    found.set(id, collapse(textOf(node)));
  });
  return found;
}

function accessibleName(node: VNode, ancestors: VNode[], labelled: Map<string, string>): string {
  const aria = node.attrs["aria-label"];
  if (typeof aria === "string" && aria.trim()) return aria.trim();
  const labelledBy = node.attrs["aria-labelledby"];
  if (typeof labelledBy === "string" && labelledBy.trim()) return labelledBy.trim();
  const alt = node.attrs["alt"];
  if (typeof alt === "string") return alt.trim();
  const wrap = [...ancestors].reverse().find((item) => item.tag === "label");
  if (wrap) {
    const fromWrap = collapse(textOf(wrap));
    if (fromWrap) return fromWrap;
  }
  const id = node.attrs["id"];
  if (typeof id === "string") {
    const fromFor = labelled.get(id) ?? "";
    if (fromFor) return fromFor;
  }
  const title = node.attrs["title"];
  if (typeof title === "string" && title.trim()) return title.trim();
  const placeholder = node.attrs["placeholder"];
  if (typeof placeholder === "string" && placeholder.trim()) return placeholder.trim();
  return collapse(textOf(node));
}

const legendText = (node: VNode): string => {
  const legend = node.children.find((child) => typeof child === "object" && child && child.tag === "legend");
  return legend && typeof legend === "object" ? collapse(textOf(legend)) : "";
};

function hasLangRu(tree: Child): boolean {
  let found = false;
  walkTree(tree, (node) => {
    if (node.attrs["lang"] === "ru") found = true;
  });
  return found;
}

function headingLevels(tree: Child): number[] {
  const levels: number[] = [];
  walkTree(tree, (node) => {
    const match = /^h([1-6])$/.exec(node.tag);
    if (match) levels.push(Number(match[1]));
  });
  return levels;
}

/** Цели касания: тот же расчёт, что в `layout.test.ts`. */
export function auditTouch(tree: Child, kit: Kit, lookup: Lookup): Finding[] {
  const findings: Finding[] = [];
  kit.walk(tree, ({ node, ancestors }) => {
    if (!kit.INTERACTIVE_TAGS.has(node.tag)) return;
    if (hiddenFromStyles(kit, lookup, node)) return;
    const chain = [classesOf(node), ...ancestors];
    const boxes = chain.flatMap((classes) => classes.map((name) => kit.boxOf(lookup, name)));
    const tallEnough = boxes.some((box) => box.height !== null && box.height >= MIN_TARGET_PX);
    const wideEnough = boxes.some((box) => box.wide || (box.width !== null && box.width >= MIN_TARGET_PX));
    if (!tallEnough || !wideEnough) {
      findings.push({
        code: "target",
        message: `цель ${describe(node)} меньше ${MIN_TARGET_PX} px`,
      });
    }
  });
  return findings;
}

export function tabStops(tree: Child, kit: Kit): VNode[] {
  const all = kit.focusable(tree);
  const stops: VNode[] = [];
  const radios = all.filter((node) => node.attrs["type"] === "radio");
  for (const node of all) {
    if (node.attrs["type"] === "radio") {
      const name = String(node.attrs["name"] ?? "");
      const group = radios.filter((item) => String(item.attrs["name"] ?? "") === name);
      const active = group.find((item) => item.attrs["checked"] === true) ?? group[0];
      if (node !== active) continue;
    }
    stops.push(node);
  }
  return stops;
}

export function auditTree(tree: Child, kit: Kit, lookup: Lookup): Finding[] {
  const findings: Finding[] = [];
  const labelled = labelsByFor(tree);
  const tags = kit.INTERACTIVE_TAGS.size > 0 ? kit.INTERACTIVE_TAGS : INTERACTIVE;

  if (!hasLangRu(tree)) {
    findings.push({ code: "lang", message: "в дереве нет lang=\"ru\"" });
  }

  const headings = headingLevels(tree);
  let previous = 0;
  for (const level of headings) {
    if (previous > 0 && level > previous + 1) {
      findings.push({ code: "heading", message: `заголовок h${level} после h${previous}: пропуск уровня` });
    }
    previous = level;
  }

  walkTree(tree, (node, ancestors) => {
    if (node.tag === "img" && !("alt" in node.attrs)) {
      findings.push({ code: "alt", message: `у картинки ${describe(node)} нет текстовой альтернативы` });
    }
    if (node.tag === "svg" && node.attrs["role"] === "img") {
      const label = node.attrs["aria-label"] ?? node.attrs["aria-labelledby"];
      if (!label) findings.push({ code: "alt", message: `у svg ${describe(node)} с ролью img нет подписи` });
    }
    if (classesOf(node).includes("map") && !collapse(String(node.attrs["aria-label"] ?? ""))) {
      findings.push({ code: "alt", message: "у карты нет текстовой альтернативы" });
    }
    if (node.attrs["role"] === "radiogroup") {
      const name = collapse(String(node.attrs["aria-label"] ?? "")) || legendText(node);
      if (!name) findings.push({ code: "role", message: `группа ${describe(node)} без подписи` });
    }
    if (!isInteractive(node, tags)) return;
    if (hiddenFromStyles(kit, lookup, node)) {
      if (!accessibleName(node, ancestors, labelled)) {
        findings.push({ code: "name", message: `скрытое поле ${describe(node)} без имени` });
      }
      return;
    }
    const tab = tabIndexOf(node);
    if (tab > 0) {
      findings.push({ code: "focus-order", message: `${describe(node)} выпрыгивает из порядка: tabindex=${tab}` });
    }
    if (tab < 0) {
      findings.push({ code: "focus-order", message: `${describe(node)} исключён из порядка фокуса` });
    }
    if (!accessibleName(node, ancestors, labelled)) {
      findings.push({ code: "name", message: `${describe(node)} без текстового имени` });
    }
    if (node.tag === "a" && !node.attrs["href"] && node.attrs["role"] !== "button") {
      findings.push({ code: "role", message: `ссылка ${describe(node)} без href и без роли` });
    }
    if (node.tag === "button") {
      const type = node.attrs["type"];
      if (type !== undefined && type !== "button" && type !== "submit" && type !== "reset") {
        findings.push({ code: "role", message: `кнопка ${describe(node)} с type=${String(type)}` });
      }
    }
  });

  findings.push(...auditTouch(tree, kit, lookup));
  return findings;
}

export function assertNoFindings(findings: Finding[]): void {
  if (findings.length === 0) return;
  throw new Error(`нарушения доступности:\n${findings.map((item) => `${item.code}: ${item.message}`).join("\n")}`);
}
