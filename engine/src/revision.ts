/**
 * Пересчёт страницы при правке уже данного ответа.
 *
 * Бесплатные блоки собираются заново из контента: они и так lookup, ничего
 * ценного в старой версии нет, а несоответствие ответу выглядело бы как ошибка.
 * Купленный блок не переписывается ни при какой правке — человек заплатил за
 * конкретный текст, и подменять его задним числом нельзя. Вместо перезаписи он
 * получает отметку расхождения: чем сегодняшний профиль отличается от того, по
 * которому блок был написан (`engine/src/history.ts`).
 *
 * Краевое состояние «Изменение ответа» — docs/11-ui-page-spec.md.
 */

import { buildPage, type PageOptions } from "./page.js";
import { diffProfiles, isSameProfile, recordSnapshot, snapshotAtPurchase, type ProfileDiff, type ProfileHistory } from "./history.js";
import type { Block, LadderAnswers, PageState, Step0Input } from "./types.js";

/** Место блока на странице: ступень лестницы или купленный срез. */
export type BlockSlot = `step${1 | 2 | 3 | 4}` | `slice:${string}`;

export const slotOf = (block: Block): BlockSlot => `step${block.step}`;

/** Блок, который человек уже видел. */
export interface StoredBlock {
  slot: BlockSlot;
  block: Block;
  /** Куплен: перезаписывать нельзя. */
  purchased: boolean;
}

/**
 * Что стало с блоком после правки ответа. «Оставлен как есть» — только про
 * купленные: бесплатный либо совпал с новой сборкой, либо обновился.
 */
export type BlockRevisionState = "без изменений" | "обновился" | "оставлен как есть";

export interface RevisedBlock {
  slot: BlockSlot;
  /**
   * Текст блока после правки. Для купленного — дословно прежний.
   * null — ответов на эту ступень больше не хватает, блок не собирается.
   */
  block: Block | null;
  state: BlockRevisionState;
  /**
   * Для купленного блока: чем профиль отличается от снимка на момент покупки.
   * null — расхождения нет или снимка покупки в ленте не нашлось.
   */
  divergence: ProfileDiff | null;
}

export interface AnswerChange {
  question: string;
  before: string | number | undefined;
  after: string | number | undefined;
}

export interface RevisionInput {
  input: Step0Input;
  /** Ответы до правки. */
  before: LadderAnswers;
  /** Ответы после правки. */
  after: LadderAnswers;
  /** Блоки, которые уже показаны человеку. */
  shown: StoredBlock[];
  /** Лента версий профиля: из неё берётся профиль на момент каждой покупки. */
  history?: ProfileHistory;
  options?: PageOptions;
}

export interface Revision {
  /** Пересчитанное состояние страницы. */
  page: PageState;
  blocks: RevisedBlock[];
  changedAnswers: AnswerChange[];
  /** Лента со снимком «правка ответа»; без правок возвращается прежняя. */
  history: ProfileHistory;
}

const valueAt = (answers: LadderAnswers, id: string): string | number | undefined =>
  (answers as Record<string, string | number | undefined>)[id];

/** Какие ответы изменились: правка, новый ответ или снятый. */
function changedAnswers(before: LadderAnswers, after: LadderAnswers): AnswerChange[] {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return ids
    .map((question) => ({ question, before: valueAt(before, question), after: valueAt(after, question) }))
    .filter((change) => change.before !== change.after);
}

/** Текст блока дословно: по нему решается, обновился он или нет. */
const sameText = (left: Block, right: Block): boolean =>
  left.heading === right.heading &&
  left.highlight === right.highlight &&
  left.paragraphs.length === right.paragraphs.length &&
  left.paragraphs.every((paragraph, index) => paragraph === right.paragraphs[index]);

const sliceOfSlot = (slot: BlockSlot): string | null =>
  slot.startsWith("slice:") ? slot.slice("slice:".length) : null;

/**
 * Пересчёт после правки ответа. Возвращает новое состояние страницы, судьбу
 * каждого показанного блока и ленту версий с новым снимком.
 */
export function reviseAnswers(input: RevisionInput): Revision {
  const changes = changedAnswers(input.before, input.after);
  const page = buildPage(input.input, input.after, input.options ?? {});
  const rebuilt = new Map(page.view.blocks.map((block) => [slotOf(block), block]));

  const blocks: RevisedBlock[] = input.shown.map((stored) => {
    if (stored.purchased) return keepPurchased(stored, page, input, changes);

    const fresh = rebuilt.get(stored.slot) ?? null;
    if (fresh && sameText(fresh, stored.block)) {
      return { slot: stored.slot, block: fresh, state: "без изменений", divergence: null };
    }
    return { slot: stored.slot, block: fresh, state: "обновился", divergence: null };
  });

  const history = changes.length
    ? recordSnapshot(
        input.history ?? { entries: [] },
        page.internal.profile,
        "правка ответа",
        changes.map((change) => change.question).join(", "),
      )
    : (input.history ?? { entries: [] });

  return { page, blocks, changedAnswers: changes, history };
}

/**
 * Купленный блок: текст возвращается прежним побайтно. Расхождение считается
 * от снимка на момент покупки; если снимка нет, признаком расхождения остаётся
 * сам факт правки ответов.
 */
function keepPurchased(
  stored: StoredBlock,
  page: PageState,
  input: RevisionInput,
  changes: AnswerChange[],
): RevisedBlock {
  const slice = sliceOfSlot(stored.slot);
  const snapshot = slice && input.history ? snapshotAtPurchase(input.history, slice) : null;
  const divergence = snapshot ? diffProfiles(snapshot.profile, page.internal.profile) : null;
  const diverged = divergence ? !isSameProfile(divergence) : changes.length > 0;

  return {
    slot: stored.slot,
    block: stored.block,
    state: diverged ? "оставлен как есть" : "без изменений",
    divergence: diverged ? divergence : null,
  };
}
