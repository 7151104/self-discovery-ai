/**
 * Выбор платного предложения и состав закрытых дверей.
 *
 * Правила: одно предложение после бесплатного (docs/07-monetization-route.md),
 * карта маршрута видна сразу, цена показывается только у предложенной двери
 * (docs/11-ui-page-spec.md).
 */

import { rawContent } from "./generated/content.js";
import { uiCopy } from "./ui-copy.js";
import type { Block, Door, Offer, Profile } from "./types.js";

const sliceById = (id: string) => rawContent.slices.find((slice) => slice.id === id);

export function selectOffer(profile: Profile): Offer | null {
  const slice = sliceById(profile.nextPaidOffer);
  if (!slice) return null;
  return {
    slice: slice.id,
    title: slice.title,
    price: slice.price,
    promise: slice.promise,
    questionCount: slice.questionCount,
    file: slice.file ? `content/slices/${slice.file}` : "content/slices/README.md",
  };
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

  const offered = offer?.slice ?? null;
  const seen = new Set<string>();

  for (const node of profile.nodes) {
    const sliceId = rawContent.step3.offers[node.id];
    if (!sliceId || sliceId === offered || seen.has(sliceId)) continue;
    const slice = sliceById(sliceId);
    if (!slice) continue;
    seen.add(sliceId);
    doors.push({ id: `door_${sliceId}`, title: slice.title, state: "paid", price: null, slice: sliceId });
  }

  const fullMap = sliceById("slice_full_map");
  if (fullMap && fullMap.id !== offered) {
    doors.push({ id: "door_slice_full_map", title: fullMap.title, state: "paid", price: null, slice: fullMap.id });
  }

  if (offer) {
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
