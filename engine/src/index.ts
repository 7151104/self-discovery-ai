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
  bankAnswersFromLadder,
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
export { uiCopy, uiCopyGroup, uiCopyIds, barCopy } from "./ui-copy.js";
export { scanText, scanTexts, describeHit } from "./forbidden.js";
export {
  crisisBlocks,
  crisisContacts,
  crisisNotice,
  crisisPlaceTexts,
  crisisPublishable,
  detectCrisis,
  CRISIS_PLACES,
} from "./crisis.js";
export { selectOffer, selectOfferAfterSlice, buildDoors } from "./offers.js";
export {
  applySlice,
  checkThreshold,
  mediumOrBetter,
  nextSliceAfter,
  nextSlicePortion,
  sameSubtype,
  sliceDelivered,
  sliceOwnedCodes,
  slicePortions,
  sliceReport,
  subtypeRegistry,
  SCORED_SLICES,
  type SlicePortion,
  type SliceReport,
} from "./slices.js";
export {
  buildFullMapInterlude,
  buildFullMapProfile,
  fullMap,
  fullMapAnswered,
  fullMapBankAnswers,
  fullMapDelivered,
  fullMapInterlude,
  fullMapInterludeText,
  fullMapPortion,
  fullMapPortions,
  fullMapQuestions,
  fullMapRemainder,
  fullMapRemaining,
  fullMapReport,
  fullMapThreshold,
  nextFullMapPortion,
  FULL_MAP_SUBTYPES,
  type FullMapInput,
  type FullMapPortion,
  type FullMapReport,
  type FullMapSlice,
} from "./full-map.js";
export { buildSliceInterludeBlock, countWords, openMinWords } from "./blocks.js";
export { payScreen, payScreens, payContents, type RawPayScreen } from "./pay-screens.js";
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
export { rawExtraContent } from "./generated/content-extra.js";
export {
  consentShort,
  consentVersion,
  disclaimers,
  disclaimersAt,
  legalDocument,
  legalDocumentByPath,
  legalTitle,
  markdownSection,
  normalizeLegalSource,
  readLegalFile,
  renderLegalDocument,
  LEGAL_DOCUMENTS,
  type ConsentMarkPart,
  type ConsentShort,
  type LegalDocId,
  type LegalDocument,
  type RenderedLegalPage,
} from "./legal.js";
export { renderLegalMarkdown, SUBSTITUTION } from "./legal-markdown.js";
export { wordCount, words, unwrapLines } from "./words.js";
export {
  collectCorpus,
  degreeOf,
  formatLintReport,
  lintCorpus,
  lintEntry,
  lintSnippet,
  lookupVolume,
  rejectGroups,
  sampleFor,
  type CorpusEntry,
  type Finding,
  type LintReport,
  type WordRange,
} from "./content-linter.js";
