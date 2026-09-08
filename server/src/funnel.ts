/**
 * Продуктовые события воронки (E10-07) и сводка метрик генерации (E10-08).
 *
 * События пишутся в ту же таблицу `events`, что и раньше: это журнал в базе,
 * поэтому payload проходит чистку `log.ts` (E9-04). Наружу — только машинные
 * поля: профиль, ступень, слот, коды, суммы, версия сборки.
 *
 * Показ блока, крючка и предложения фиксируется один раз на профиль (и слот),
 * когда страница уже собрана: иначе каждый `GET` плодил бы события.
 */

import type { PageStateDto, PageStateName, PortionKey } from "./contract/index.js";
import type { Db } from "./db/driver.js";
import { generationTotals, listAllEvents, listEvents, recordEvent } from "./store.js";

/** Ступень воронки: лестница 0–4 или платная ветка. */
export type FunnelStep = "0" | "1" | "2" | "3" | "4" | "paid" | "none";

/**
 * Восемь ступеней приёмки E10-07. Порядок — как в маршруте: вход, порция,
 * блок, крючок, шеринг, показ предложения, оплата, срез.
 *
 * Почему именно эти события, а не каждое движение сервера: воронка отвечает
 * на вопрос «сколько людей дошло», а не «сколько раз дернули API». Правка
 * ответа, несогласие и возврат остаются в журнале, но в экран воронки не входят.
 */
export const FUNNEL_STAGES = [
  { id: "entry", event: "profile.created" },
  { id: "portion", event: "portion.submitted" },
  { id: "block", event: "block.shown" },
  { id: "hook", event: "hook.shown" },
  { id: "share", event: "share.enabled" },
  { id: "offer", event: "offer.shown" },
  { id: "payment", event: "order.paid" },
  { id: "slice", event: "slice.ready" },
] as const;

export type FunnelStageId = (typeof FUNNEL_STAGES)[number]["id"];

export interface FunnelRecord {
  profileId?: string | null;
  step: FunnelStep | string;
  version: string;
  payload?: Record<string, unknown>;
  /** Не писать повтор того же события для профиля; слот/срез различают показы. */
  once?: boolean;
}

export interface FunnelStageRow {
  id: FunnelStageId;
  event: string;
  events: number;
  profiles: number;
}

export interface FunnelSnapshot {
  version: string;
  stages: FunnelStageRow[];
}

export interface MetricsSnapshot {
  version: string;
  generation: {
    calls: number;
    avgDurationMs: number | null;
    totalCostKopecks: number;
  };
  profileCost: {
    profiles: number;
    avgKopecks: number | null;
  };
  validator: {
    jobs: number;
    rejected: number;
    rejectionRate: number | null;
  };
}

const payloadOf = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

function alreadyRecorded(db: Db, type: string, profileId: string, extra: Record<string, unknown>): boolean {
  const slot = extra["slot"];
  const slice = extra["slice"];
  return listEvents(db, profileId).some((event) => {
    if (event.type !== type) return false;
    const payload = payloadOf(event.payload);
    if (typeof slot === "string" && payload["slot"] !== slot) return false;
    if (typeof slice === "string" && payload["slice"] !== slice) return false;
    return true;
  });
}

/** Событие воронки: в payload всегда ступень и версия сборки. */
export function recordFunnel(db: Db, type: string, input: FunnelRecord): void {
  const extra = input.payload ?? {};
  if (input.once && input.profileId && alreadyRecorded(db, type, input.profileId, extra)) return;
  recordEvent(db, type, {
    profileId: input.profileId,
    payload: { step: input.step, version: input.version, ...extra },
  });
}

export function stepFromPortion(portion: PortionKey | string): FunnelStep {
  if (portion === "step:1") return "1";
  if (portion === "step:2") return "2";
  if (portion === "step:3") return "3";
  if (portion === "step:4") return "4";
  if (portion.startsWith("slice:")) return "paid";
  return "none";
}

export function stepFromPage(state: PageStateName): FunnelStep {
  if (state === "s0") return "0";
  if (state === "s1") return "1";
  if (state === "s2") return "2";
  if (state === "s3") return "3";
  if (state === "s4") return "4";
  return "paid";
}

export function stepFromSlot(slot: string): FunnelStep {
  if (slot === "step1") return "1";
  if (slot === "step2") return "2";
  if (slot === "step3") return "3";
  if (slot === "step4") return "4";
  if (slot.startsWith("slice:")) return "paid";
  return "none";
}

const isSliceReport = (slot: string): boolean => slot.startsWith("slice:") && !slot.includes("interlude");

/**
 * Первый показ крючка, блоков с текстом, предложения и готового среза.
 * Вызывается из сборки страницы: клиент этих событий не шлёт.
 */
export function notePageImpressions(db: Db, page: PageStateDto, version: string): void {
  const step = stepFromPage(page.state);
  const base = { profileId: page.profileId, step, version, once: true as const };

  if (page.hook) recordFunnel(db, "hook.shown", base);

  for (const block of page.blocks) {
    if (!block.paragraphs.length) continue;
    recordFunnel(db, "block.shown", { ...base, payload: { slot: block.id } });
    if (block.purchased && isSliceReport(block.id)) {
      recordFunnel(db, "slice.ready", { ...base, payload: { slot: block.id } });
    }
  }

  if (page.offer) {
    recordFunnel(db, "offer.shown", { ...base, payload: { slice: page.offer.slice } });
  }
}

export function buildFunnel(db: Db, version: string): FunnelSnapshot {
  const rows = listAllEvents(db);
  const stages = FUNNEL_STAGES.map((stage) => {
    const matched = rows.filter((row) => row.type === stage.event);
    const profiles = new Set(matched.map((row) => row.profileId).filter((id): id is string => Boolean(id)));
    return { id: stage.id, event: stage.event, events: matched.length, profiles: profiles.size };
  });
  return { version, stages };
}

export function buildMetrics(db: Db, version: string): MetricsSnapshot {
  const totals = generationTotals(db);
  const jobs = totals.finishedJobs;
  return {
    version,
    generation: {
      calls: totals.calls,
      avgDurationMs: totals.avgDurationMs,
      totalCostKopecks: totals.totalCostKopecks,
    },
    profileCost: {
      profiles: totals.profileCount,
      avgKopecks: totals.avgProfileCostKopecks,
    },
    validator: {
      jobs,
      rejected: totals.validatorRejected,
      rejectionRate: jobs === 0 ? null : totals.validatorRejected / jobs,
    },
  };
}
