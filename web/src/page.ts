/**
 * Сборка личной страницы из состояния сервера.
 *
 * Одна чистая функция: из `PageStateDto` и готовых строк получается то же
 * дерево, что витрина показывает, тесты читают строкой, а живой клиент
 * монтирует в DOM. Двух реализаций страницы нет.
 *
 * Порядок экрана — `docs/11-ui-page-spec.md`: шапка, крючок, карта, блоки,
 * порция или предложение, маршрут. Ожидание подменяет блок, который ещё
 * пишется. Пауза «собираю» стоит на месте порции.
 *
 * До E7 функция жила в витрине (`web/showcase/page.ts`). Переезд — решение
 * из журнала: витрина не начинала каркас, а E7 подключает ту же сборку
 * к адресу `/p/{id}`.
 */

import { h, type Handler, type VNode } from "./dom.js";
import type { BlockDto, DisagreementKind, DoorDto, PageStateDto, PageStateName, PortionDto, PublicPageDto } from "./contract.js";
import { blockFromDto, renderBlock, type BlockAction } from "../components/block.js";
import { renderRoute, type RouteContext } from "../components/door.js";
import { enterFlag } from "./motion.js";
import { renderMap, type Zone } from "../components/map.js";
import { renderOffer, type OfferLabels } from "../components/offer.js";
import { renderHead, renderHook } from "../components/page-head.js";
import { renderPortion, type PortionLabels } from "../components/portion.js";
import { renderSharePanel, type SharePanelProps } from "../components/share-panel.js";
import { renderWait, waitFromPage, type WaitState } from "../components/wait.js";

/** Подписи дверей становятся профильными после ступени 3. */
const PROFILED: ReadonlySet<PageStateName> = new Set(["s3", "s4", "paid_pending", "paid_done"]);

/**
 * «Поделиться» — с состояния `s2` (вопрос 21). Раньше посторонний увидел бы
 * пустую карту без фразы: ссылка сработала бы против продукта.
 */
const SHARE_FROM: ReadonlySet<PageStateName> = new Set(["s2", "s3", "s4", "paid_pending", "paid_done"]);

const BLOCK_RANK: Record<string, number> = { step1: 1, step2: 2, step3: 3, step4: 4 };

export interface PageNotice {
  id: string;
  texts: string[];
  tone?: "crisis" | "rest";
}

export interface PageViewLabels {
  map: {
    label: string;
    zoneLabel: (bar: PageStateDto["map"][number], zone: Zone) => string;
    fillLabels: Record<PageStateDto["map"][number]["fill"], string>;
  };
  route: {
    label: string;
    formatPrice: (price: number) => string;
    tag: (state: DoorDto["state"]) => string;
  };
  block: {
    actions: BlockAction[];
    updated: string;
    diverged: string;
    disagreeDone?: string;
    disagreeTitle?: string;
    disagreeEffect?: string;
    disagreeKinds?: { id: DisagreementKind; label: string }[];
    acknowledged?: string;
  };
  offer: OfferLabels;
  portion: {
    back: string;
    scaleMarks: [string, string, string, string, string];
    scaleHint: string;
    openHint: string;
    openSubmit: string;
    counterText: (state: { words: number }) => string;
    progress: (index: number, total: number) => string;
  };
  wait: {
    title: (state: WaitState) => string;
    topics: (page: PageStateDto) => string | null;
    longNote: (state: WaitState) => string | null;
    resumedNote: (state: WaitState) => string | null;
    collecting: string;
  };
  head: { period: (theme: string) => string; noPeriod: string };
  public?: { makeOwn: string; makeOwnHint: string; title?: string };
}

export interface PageViewOptions {
  notice?: PageNotice | null;
  /** Какой вопрос порции показать. По умолчанию — первый без ответа. */
  portionIndex?: number;
  portionValue?: string | null;
  now?: number;
  reopened?: boolean;
  /** Пауза «собираю» между последним ответом порции и новым блоком. */
  collecting?: boolean;
  /**
   * Полосы, маркер которых уже приезжал. Повторный показ не запускает
   * анимацию заново (`docs/11-ui-page-spec.md`).
   */
  seenBars?: ReadonlySet<string>;
  /** Блоки, которые человек уже видел: они не проявляются при перерисовке. */
  seenBlocks?: ReadonlySet<string>;
  onAnswer?: Handler;
  onBack?: Handler;
  onSubmit?: Handler;
  /** Публичный вид: без действий блока и без маршрута оплаты. */
  publicView?: boolean;
  /** Блок, у которого открыт выбор варианта несогласия. */
  disagreeing?: string | null;
  onDisagree?: (blockId: string) => void;
  onDisagreePick?: (blockId: string, kind: DisagreementKind) => void;
  onShare?: () => void;
  onDecline?: Handler;
  onBuy?: Handler;
  onOwn?: Handler;
  sharePanel?: SharePanelProps | null;
}

