/**
 * Сборка состояния страницы для клиента.
 *
 * Движок считает всё: профиль, блоки ступеней 1–3, карту, двери и предложение.
 * Здесь только проекция его результата в контракт и добавление того, что живёт
 * в базе: несогласия, купленные блоки, заказы, статус генерации.
 *
 * Проекция явная, поле за полем. Внутренний профиль и задание для LLM в неё
 * не попадают, а `Wire<>` из контракта не даёт им попасть даже случайно.
 */

import type {
  BlockDto,
  BlockSlot,
  DoorDto,
  MapBarDto,
  OfferDto,
  PageStateDto,
  PageStateName,
  PortionDto,
  PortionKey,
  PublicBlockDto,
  PublicPageDto,
  PublicSlot,
} from "./contract/index.js";
import type { Db } from "./db/driver.js";
import { BAR_DEFINITIONS, buildPage, rawContent } from "./engine.js";
import type { LadderAnswers, MapBar, PageState } from "./engine.js";
import {
  ensureBlock,
  findActiveShareToken,
  listAnswers,
  listBlocks,
  listDisagreements,
  listOrders,
  type AnswerRecord,
  type BlockRecord,
  type ProfileRecord,
} from "./store.js";

/**
 * Устойчивые ключи полос карты. Номер координаты клиенту не отдаётся, но полосу
 * надо чем-то опознавать между запросами — этим ключом.
 * Состав полос задан таблицей в `docs/11-ui-page-spec.md`.
 *
 * ВРЕМЕННО. Таблица дублирует состав `BAR_DEFINITIONS` из движка и живёт здесь
 * только потому, что движок отдаёт полосу вместе с номером координаты
 * (`MapBar.coordinate`). Когда движок начнёт отдавать ключ полосы сам, эта
 * таблица и функция `barKey` уходят, а проекция берёт ключ из полосы.
 */
const BAR_IDS: Record<number, string> = {
  2: "tempo",
  11: "completion",
  9: "pressure",
  8: "trigger",
  3: "attention",
  5: "structure",
  7: "holding",
};

/** Ключи для всех полос, которые отдаёт движок. Проверяется тестом. */
export const barKey = (coordinate: number): string => BAR_IDS[coordinate] ?? `bar_${coordinate}`;

/** Ответы из базы в форму, которую понимает движок. */
export function toLadderAnswers(records: AnswerRecord[]): LadderAnswers {
  const answers: Record<string, string | number> = {};
  for (const record of records) answers[record.questionId] = record.value;
  return answers as LadderAnswers;
}

/** Порция, в которой задан вопрос лестницы. */
export function portionOf(questionId: string): PortionKey | null {
  const question = rawContent.questions.find((candidate) => candidate.id === questionId);
  if (!question) return null;
  return `step:${question.step as 1 | 2 | 3 | 4}`;
}

const projectMap = (bars: MapBar[]): MapBarDto[] =>
  bars.map((bar) => ({
    id: barKey(bar.coordinate),
    label: bar.label,
    poles: bar.poles,
    fill: bar.state,
    position: bar.position,
    category: bar.category,
    hint: bar.hint,
  }));

const projectDoors = (page: PageState): DoorDto[] =>
  page.doors.map((door) => ({
    id: door.id,
    title: door.title,
    state: door.state,
    price: door.price,
    slice: door.slice,
  }));

const projectOffer = (page: PageState): OfferDto | null =>
  page.offer
    ? {
        slice: page.offer.slice,
        title: page.offer.title,
        price: page.offer.price,
        promise: page.offer.promise,
        questionCount: page.offer.questionCount,
      }
    : null;

const projectPortion = (page: PageState, answered: Set<string>): PortionDto | null =>
  page.nextPortion
    ? {
        key: `step:${page.nextPortion.step}`,
        lead: page.nextPortion.lead,
        questions: page.nextPortion.questions.map((question) => ({
          id: question.id,
          kind: question.type,
          text: question.text,
          options: question.options,
          scale: question.scale,
        })),
        // Возврат на середине: порция та же, отвеченные вопросы не спрашиваются заново.
        answered: page.nextPortion.questions
          .map((question) => question.id)
          .filter((id) => answered.has(id)),
      }
    : null;

function projectBlocks(page: PageState, stored: BlockRecord[], disagreed: Set<string>): BlockDto[] {
  const bySlot = new Map(stored.map((block) => [block.slot, block]));
  const blocks: BlockDto[] = [];

  for (const block of page.blocks) {
    const slot = `step${block.step}` as BlockSlot;
    const saved = bySlot.get(slot);
    bySlot.delete(slot);

    // Ступени 1–3 движок собирает из контента заново, хранить их нечего.
    if (block.source === "lookup" || saved === undefined) {
      blocks.push({
        id: slot,
        heading: block.heading,
        paragraphs: block.paragraphs,
        highlight: block.highlight,
        generation: null,
        disagreed: disagreed.has(slot),
        purchased: false,
        stale: false,
      });
      continue;
    }

    const ready = saved.status === "ready";
    blocks.push({
      id: slot,
      heading: ready ? saved.heading : block.heading,
      paragraphs: ready ? saved.paragraphs : [],
      highlight: ready ? saved.highlight : null,
      generation: { id: saved.blockId, status: saved.status },
      disagreed: disagreed.has(slot),
      purchased: saved.purchased,
      stale: saved.stale,
    });
  }

  // Блоки платных срезов движок пока не собирает: они приходят из базы (E4).
  for (const saved of bySlot.values()) {
    const ready = saved.status === "ready";
    blocks.push({
      id: saved.slot,
      heading: saved.heading,
      paragraphs: ready ? saved.paragraphs : [],
      highlight: ready ? saved.highlight : null,
      generation: { id: saved.blockId, status: saved.status },
      disagreed: disagreed.has(saved.slot),
      purchased: saved.purchased,
      stale: saved.stale,
    });
  }

  return blocks;
}

