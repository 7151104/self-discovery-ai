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
import type { LadderAnswers, MapBar, PageState, PageView } from "./engine.js";
import {
  ensureBlock,
  findActiveShareToken,
  listAnswers,
  listBlocks,
  listDisagreements,
  paidSlices,
  type AnswerRecord,
  type BlockRecord,
  type ProfileRecord,
} from "./store.js";


/** Ответы из базы в форму, которую понимает движок. */
export function toLadderAnswers(records: AnswerRecord[]): LadderAnswers {
  const answers: Record<string, string | number> = {};
  for (const record of records) answers[record.questionId] = record.value;
  return answers as LadderAnswers;
}

/**
 * Идентификатор вопроса добора: `<срез>:<вопрос>`.
 *
 * Собственные идентификаторы вопросов в файлах срезов (`S1`, `S2`, …) у всех
 * срезов одинаковые, а ответы лежат в одной таблице по ключу «профиль плюс
 * вопрос». Без приставки ответы разных срезов затирали бы друг друга.
 * Вопросы лестницы приставки не получают: их тождество — идентификатор банка
 * (`docs/14-state.md`, решение о доборе полной карты).
 */
export const sliceQuestionId = (slice: string, questionId: string): string => `${slice}:${questionId}`;

/** Разбор такого идентификатора обратно. Не добор — null. */
export function parseSliceQuestionId(id: string): { slice: string; questionId: string } | null {
  const separator = id.indexOf(":");
  if (separator <= 0) return null;
  const slice = id.slice(0, separator);
  const questionId = id.slice(separator + 1);
  if (!rawContent.slices.some((candidate) => candidate.id === slice)) return null;
  return { slice, questionId };
}

/** Ключ порции добора: у дорогих срезов их две (`docs/07-monetization-route.md`). */
export const slicePortionKey = (slice: string, portion: number): PortionKey => `slice:${slice}:${portion}`;

/** Порция, в которой задан вопрос: ступень лестницы или порция добора. */
export function portionOf(questionId: string): PortionKey | null {
  const question = rawContent.questions.find((candidate) => candidate.id === questionId);
  if (question) return `step:${question.step as 1 | 2 | 3 | 4}`;

  const parsed = parseSliceQuestionId(questionId);
  if (!parsed) return null;

  const known = sliceQuestion(parsed.slice, parsed.questionId);
  return known ? slicePortionKey(parsed.slice, known.portion) : null;
}

const sliceContent = (slice: string) => rawContent.slices.find((candidate) => candidate.id === slice) ?? null;

const sliceQuestion = (slice: string, questionId: string) =>
  sliceContent(slice)?.questions.find((candidate) => candidate.id === questionId) ?? null;

const projectMap = (bars: MapBar[]): MapBarDto[] =>
  bars.map((bar) => ({
    id: bar.key,
    label: bar.label,
    poles: bar.poles,
    fill: bar.state,
    position: bar.position,
    category: bar.category,
    hint: bar.hint,
  }));

const projectDoors = (page: PageView): DoorDto[] =>
  page.doors.map((door) => ({
    id: door.id,
    title: door.title,
    state: door.state,
    price: door.price,
    slice: door.slice,
  }));

const projectOffer = (page: PageView): OfferDto | null =>
  page.offer
    ? {
        slice: page.offer.slice,
        title: page.offer.title,
        price: page.offer.price,
        promise: page.offer.promise,
        questionCount: page.offer.questionCount,
      }
    : null;

const projectPortion = (page: PageView, answered: Set<string>): PortionDto | null =>
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

/**
 * Порция добора: вопросы платного среза (E8-04, Закон 2).
 *
 * Возвращает первую порцию, в которой остались неотвеченные вопросы. Пока она
 * есть, отчёта по срезу не существует: платим за новые ответы, а не за
 * перелицованный старый текст.
 *
 * Подводка — обещание среза из `content/slices/README.md`: собственной строки
 * у порции добора в контенте нет, а придумывать её в коде нельзя.
 */
function projectSlicePortion(slice: string, answered: Set<string>): PortionDto | null {
  const content = sliceContent(slice);
  if (!content) return null;

  const portions = [...new Set(content.questions.map((question) => question.portion))].sort((a, b) => a - b);

  for (const portion of portions) {
    const questions = content.questions.filter((question) => question.portion === portion);
    const ids = questions.map((question) => sliceQuestionId(slice, question.id));
    if (ids.every((id) => answered.has(id))) continue;

    return {
      key: slicePortionKey(slice, portion),
      lead: content.promise,
      questions: questions.map((question) => ({
        id: sliceQuestionId(slice, question.id),
        kind: question.type,
        text: question.text,
        options: question.options,
        // Полюсов у шкал добора в контенте нет: подписи стоят в тексте вопроса.
        scale: null,
      })),
      answered: ids.filter((id) => answered.has(id)),
    };
  }

  return null;
}

function projectBlocks(page: PageView, stored: BlockRecord[], disagreed: Set<string>): BlockDto[] {
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

function stateName(step: PageView["step"], stored: BlockRecord[], paidSlices: string[]): PageStateName {
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
  const view = enginePage.view;

  // Ступень 4 пишет LLM (E4). Запись блока заводится сразу, чтобы у клиента
  // с первого запроса был идентификатор генерации, за которым он следит.
  if (enginePage.internal.llmTask) {
    ensureBlock(db, profile.profileId, {
      slot: "step4",
      profileVersion: profile.version,
      status: "pending",
      origin: "llm",
      purchased: false,
      heading: view.blocks[view.blocks.length - 1]?.heading ?? "",
      paragraphs: [],
      highlight: null,
    });
  }

  const paid = paidSlices(db, profile.profileId);

  /**
   * Закон 2: оплата открывает не отчёт, а порцию доборов.
   *
   * Пока у оплаченного среза остались неотвеченные вопросы, страница отдаёт их
   * и ничего больше: записи блока нет, а значит нет и заголовка, за которым
   * можно было бы принять готовый отчёт. Блок заводится ровно тогда, когда
   * добор пройден целиком, — с этого места срез ждёт текста от LLM (E4).
   *
   * «Добор пройден» здесь означает «на все вопросы среза есть ответы». Порог
   * генерации (E2-05) и уточняющие вопросы требуют разбора открытых ответов,
   * которого до E4 нет; когда он появится, это условие заменяется вызовом
   * `checkThreshold` — правило останется в движке, а не переедет сюда.
   */
  let slicePortion: PortionDto | null = null;
  for (const slice of paid) {
    const remaining = projectSlicePortion(slice, answered);
    if (remaining) {
      slicePortion ??= remaining;
      continue;
    }

    ensureBlock(db, profile.profileId, {
      slot: `slice:${slice}`,
      profileVersion: profile.version,
      status: "pending",
      origin: "llm",
      purchased: true,
      heading: sliceContent(slice)?.title ?? "",
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
    state: stateName(view.step, blocks, paid),
    card: {
      name: view.card?.name ?? profile.name,
      season: view.card?.season ?? null,
      theme: view.card?.theme ?? null,
      metaphor: view.card?.metaphor ?? null,
      cta: view.card?.cta ?? "",
    },
    hook: view.hook,
    map: projectMap(view.map),
    blocks: projectBlocks(view, blocks, disagreed),
    doors: projectDoors(view),
    offer: projectOffer(view),
    // Порция добора идёт первой: после оплаты человек видит вопросы.
    nextPortion: slicePortion ?? projectPortion(view, answered),
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
