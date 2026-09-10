/**
 * Выбор платного предложения и состав закрытых дверей.
 *
 * Правила: одно предложение после бесплатного (docs/07-monetization-route.md),
 * карта маршрута видна сразу, цена показывается только у предложенной двери
 * (docs/11-ui-page-spec.md).
 */

import { rawContent } from "./generated/content.js";
import { fullMap } from "./full-map.js";
import { offerSkippingRejectedNode } from "./scoring.js";
import { nextSliceAfter } from "./slices.js";
import { uiCopy } from "./ui-copy.js";
import type { Block, Door, Offer, Profile, SliceAnswers } from "./types.js";

const sliceById = (id: string) => rawContent.slices.find((slice) => slice.id === id);

const toOffer = (id: string): Offer | null => {
  const slice = sliceById(id);
  if (!slice) return null;
  return {
    slice: slice.id,
    title: slice.title,
    price: slice.price,
    promise: slice.promise,
    questionCount: slice.questionCount,
    file: slice.file ? `content/slices/${slice.file}` : "content/slices/README.md",
  };
};

/** Срез узла, с блоком которого человек не согласился. Null — продавать можно. */
export function rejectedNodeSlice(profile: Profile): string | null {
  if (!profile.flags.includes("disagreement_step_3") || !profile.dominantNode) return null;
  return rawContent.step3.offers[profile.dominantNode] ?? null;
}

export function selectOffer(profile: Profile): Offer | null {
  const rejected = rejectedNodeSlice(profile);
  const slice =
    rejected && profile.nextPaidOffer === rejected ? offerSkippingRejectedNode(profile) : profile.nextPaidOffer;
  if (rejected && slice === rejected) return null;
  return toOffer(slice);
}

/**
 * Одно предложение после закрытого платного среза: правило берётся из таблицы
 * «Следующие двери» файла этого среза (`engine/src/slices.ts`), цена и обещание —
 * из `content/slices/`. Уже купленные срезы пропускаются.
 *
 * Полная карта в `SCORED_SLICES` не входит: следующая дверь читается из её
 * собственной таблицы, `nextSliceAfter` её не вызывает.
 */
export function selectOfferAfterSlice(
  slice: string,
  profile: Profile,
  answers: SliceAnswers,
  purchased: string[] = [],
): Offer | null {
  if (slice === "slice_full_map") {
    const next = fullMap().nextDoors.at(-1)?.slice ?? null;
    return next ? toOffer(next) : null;
  }
  return toOffer(nextSliceAfter(slice, profile, answers, purchased));
}

/**
 * Двери маршрута. Открытые блоки, одна бесплатная дверь на следующий шаг,
 * закрытые платные — по несработавшим узлам плюс полная карта.
 */
export function buildDoors(profile: Profile, blocks: Block[], offer: Offer | null, step: number): Door[] {
  const doors: Door[] = blocks.map((block) => ({
    id: `block_${block.step}`,
    title: block.heading,
    state: "open",
    price: null,
    slice: null,
  }));

  const nextFree = rawContent.questions.some((question) => question.step === step + 1);
  if (nextFree) {
    doors.push({
      id: `free_step_${step + 1}`,
      title: rawContent.leads[String(step + 1)] ?? uiCopy("UI_PORTION_TITLE"),
      state: "opens_with_answers",
      price: null,
      slice: null,
    });
  }

  const rejected = rejectedNodeSlice(profile);
  const offered = offer?.slice && offer.slice !== rejected ? offer.slice : null;
  const seen = new Set<string>();

  for (const node of profile.nodes) {
    const sliceId = rawContent.step3.offers[node.id];
    if (!sliceId || sliceId === offered || seen.has(sliceId)) continue;
    const slice = sliceById(sliceId);
    if (!slice) continue;
    seen.add(sliceId);
    // Отвергнутый узел остаётся дверью без цены: продавать его нельзя.
    doors.push({ id: `door_${sliceId}`, title: slice.title, state: "paid", price: null, slice: sliceId });
  }

  const mapDoor = sliceById("slice_full_map");
  if (mapDoor && mapDoor.id !== offered) {
    doors.push({ id: "door_slice_full_map", title: mapDoor.title, state: "paid", price: null, slice: mapDoor.id });
  }

  if (offer && offer.slice !== rejected) {
    doors.push({
      id: `offer_${offer.slice}`,
      title: offer.title,
      state: "paid",
      price: offer.price,
      slice: offer.slice,
    });
  }

  return doors;
}
