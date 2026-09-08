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
  ClarificationsDto,
  CrisisDto,
  DisagreementKind,
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
import {
  applySlice,
  buildDoors,
  buildMap,
  buildPage,
  buildSliceInterludeBlock,
  checkThreshold,
  crisisNotice,
  detectCrisis,
  payScreen,
  rawContent,
  selectOfferAfterSlice,
  SCORED_SLICES,
  slicePortions,
} from "./engine.js";
import type {
  CrisisDecision,
  CrisisNotice,
  Disagreement as EngineDisagreement,
  DisagreementKind as EngineDisagreementKind,
  Door as EngineDoor,
  LadderAnswers,
  MapBar,
  Offer as EngineOffer,
  PageState,
  PageView,
  SliceAnswers,
} from "./engine.js";
import { findingsForSlice, openAnswersOf } from "../llm/dist/index.js";
import {
  ensureBlock,
  findActiveShareToken,
  findLatestJob,
  listAnswers,
  listBlocks,
  listDisagreements,
  paidSlices,
  type AnswerRecord,
  type BlockRecord,
  type DisagreementRecord,
  type GenerationJobRecord,
  type ProfileRecord,
} from "./store.js";


/** Ответы из базы в форму, которую понимает движок. */
export function toLadderAnswers(records: AnswerRecord[]): LadderAnswers {
  const answers: Record<string, string | number> = {};
  for (const record of records) answers[record.questionId] = record.value;
  return answers as LadderAnswers;
}

/**
 * Ответы добора одного среза. Тип «число» в базе лежит строкой через запятую —
 * движок ждёт число или массив.
 */