const routeContext = (page: PageStateDto): RouteContext => ({
  offerSlice: page.offer?.slice ?? null,
  profiled: PROFILED.has(page.state),
});

const doorNotes = (page: PageStateDto, labels: PageViewLabels): Record<string, string> =>
  Object.fromEntries(page.doors.map((door) => [door.id, labels.route.tag(door.state)]));

const blockNote = (block: BlockDto, labels: PageViewLabels): string | null => {
  if (!block.stale) return null;
  return block.purchased ? labels.block.diverged : labels.block.updated;
};

const blockActions = (page: PageStateDto, labels: PageViewLabels): BlockAction[] =>
  SHARE_FROM.has(page.state) ? labels.block.actions : labels.block.actions.filter((action) => action.id !== "share");

const orderedBlocks = (blocks: BlockDto[]): BlockDto[] =>
  [...blocks].sort((left, right) => (BLOCK_RANK[left.id] ?? 10) - (BLOCK_RANK[right.id] ?? 10));

export const currentQuestion = (
  portion: PortionDto,
  override?: number,
): { question: PortionDto["questions"][number]; index: number } => {
  if (override !== undefined) {
    const question = portion.questions[override];
    if (question === undefined) throw new Error(`в порции ${portion.key} нет вопроса ${override}`);
    return { question, index: override };
  }
  const answered = new Set(portion.answered);
  const index = portion.questions.findIndex((question) => !answered.has(question.id));
  const safe = index === -1 ? Math.max(0, portion.questions.length - 1) : index;
  const question = portion.questions[safe];
  if (question === undefined) throw new Error(`порция ${portion.key} пустая`);
  return { question, index: safe };
};

const portionLabels = (page: PageStateDto, labels: PageViewLabels, index: number, total: number): PortionLabels => ({
  lead: page.nextPortion?.lead ?? "",
  progress: labels.portion.progress(index, total),
  back: labels.portion.back,
  scaleMarks: labels.portion.scaleMarks,
  scaleHint: labels.portion.scaleHint,
  openHint: labels.portion.openHint,
  openSubmit: labels.portion.openSubmit,
  counterText: (state) => labels.portion.counterText(state),
});

const renderNotices = (notice: PageNotice): VNode[] =>
  notice.texts.map((text) =>
    h("p", { class: "page__notice", "data-edge": notice.id, "data-tone": notice.tone ?? "rest" }, text),
  );

export function filledBars(page: PageStateDto): number {
  return page.map.filter((bar) => bar.fill !== "empty").length;
}

/**
 * Публичный ответ сервера в ту же форму, которую собирает страница.
 * Блоков 3 и 4 в нём нет по типу: подставить их нечем.
 */
export function pageFromPublic(view: PublicPageDto): PageStateDto {
  return {
    profileId: "",
    url: "",
    state: view.state,
    card: { name: view.name, season: null, theme: null, metaphor: null, cta: "" },
    hook: view.hook,
    map: view.map,
    blocks: view.blocks.map((block) => ({
      id: block.id,
      heading: block.heading,
      paragraphs: block.paragraphs,
      highlight: block.highlight,
      generation: null,
      disagreed: false,
      purchased: false,
      stale: false,
    })),
    doors: [],
    offer: null,
    nextPortion: null,
    share: null,
    updatedAt: "",
  };
}