function stateName(step: PageState["step"], stored: BlockRecord[], paidSlices: string[]): PageStateName {
  if (paidSlices.length) {
    const done = paidSlices.every((slice) =>
      stored.some((block) => block.slot === `slice:${slice}` && block.status === "ready"),
    );
    return done ? "paid_done" : "paid_pending";
  }
  return `s${step}` as PageStateName;
}

export interface AssembleOptions {
  db: Db;
  profile: ProfileRecord;
  /** Внешний адрес сервиса; пусто — ссылка относительная. */
  publicOrigin: string;
}

/** Постоянная ссылка на страницу. */
export const pageUrl = (publicOrigin: string, profileId: string): string => `${publicOrigin}/p/${profileId}`;

/** Адрес публичного вида. Строится из токена, а не из идентификатора профиля. */
export const shareUrl = (publicOrigin: string, token: string): string => `${publicOrigin}/s/${token}`;

/**
 * Состояние страницы целиком. Возвращает и внутренний результат движка —
 * он нужен для снимка версии профиля и наружу не уходит.
 */
export function assemble(options: AssembleOptions): { page: PageStateDto; internal: PageState } {
  const { db, profile } = options;

  const stored = listAnswers(db, profile.profileId);
  const answered = new Set(stored.map((record) => record.questionId));
  const answers = toLadderAnswers(stored);
  const enginePage = buildPage(
    { name: profile.name, birthDate: profile.birthDate ?? undefined },
    answers,
    { profileId: profile.profileId },
  );

  // Ступень 4 пишет LLM (E4). Запись блока заводится сразу, чтобы у клиента
  // с первого запроса был идентификатор генерации, за которым он следит.
  if (enginePage.llmTask) {
    ensureBlock(db, profile.profileId, {
      slot: "step4",
      profileVersion: profile.version,
      status: "pending",
      origin: "llm",
      purchased: false,
      heading: enginePage.blocks[enginePage.blocks.length - 1]?.heading ?? "",
      paragraphs: [],
      highlight: null,
    });
  }

  const paidSlices = listOrders(db, profile.profileId)
    .filter((order) => order.status === "paid")
    .map((order) => order.slice);

  // Оплаченный срез появляется на странице сразу: заголовок из `content/slices/`,
  // текст пишет LLM (E4). До текста у клиента есть идентификатор генерации.
  for (const slice of paidSlices) {
    const known = rawContent.slices.find((candidate) => candidate.id === slice);
    if (!known) continue;
    ensureBlock(db, profile.profileId, {
      slot: `slice:${slice}`,
      profileVersion: profile.version,
      status: "pending",
      origin: "llm",
      purchased: true,
      heading: known.title,
      paragraphs: [],
      highlight: null,
    });
  }

  const blocks = listBlocks(db, profile.profileId);
  const disagreed = new Set(listDisagreements(db, profile.profileId).map((record) => record.slot));
  const share = findActiveShareToken(db, profile.profileId);

  const page: PageStateDto = {
    profileId: profile.profileId,
    url: pageUrl(options.publicOrigin, profile.profileId),
    state: stateName(enginePage.step, blocks, paidSlices),
    card: {
      name: enginePage.card?.name ?? profile.name,
      season: enginePage.card?.season ?? null,
      theme: enginePage.card?.theme ?? null,
      metaphor: enginePage.card?.metaphor ?? null,
      cta: enginePage.card?.cta ?? "",
    },
    hook: enginePage.hook,
    map: projectMap(enginePage.map),
    blocks: projectBlocks(enginePage, blocks, disagreed),
    doors: projectDoors(enginePage),
    offer: projectOffer(enginePage),
    nextPortion: projectPortion(enginePage, answered),
    share: share ? { url: shareUrl(options.publicOrigin, share.token), createdAt: share.createdAt } : null,
    updatedAt: profile.updatedAt,
  };

  return { page, internal: enginePage };
}

/**
 * Публичный вид: карта, одна фраза и первые два блока.
 *
 * Узел, сюжет и купленные срезы сюда не попадают — и не потому, что здесь
 * стоит фильтр, а потому, что тип `PublicBlockDto` умеет держать только
 * `step1` и `step2`. Попытка положить сюда `BlockDto` не соберётся.
 */
export function assemblePublic(page: PageStateDto): PublicPageDto {
  const blocks: PublicBlockDto[] = [];
  for (const block of page.blocks) {
    if (!isPublicSlot(block.id)) continue;
    blocks.push({
      id: block.id,
      heading: block.heading,
      paragraphs: block.paragraphs,
      highlight: block.highlight,
    });
  }

  return {
    state: page.state,
    name: page.card.name,
    hook: page.hook,
    map: page.map,
    blocks,
  };
}

/** Сужение места блока до публичного. Без него `PublicBlockDto` не собрать. */
const isPublicSlot = (slot: BlockSlot): slot is PublicSlot => slot === "step1" || slot === "step2";
