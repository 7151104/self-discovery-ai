/**
 * Движок противоречий (ступень 3).
 *
 * Тексты узлов — в content/step3-contradictions.md, здесь только условия
 * срабатывания и приоритет показа. Прозой условия записать однозначно нельзя,
 * поэтому они живут в коде; тест сверяет список идентификаторов с контентом.
 */

import { rawContent } from "./generated/content.js";
import type { LadderAnswers, Profile, TriggeredNode } from "./types.js";

interface NodeRule {
  id: string;
  coordinates: number[];
  /** Узел опирается на координату 8 — второй приоритет показа. */
  usesVulnerability: boolean;
  test: (answers: LadderAnswers) => boolean;
}

const atLeast = (value: number | undefined, threshold: number): boolean => value !== undefined && value >= threshold;

/** Порядок в массиве = порядок в content/step3-contradictions.md. */
export const NODE_RULES: NodeRule[] = [
  {
    id: "NODE_FINISH_FEAR",
    coordinates: [8, 11, 15],
    usesVulnerability: true,
    test: (a) => a.L2 === "C" && (a.L8 === "A" || a.L8 === "E"),
  },
  {
    id: "NODE_PLAN_VS_OPEN",
    coordinates: [5, 14],
    usesVulnerability: false,
    test: (a) => atLeast(a.L9, 4) && atLeast(a.L10, 4),
  },
  {
    id: "NODE_EXTERNAL_DEADLINE",
    coordinates: [11, 13],
    usesVulnerability: false,
    test: (a) => atLeast(a.L11, 4),
  },
  {
    id: "NODE_OVERLOAD",
    coordinates: [7, 9],
    usesVulnerability: false,
    test: (a) => a.L3 === "A" && atLeast(a.L6, 4),
  },
  {
    id: "NODE_CRITICISM_INTERNAL",
    coordinates: [7, 9, 12],
    usesVulnerability: false,
    test: (a) => a.L4 === "B" && atLeast(a.L6, 4),
  },
  {
    id: "NODE_POTENTIAL_VS_DETAIL",
    coordinates: [3, 6],
    usesVulnerability: false,
    test: (a) => a.L5 === "D" && atLeast(a.L7, 4),
  },
];

/** Текст запасного блока, когда не сработал ни один узел. */
export const FALLBACK_NODE_ID = "NODE_NONE";

const nodeText = (id: string): string => {
  const node = rawContent.step3.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`В content/step3-contradictions.md нет узла ${id}`);
  return node.text;
};

/**
 * Приоритет показа (content/step3-contradictions.md):
 * 1 — расхождение самооценки и поведения, 2 — узлы с уязвимостью, 3 — остальные.
 * Внутри приоритета — порядок объявления в контенте.
 */
function priorityOf(rule: NodeRule, profile: Profile): 1 | 2 | 3 {
  const mismatch = rule.coordinates.some((id) => profile.flags.includes(`self_report_mismatch_${id}`));
  if (mismatch) return 1;
  if (rule.usesVulnerability) return 2;
  return 3;
}

/** Заполняет узлы, главный узел и следующее платное предложение. */
export function applyNodes(profile: Profile, answers: LadderAnswers): Profile {
  const triggered: TriggeredNode[] = NODE_RULES.filter((rule) => rule.test(answers)).map((rule) => ({
    id: rule.id,
    text: nodeText(rule.id),
    priority: priorityOf(rule, profile),
    coordinates: rule.coordinates,
  }));

  const order = new Map(NODE_RULES.map((rule, index) => [rule.id, index]));
  triggered.sort((a, b) => a.priority - b.priority || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const dominantNode = triggered[0]?.id ?? null;
  const offers = rawContent.step3.offers;
  const fallback = offers["default"] ?? "slice_node_finish";

  return {
    ...profile,
    nodes: triggered,
    dominantNode,
    nextPaidOffer: (dominantNode ? offers[dominantNode] : undefined) ?? fallback,
  };
}

export function fallbackNodeText(): string {
  return nodeText(FALLBACK_NODE_ID);
}