export function renderPersonalPage(page: PageStateDto, labels: PageViewLabels, options: PageViewOptions = {}): VNode {
  const now = options.now ?? Date.parse(page.updatedAt);
  const wait = waitFromPage(page, { now, reopened: options.reopened === true });
  const waiting = wait !== null;
  const theme = page.card.theme === null ? null : labels.head.period(page.card.theme);
  const publicTitle = options.publicView === true ? labels.public?.title : undefined;
  const card = {
    ...page.card,
    name: publicTitle ?? page.card.name,
    theme,
    metaphor: page.card.theme === null ? null : page.card.metaphor,
  };
  const actions = options.publicView === true ? [] : blockActions(page, labels);
  const seenBlocks = options.seenBlocks ?? new Set(page.blocks.map((block) => block.id));
  const kinds = labels.block.disagreeKinds ?? [];
  const visibleBlocks =
    options.publicView === true
      ? page.blocks.filter((block) => block.id === "step1" || block.id === "step2")
      : page.blocks;

  const children: VNode[] = [renderHead(card)];
  if (options.notice) children.push(...renderNotices(options.notice));
  if (page.hook) children.push(renderHook(page.hook));

  children.push(
    renderMap({
      bars: page.map,
      label: labels.map.label,
      zoneLabel: labels.map.zoneLabel,
      fillLabels: labels.map.fillLabels,
      animated: options.seenBars,
    }),
  );

  if (options.sharePanel) children.push(renderSharePanel(options.sharePanel));

  for (const block of orderedBlocks(visibleBlocks)) {
    if (block.generation?.status === "pending") {
      if (wait !== null) {
        children.push(
          renderWait({
            title: labels.wait.title(wait),
            topics: labels.wait.topics(page),
            longNote: labels.wait.longNote(wait),
            resumedNote: labels.wait.resumedNote(wait),
            kind: wait.kind,
            entering: options.reopened === true ? false : enterFlag(block.id, seenBlocks) === "on",
          }),
        );
      }
      continue;
    }
    if (block.generation?.status === "failed") continue;
    const picking = options.disagreeing === block.id && kinds.length > 0;
    const blockActionsFor = actions.map((action) => {
      if (action.id === "disagree") {
        return {
          ...action,
          label: block.disagreed ? (labels.block.disagreeDone ?? action.label) : action.label,
          onSelect: () => options.onDisagree?.(block.id),
        };
      }
      if (action.id === "share") {
        return { ...action, onSelect: options.onShare };
      }
      return action;
    });
    const visibleActions = picking ? blockActionsFor.filter((action) => action.id !== "disagree") : blockActionsFor;
    const staleNote = blockNote(block, labels);
    const note = staleNote ?? (block.disagreed ? (labels.block.acknowledged ?? null) : null);
    children.push(
      renderBlock({
        ...blockFromDto(block, { actions: visibleActions, note }),
        note,
        actions: visibleActions,
        picker: picking
          ? {
              title: labels.block.disagreeTitle ?? "",
              options: kinds.map((kind) => ({
                id: kind.id,
                label: kind.label,
                onSelect: () => options.onDisagreePick?.(block.id, kind.id),
              })),
              note: labels.block.disagreeEffect ?? null,
            }
          : null,
        entering: enterFlag(block.id, seenBlocks) === "on",
      }),
    );
  }

  if (options.collecting === true) {
    children.push(
      renderWait({
        title: labels.wait.collecting,
        kind: "collecting",
        entering: true,
      }),
    );
  } else if (page.nextPortion !== null && page.nextPortion.questions.length > 0) {
    const current = currentQuestion(page.nextPortion, options.portionIndex);
    children.push(
      renderPortion({
        id: page.nextPortion.key,
        question: current.question,
        index: current.index,
        total: page.nextPortion.questions.length,
        labels: portionLabels(page, labels, current.index, page.nextPortion.questions.length),
        value: options.portionValue ?? null,
        onAnswer: options.onAnswer,
        onBack: options.onBack,
        onSubmit: options.onSubmit,
      }),
    );
  } else if (!waiting && page.offer !== null && options.publicView !== true) {
    children.push(
      renderOffer({
        offer: page.offer,
        labels: labels.offer,
        onBuy: options.onBuy,
        onDecline: options.onDecline,
      }),
    );
  }

  if (page.doors.length > 0 && options.publicView !== true) {
    children.push(
      renderRoute({
        doors: page.doors,
        context: routeContext(page),
        formatPrice: labels.route.formatPrice,
        notes: doorNotes(page, labels),
        label: labels.route.label,
        strict: false,
      }),
    );
  }

  if (options.publicView === true && labels.public) {
    children.push(
      h(
        "div",
        { class: "page__own" },
        h("p", { class: "page__own-hint" }, labels.public.makeOwnHint),
        h("button", { class: "missing__action", type: "button", onClick: options.onOwn }, labels.public.makeOwn),
      ),
    );
  }

  return h(
    "div",
    {
      class: "page",
      "data-page": page.state,
      "data-edge": options.notice?.id ?? null,
      "data-collecting": options.collecting === true ? "on" : "off",
      "data-profiled": PROFILED.has(page.state) ? "true" : "false",
      "data-view": options.publicView === true ? "public" : "owner",
    },
    ...children,
  );
}
