/**
 * Публичная поверхность движка.
 *
 *   Ввод → Rule Engine → Profile{16} → lookup-блоки 1–3 → задание LLM на 4 →
 *   → полосы карты → двери → одно платное предложение
 *
 * См. docs/01-architecture.md. Сборка страницы живёт в `page.ts`, скоринг —
 * в `scoring.ts` и `slices.ts`, версии профиля — в `history.ts`, пересчёт при
 * правке ответов — в `revision.ts`. Здесь только то, что движок отдаёт наружу.
 */

export * from "./types.js";
export {
  applyDisagreement,
  applyDisagreements,
  blockCoordinates,
  buildProfile,
  buildProfileFromBank,
  bandFromMean,
  reverseScale,
  scoreCoordinate,
  unknownCoordinates,
  DISAGREEMENT_RULES,
  LADDER_CAP,
  type ProfileOptions,
} from "./scoring.js";
export { applyNodes, NODE_RULES, fallbackNodeText } from "./nodes.js";
export { buildMap, BAR_DEFINITIONS } from "./map.js";
export { selectOffer, selectOfferAfterSlice, buildDoors } from "./offers.js";
export {
  applySlice,
  checkThreshold,
  nextSliceAfter,
  sameSubtype,
  sliceOwnedCodes,
  subtypeRegistry,
  SCORED_SLICES,
} from "./slices.js";
export {
  diffProfiles,
  diffSincePurchase,
  emptyHistory,
  isSameProfile,
  latestSnapshot,
  purchasedSlices,
  recordPurchase,
  recordSnapshot,
  snapshotAt,
  snapshotAtPurchase,
  type CoordinateDiff,
  type ProfileDiff,
  type ProfileHistory,
  type ProfileSnapshot,
  type SnapshotReason,
} from "./history.js";
export {
  reviseAnswers,
  slotOf,
  type AnswerChange,
  type BlockSlot,
  type Revision,
  type RevisedBlock,
  type RevisionInput,
  type StoredBlock,
} from "./revision.js";
export { buildPage, buildStep0Card, completedStep, portionForStep, type PageOptions } from "./page.js";
export { rawContent } from "./generated/content.js";
