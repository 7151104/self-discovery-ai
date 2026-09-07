/**
 * Rule Engine: ответы → профиль из 16 координат.
 *
 * Реализует content/scoring-rules.md, раздел «Лестница 11+1: точные правила».
 * Здесь не должно появляться ни одного правила, которого нет в контенте.
 */

import { rawContent } from "./generated/content.js";
import type { Band, Confidence, CoordinateState, LadderAnswers, Profile } from "./types.js";

interface Assignment {
  value: string;
  code: string;
  band: Band | null;
  confidence: Confidence;
  sources: string[];
  flags?: string[];
}

const emptyCoordinates = (): Record<number, CoordinateState> => {
  const out: Record<number, CoordinateState> = {};
  for (const coordinate of rawContent.coordinates) {
    out[coordinate.id] = {
      id: coordinate.id,
      name: coordinate.name,
      value: null,
      code: null,
      band: null,
      confidence: "low",
      sources: [],
      flags: [],
    };
  }
  return out;
};

/** Обратный вопрос: 1↔5, 2↔4, 3→3. */
const reverse = (value: number): number => 6 - value;

/** Среднее → полоса. Таблица из content/scoring-rules.md. */
export function bandFromMean(mean: number): Band {
  if (mean <= 2.0) return "low";
  if (mean <= 2.6) return "mid-low";
  if (mean <= 3.3) return "mid";
  if (mean <= 3.9) return "mid-high";
  return "high";
}

const RHYTHM: Record<string, Omit<Assignment, "sources" | "confidence">> = {
  A: { value: "ровный поток", code: "even", band: "low" },
  B: { value: "импульсы с провалами", code: "bursts", band: "high" },
  C: { value: "сильный старт, спад к середине", code: "front_loaded", band: "mid-high" },
  D: { value: "долгая раскачка, рывок к финишу", code: "late_surge", band: "mid-high" },
};

const COMPLETION: Record<string, Omit<Assignment, "sources" | "confidence">> = {
  A: { value: "не начинаю", code: "no_start", band: "high" },
  B: { value: "схожу на первой трудности", code: "first_obstacle", band: "mid-high" },
  C: { value: "рвётся на 80%", code: "at_80", band: "mid-high" },
  D: { value: "довожу с опозданием и надрывом", code: "late_strain", band: "mid-low" },
  E: { value: "довожу почти всё начатое", code: "completes", band: "low" },
};

const STRESS: Record<string, Omit<Assignment, "sources" | "confidence">> = {
  A: { value: "ускоряюсь и беру на себя больше", code: "acceleration", band: "high" },
  B: { value: "замираю", code: "freeze", band: "low" },
  C: { value: "забираю управление", code: "control", band: "high" },
  D: { value: "ухожу внутрь", code: "withdrawal", band: "low" },
  E: { value: "ищу, где и по чьей вине сломалось", code: "blame", band: "mid-high" },
  F: { value: "переключаюсь на тех, кому плохо", code: "rescue", band: "mid" },
};

const VULNERABILITY: Record<string, { value: string; code: string }> = {
  A: { value: "не воспринимают всерьёз", code: "not_taken_seriously" },
  B: { value: "потеря контроля", code: "loss_of_control" },
  C: { value: "отвержение", code: "rejection" },
  D: { value: "ненужность", code: "insignificance" },
  E: { value: "оказаться неправым", code: "being_wrong" },
  F: { value: "ограничение", code: "restriction" },
  G: { value: "бессмысленность", code: "meaninglessness" },
};

/** Стойки для координаты 9 (content/scoring-rules.md). */
const STANCE_L3: Record<string, string> = { A: "active", C: "active", E: "active", B: "passive", D: "passive", F: "other" };
const STANCE_L4: Record<string, string> = { A: "active", E: "active", B: "passive", C: "passive", D: "passive" };

/** Подтверждение уязвимости вторым ответом. */
const VULNERABILITY_SUPPORT: Record<string, (a: LadderAnswers) => boolean> = {
  A: (a) => a.L4 === "A" || a.L4 === "E",
  B: (a) => a.L3 === "C",
  C: (a) => a.L4 === "B" || a.L4 === "C",
  D: (a) => a.L3 === "F",
  E: (a) => a.L4 === "A",
  F: (a) => (a.L10 ?? 0) >= 4,
  G: () => false,
};