export function toSliceAnswers(records: AnswerRecord[], slice: string): SliceAnswers {
  const answers: SliceAnswers = {};
  for (const record of records) {
    const parsed = parseSliceQuestionId(record.questionId);
    if (!parsed || parsed.slice !== slice) continue;
    if (record.kind === "число") {
      const parts = String(record.value)
        .split(",")
        .map((part) => Number(part))
        .filter((value) => Number.isFinite(value));
      answers[parsed.questionId] = parts.length <= 1 ? (parts[0] ?? 0) : parts;
      continue;
    }
    answers[parsed.questionId] = record.value;
  }
  return answers;
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

/**
 * Вопрос добора по идентификатору. Список берётся у движка, а не из
 * `content.questions`: обязательный вход среза выдаётся вопросом первой порции
 * и в таблице доборов его нет.
 */
export const sliceQuestion = (slice: string, questionId: string) =>
  sliceContent(slice)?.file
    ? (slicePortions(slice)
        .flatMap((portion) => portion.questions)
        .find((candidate) => candidate.id === questionId) ?? null)
    : null;

/**
 * Контракт говорит машинными кодами, движок — формулировками из
 * `content/scoring-rules.md`. Словарь один: три варианта, потолки те же.
 */
const ENGINE_DISAGREEMENT_KIND: Record<DisagreementKind, EngineDisagreementKind> = {
  not_about_me: "это не про меня",
  partly: "частично",
  too_general: "слишком общо",
};

const STEP_OF_SLOT: Partial<Record<BlockSlot, 1 | 2 | 3 | 4>> = {
  step1: 1,
  step2: 2,
  step3: 3,
  step4: 4,
};

/** Несогласия для движка: купленный срез в карту лестницы не входит. */
function engineDisagreements(records: DisagreementRecord[]): EngineDisagreement[] {
  const result: EngineDisagreement[] = [];
  for (const record of records) {
    const step = STEP_OF_SLOT[record.slot];
    if (step === undefined) continue;
    result.push({ step, kind: ENGINE_DISAGREEMENT_KIND[record.kind] });
  }
  return result;
}

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

const toOfferDto = (offer: EngineOffer): OfferDto => {
  const screen = payScreen(offer.slice);
  return {
    slice: offer.slice,
    title: offer.title,
    price: offer.price,
    promise: offer.promise,
    questionCount: offer.questionCount,
    contents: screen.contents,
    decline: screen.decline,
  };
};

const toDoorDto = (door: EngineDoor): DoorDto => ({
  id: door.id,
  title: door.title,
  state: door.state,
  price: door.price,
  slice: door.slice,
});

const projectDoors = (page: PageView): DoorDto[] => page.doors.map(toDoorDto);

const sliceBlockReady = (stored: BlockRecord[], slice: string): boolean =>
  stored.some((block) => block.slot === `slice:${slice}` && block.status === "ready");

const interludeDto = (block: { slice: string; heading: string; paragraphs: string[] }): BlockDto => ({
  id: `slice:${block.slice}:interlude`,
  heading: block.heading,
  paragraphs: block.paragraphs,
  highlight: null,
  generation: null,
  disagreed: false,
  purchased: false,
  stale: false,
});

/**
 * Контакты помощи: в движке поле `value`, в контракте — `line`.
 * Стена `Wire<>` запрещает ключ `value` как координату.
 */
const projectCrisis = (notice: CrisisNotice | null): CrisisDto | null =>
  notice
    ? {
        place: notice.place,
        publishable: notice.publishable,
        texts: notice.texts,
        contacts: notice.contacts.map((contact) => ({ title: contact.title, line: contact.value })),
      }
    : null;

const withoutPaidDoors = (doors: DoorDto[]): DoorDto[] => doors.filter((door) => door.state !== "paid");

const blockedDecision = (reason: string): CrisisDecision => ({
  blocked: true,
  support: true,
  hits: [],
  categories: [],
  avoid: [],
  reason,
});

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

  // Состав порции считает движок: обязательный вход среза выдаётся вопросом
  // первой порции, и второй такой же список здесь его бы потерял.
  for (const { number, questions } of slicePortions(slice)) {
    const ids = questions.map((question) => sliceQuestionId(slice, question.id));
    if (ids.every((id) => answered.has(id))) continue;

    return {
      key: slicePortionKey(slice, number),
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

function projectBlocks(
  page: PageView,
  stored: BlockRecord[],
  jobs: Map<string, GenerationJobRecord>,
  disagreed: Set<string>,
): BlockDto[] {
  const bySlot = new Map(stored.map((block) => [block.slot, block]));
  const blocks: BlockDto[] = [];

  for (const block of page.blocks) {
    const slot = `step${block.step}` as BlockSlot;
    const saved = bySlot.get(slot);
    bySlot.delete(slot);
    const job = jobs.get(slot);

    // Ступени 1–3 движок собирает из контента заново, хранить их нечего.
    if (block.source === "lookup") {
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

    const fromJob = job?.status === "ready" ? job.result : null;
    blocks.push({
      id: slot,
      heading: fromJob?.heading ?? (saved?.status === "ready" ? saved.heading : block.heading),
      paragraphs: fromJob?.paragraphs ?? (saved?.status === "ready" ? saved.paragraphs : []),
      highlight: fromJob?.highlight ?? (saved?.status === "ready" ? saved.highlight : null),
      generation: job
        ? { id: job.generationId, status: job.status }
        : saved
          ? { id: saved.blockId, status: saved.status }
          : null,
      disagreed: disagreed.has(slot),
      purchased: saved?.purchased ?? false,
      stale: saved?.stale ?? false,
    });
  }

  // Блоки платных срезов движок пока не собирает: они приходят из базы (E4).
  for (const saved of bySlot.values()) {
    const job = jobs.get(saved.slot);
    const ready = saved.status === "ready" || job?.status === "ready";
    const fromJob = job?.status === "ready" ? job.result : null;
    blocks.push({
      id: saved.slot,
      heading: fromJob?.heading ?? saved.heading,
      paragraphs: ready ? (fromJob?.paragraphs ?? saved.paragraphs) : [],
      highlight: ready ? (fromJob?.highlight ?? saved.highlight) : null,
      generation: job
        ? { id: job.generationId, status: job.status }
        : { id: saved.blockId, status: saved.status },
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
  /**
   * Не подставлять сюжет из готового задания. Нужно хешу входа очереди:
   * сюжет сам появляется из генерации, и если его включить в промпт, каждый
   * успешный прогон менял бы ключ кэша и ставил бы новое задание.
   */
  omitStoryline?: boolean;
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
  const disagreementRecords = listDisagreements(db, profile.profileId);
  const storyline = options.omitStoryline
    ? undefined
    : findLatestJob(db, profile.profileId, "step4")?.result?.storyline;
  const enginePage = buildPage(
    { name: profile.name, birthDate: profile.birthDate ?? undefined },
    answers,
    {
      profileId: profile.profileId,
      disagreements: engineDisagreements(disagreementRecords),
      ...(storyline ? { storyline } : {}),
    },
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
   * можно было бы принять готовый отчёт. Блок заводится, когда добор пройден
   * целиком — кроме кризиса: вместо блока человек видит поддержку и контакты.
   *
   * Порог считает движок (`checkThreshold`). Не взят — блок заводится (чтобы
   * состояние осталось `paid_pending`), отчёт не пишется, наружу уходят
   * уточняющие из файла среза.
   */
  let slicePortion: PortionDto | null = null;
  let sliceCrisis: CrisisNotice | null = null;
  let clarifications: ClarificationsDto | null = null;
  const interludeBlocks: BlockDto[] = [];
  let workingProfile = enginePage.internal.profile;

  for (const slice of paid) {
    const remaining = projectSlicePortion(slice, answered);
    const sliceAnswers = toSliceAnswers(stored, slice);
    const open = openAnswersOf(slice, sliceAnswers);
    const crisis = detectCrisis(open.map((item) => item.text).join("\n"));

    if (crisis.blocked) {
      sliceCrisis ??= crisisNotice("paid_slice", crisis);
      continue;
    }

    if (remaining) {
      slicePortion ??= remaining;
      const interlude = buildSliceInterludeBlock(slice, sliceAnswers);
      if (interlude) interludeBlocks.push(interludeDto(interlude));
      continue;
    }

    if (!SCORED_SLICES.includes(slice)) {
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
      continue;
    }

    const findings = findingsForSlice(slice, sliceAnswers);
    const after = applySlice(slice, workingProfile, sliceAnswers, findings);
    const threshold = checkThreshold(slice, after, sliceAnswers, findings, workingProfile);

    if (threshold.blocked) {
      sliceCrisis ??= crisisNotice("paid_slice", blockedDecision(threshold.blocked));
      continue;
    }

    if (!threshold.passed) {
      clarifications ??= { slice, questions: threshold.followUps };
    } else {
      workingProfile = after;
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

  const crisis = projectCrisis(sliceCrisis ?? view.crisis);
  const ladderBlocked = detectCrisis(answers.L12 ?? "").blocked;
  const hidePaid = Boolean(crisis && (sliceCrisis || ladderBlocked));

  const blocks = listBlocks(db, profile.profileId);
  const latestJobs = new Map<string, GenerationJobRecord>();
  for (const slot of new Set(["step4" as BlockSlot, ...blocks.map((block) => block.slot)])) {
    const job = findLatestJob(db, profile.profileId, slot);
    if (job) latestJobs.set(slot, job);
  }
  const disagreed = new Set(disagreementRecords.map((record) => record.slot));
  const share = findActiveShareToken(db, profile.profileId);

  const allPaidReady = paid.length > 0 && paid.every((slice) => sliceBlockReady(blocks, slice));
  const lastReady = paid.filter((slice) => sliceBlockReady(blocks, slice)).at(-1) ?? null;

  let nextOffer: EngineOffer | null = null;
  if (!hidePaid && paid.length === 0) {
    nextOffer = view.offer;
  } else if (!hidePaid && !slicePortion && !clarifications && allPaidReady && lastReady) {
    nextOffer = selectOfferAfterSlice(lastReady, workingProfile, toSliceAnswers(stored, lastReady), paid);
  }

  const sliceDoors = (): DoorDto[] =>
    buildDoors(workingProfile, view.blocks, nextOffer, view.step).map((door) => {
      const dto = toDoorDto(door);
      if (dto.slice && sliceBlockReady(blocks, dto.slice)) {
        return { ...dto, state: "open" as const, price: null };
      }
      return dto;
    });

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
    map: projectMap(paid.length > 0 ? buildMap(workingProfile, answers) : view.map),
    blocks: [...projectBlocks(view, blocks, latestJobs, disagreed), ...interludeBlocks],
    doors: hidePaid ? withoutPaidDoors(projectDoors(view)) : paid.length > 0 ? sliceDoors() : projectDoors(view),
    offer: hidePaid ? null : nextOffer ? toOfferDto(nextOffer) : null,
    // Порция добора идёт первой: после оплаты человек видит вопросы.
    // Кризис вопросов больше не задаёт: ответ уже дан, разбор не пишется.
    nextPortion: sliceCrisis ? null : (slicePortion ?? projectPortion(view, answered)),
    crisis,
    clarifications: sliceCrisis ? null : clarifications,
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