export interface ProfileOptions {
  profileId?: string;
  /** Результат синтеза ступени 4: сюжет из открытого ответа (координата 15). */
  storyline?: { value: string; code: string; confidence: Confidence };
}

export function buildProfile(answers: LadderAnswers, options: ProfileOptions = {}): Profile {
  const coordinates = emptyCoordinates();
  const flags: string[] = [];

  const assign = (id: number, assignment: Assignment): void => {
    const coordinate = coordinates[id];
    if (!coordinate) throw new Error(`Неизвестная координата ${id}`);
    coordinate.value = assignment.value;
    coordinate.code = assignment.code;
    coordinate.band = assignment.band;
    coordinate.confidence = assignment.confidence;
    coordinate.sources = assignment.sources;
    coordinate.flags = assignment.flags ?? [];
    for (const flag of coordinate.flags) if (!flags.includes(flag)) flags.push(flag);
  };

  // Координата 2 — ритм расхода. Один ключевой ситуационный вопрос: потолок medium.
  if (answers.L1 && RHYTHM[answers.L1]) {
    assign(2, { ...RHYTHM[answers.L1]!, confidence: "medium", sources: [`L1:${answers.L1}`] });
  }

  // Координата 11 — доведение. L2 поведенческий и главный, L11 — самооценка.
  if (answers.L2 && COMPLETION[answers.L2]) {
    const sources = [`L2:${answers.L2}`];
    let confidence: Confidence = "medium";
    const coordinateFlags: string[] = [];

    if (answers.L11 !== undefined) {
      sources.push(`L11:${answers.L11}`);
      const needsPull = answers.L11 >= 4;
      const selfSufficient = answers.L11 <= 2;
      if (answers.L2 !== "E" && needsPull) confidence = "high";
      else if (answers.L2 === "E" && selfSufficient) confidence = "high";
      else if (answers.L2 === "E" && needsPull) coordinateFlags.push("self_report_mismatch_11");
    }

    assign(11, { ...COMPLETION[answers.L2]!, confidence, sources, flags: coordinateFlags });
  }

  // Координата 9 — сценарий под стрессом. L3 ключевой, L4 подтверждает стойку.
  if (answers.L3 && STRESS[answers.L3]) {
    const sources = [`L3:${answers.L3}`];
    let confidence: Confidence = "medium";
    if (answers.L4 && STANCE_L4[answers.L4]) {
      sources.push(`L4:${answers.L4}`);
      if (STANCE_L3[answers.L3] === STANCE_L4[answers.L4]) confidence = "high";
    }
    assign(9, { ...STRESS[answers.L3]!, confidence, sources });
  }

  // Координата 8 — базовая уязвимость.
  if (answers.L8 && VULNERABILITY[answers.L8]) {
    const supported = VULNERABILITY_SUPPORT[answers.L8]?.(answers) ?? false;
    assign(8, {
      ...VULNERABILITY[answers.L8]!,
      band: null,
      confidence: supported ? "high" : "medium",
      sources: supported ? [`L8:${answers.L8}`, "подтверждение вторым ответом"] : [`L8:${answers.L8}`],
    });
  }

  // Координата 3 — тип внимания. L5 (категориальный) + L7 (обратная шкала).
  {
    const fromChoice = answers.L5 === "A" || answers.L5 === "B" ? "concrete" : answers.L5 === "D" ? "connections" : null;
    const fromScale =
      answers.L7 === undefined ? null : answers.L7 >= 4 ? "concrete" : answers.L7 <= 2 ? "connections" : "mixed";
    const sources: string[] = [];
    if (fromChoice) sources.push(`L5:${answers.L5}`);
    if (fromScale) sources.push(`L7:${answers.L7}`);

    if (sources.length) {
      const agree = fromChoice && fromScale && fromScale !== "mixed" && fromChoice === fromScale;
      const conflict = fromChoice && fromScale && fromScale !== "mixed" && fromChoice !== fromScale;
      const direction = agree ? fromChoice : (fromScale === "mixed" ? fromChoice : fromChoice ?? fromScale);

      if (conflict) {
        assign(3, {
          value: "конкретика и связи спорят между собой",
          code: "mixed",
          band: "mid",
          confidence: "low",
          sources,
        });
      } else if (direction === "concrete") {
        assign(3, { value: "конкретное и проверяемое", code: "concrete", band: "low", confidence: agree ? "medium" : "low", sources });
      } else if (direction === "connections") {
        assign(3, { value: "связи, смыслы, возможности", code: "connections", band: "high", confidence: agree ? "medium" : "low", sources });
      } else {
        assign(3, { value: "оба режима по ситуации", code: "mixed", band: "mid", confidence: "low", sources });
      }
    }
  }

  // Координата 4 — основание решений. В лестнице только косвенно, потолок low.
  if (answers.L5 === "A") {
    assign(4, { value: "логика и критерии", code: "logic", band: "low", confidence: "low", sources: [`L5:${answers.L5}`] });
  } else if (answers.L5 === "C") {
    assign(4, { value: "люди и влияние на них", code: "people", band: "high", confidence: "low", sources: [`L5:${answers.L5}`] });
  }

  // Координата 5 — отношение к структуре. L9 прямой, L10 обратный.
  if (answers.L9 !== undefined && answers.L10 !== undefined) {
    const structured = answers.L9;
    const openEnded = reverse(answers.L10);
    const band = bandFromMean((structured + openEnded) / 2);
    const contradiction = answers.L9 >= 4 && answers.L10 >= 4;
    const spread = Math.abs(structured - openEnded);

    assign(5, {
      value: contradiction
        ? "хочет определённости и сам оставляет открытым"
        : band === "high" || band === "mid-high"
          ? "определённость и план"
          : band === "low" || band === "mid-low"
            ? "свобода и открытый финал"
            : "оба режима по ситуации",
      code: contradiction ? "plan_vs_open" : band === "mid" ? "mixed" : band === "high" || band === "mid-high" ? "structure" : "openness",
      band: contradiction ? "mid" : band,
      confidence: contradiction || spread >= 3 ? "low" : "medium",
      sources: [`L9:${answers.L9}`, `L10:${answers.L10}`],
      flags: contradiction ? ["contradiction_plan_vs_open"] : [],
    });
  }

  // Координата 7 — эмоциональная реактивность. L6 + поведение из L4.
  if (answers.L6 !== undefined) {
    const band: Band = answers.L6 >= 4 ? "high" : answers.L6 <= 2 ? "low" : "mid";
    const internalises = answers.L4 === "B" || answers.L4 === "C";
    const releases = answers.L4 === "A" || answers.L4 === "D";
    const confirmed = (answers.L6 >= 4 && internalises) || (answers.L6 <= 2 && releases);

    assign(7, {
      value: band === "high" ? "задевает надолго" : band === "low" ? "отпускает быстро" : "тяжёлое держится, обычное уходит",
      code: band === "high" ? "holds_long" : band === "low" ? "releases" : "selective",
      band,
      confidence: confirmed ? "medium" : "low",
      sources: confirmed ? [`L6:${answers.L6}`, `L4:${answers.L4}`] : [`L6:${answers.L6}`],
    });
  }

  // Координата 13 — способ входа в дело. Ключевой Q29 в лестнице не задаётся: потолок low.
  if (answers.L11 !== undefined) {
    const needsPull = answers.L11 >= 4;
    assign(13, {
      value: needsPull ? "двигается на внешний запрос и срок" : answers.L11 <= 2 ? "начинает сам" : "по ситуации",
      code: needsPull ? "needs_external_pull" : answers.L11 <= 2 ? "self_starting" : "mixed",
      band: needsPull ? "high" : answers.L11 <= 2 ? "low" : "mid",
      confidence: "low",
      sources: [`L11:${answers.L11}`],
    });
  }

  // Координата 15 — сюжет. Только из синтеза ступени 4, движок сам его не выводит.
  if (options.storyline) {
    assign(15, {
      value: options.storyline.value,
      code: options.storyline.code,
      band: null,
      confidence: options.storyline.confidence,
      sources: ["L12"],
    });
  }

  return {
    profileId: options.profileId ?? "local",
    coordinates,
    flags,
    nodes: [],
    dominantNode: null,
    nextPaidOffer: rawContent.step3.offers["default"] ?? "slice_node_finish",
  };
}

/** Координаты, по которым лестница не даёт ничего: это и есть закрытые двери. */
export function unknownCoordinates(profile: Profile): CoordinateState[] {
  return Object.values(profile.coordinates).filter((coordinate) => coordinate.sources.length === 0);
}
