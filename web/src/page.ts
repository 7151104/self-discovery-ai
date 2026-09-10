/**
 * Сборка личной страницы из состояния сервера.
 *
 * Одна чистая функция: из `PageStateDto` и готовых строк получается то же
 * дерево, что витрина показывает, тесты читают строкой, а живой клиент
 * монтирует в DOM. Двух реализаций страницы нет.
 *
 * Порядок экрана — `docs/11-ui-page-spec.md`. Заполненная страница (`s1` и
 * дальше): шапка, крючок, карта, блоки, порция или предложение, маршрут.
 * На `s0` работа — вопрос: порция сразу под шапкой, пустые крючок и карта
 * ниже. Ожидание подменяет блок, который ещё пишется. Пауза «собираю»
 * стоит на месте порции.
 *
 * До E7 функция жила в витрине (`web/showcase/page.ts`). Переезд — решение
 * из журнала: витрина не начинала каркас, а E7 подключает ту же сборку
 * к адресу `/p/{id}`.
 */

import { h, type Handler, type VNode } from "./dom.js";
import type { BlockDto, DisagreementKind, DoorDto, PageStateDto, PageStateName, PortionDto, PublicPageDto } from "./contract.js";
import { blockFromDto, renderBlock, type BlockAction } from "../components/block.js";
import { renderContactCard, type ContactLabels } from "../components/contact.js";
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
    note: string;
    zoneLabel: (bar: PageStateDto["map"][number], zone: Zone) => string;
    fillLabels: Record<PageStateDto["map"][number]["fill"], string>;
  };
  route: {
    label: string;
    note: string;
    formatPrice: (price: number) => string;
    tag: (state: DoorDto["state"]) => string;
  };
  block: {
    actions: BlockAction[];
    updated: string;
    diverged: string;
    stitch?: string;
    disagreeDone?: string;
    disagreeTitle?: string;
    disagreeEffect?: string;
    disagreeKinds?: { id: DisagreementKind; label: string }[];
    acknowledged?: string;
  };
  offer: OfferLabels;
  portion: {
    title: string;
    back: string;
    scaleMarks: [string, string, string, string, string];
    scaleHint: string;
    openHint: string;
    openSubmit: string;
    counterText: (state: { words: number }) => string;
    progress: (index: number, total: number) => string;
  };
  /** Заголовок уточняющих: строка `UI_PAY_QUESTIONS` с числом вопросов. */
  clarificationsTitle: (count: number) => string;
  wait: {
    title: (state: WaitState) => string;
    topics: (page: PageStateDto) => string | null;
    longNote: (state: WaitState) => string | null;
    resumedNote: (state: WaitState) => string | null;
    collecting: string;
  };
  head: { period: (theme: string) => string; noPeriod: string; linkHint: string; emptyHook: string };
  reading: { title: string; empty: string };
  public?: { makeOwn: string; makeOwnHint: string; title?: string };
  brand?: { src: string; alt: string };
  contact?: ContactLabels & { saved: string; later: string };
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
  contactValues?: { email: string; channel: string };
  contactError?: string | null;
  contactOpen?: boolean;
  onContactInput?: (field: "email" | "channel", value: string) => void;
  onContactSubmit?: (value: { email: string; channel: string }) => void;
  onContactSkip?: () => void;
  onContactLater?: () => void;
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

const isInterlude = (block: BlockDto): boolean => block.id.includes(":interlude");

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
  title: labels.portion.title,
  lead: page.nextPortion?.lead ?? "",
  progress: labels.portion.progress(index, total),
  back: labels.portion.back,
  scaleMarks: labels.portion.scaleMarks,
  scaleHint: labels.portion.scaleHint,
  openHint: labels.portion.openHint,
  openSubmit: labels.portion.openSubmit,
  counterText: (state) => labels.portion.counterText(state),
  submitFromWords: page.nextPortion?.key.startsWith("slice:") ? 1 : undefined,
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
    contact: { status: "hidden" },
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

  const owner = options.publicView !== true;
  const afterFirstPortion = page.state !== "s0" && page.url.length > 0;
  const contactStatus = page.contact?.status ?? "hidden";
  const showContactCard =
    owner &&
    labels.contact !== undefined &&
    (contactStatus === "ask" || (contactStatus === "skipped" && options.contactOpen === true));
  const showLater =
    owner && contactStatus === "skipped" && options.contactOpen !== true && options.onContactLater !== undefined;
  const catalogTitle = (text: string): VNode => h("h2", { class: "section-title visually-hidden" }, text);
  const children: VNode[] = [
    renderHead(card, {
      linkHint: owner && afterFirstPortion ? labels.head.linkHint : null,
      linkHref: owner && afterFirstPortion ? page.url : null,
      brand: labels.brand ?? null,
      laterContact:
        showLater && labels.contact
          ? { label: labels.contact.later, onSelect: options.onContactLater as () => void }
          : null,
    }),
  ];
  if (options.notice) children.push(...renderNotices(options.notice));

  const portrait = h(
    "div",
    { class: "page__portrait" },
    page.hook ? renderHook(page.hook) : renderHook(labels.head.emptyHook, { empty: true }),
    renderMap({
      bars: page.map,
      label: labels.map.label,
      note: labels.map.note,
      zoneLabel: labels.map.zoneLabel,
      fillLabels: labels.map.fillLabels,
      animated: options.seenBars,
    }),
  );
  const share = options.sharePanel ? renderSharePanel(options.sharePanel) : null;

  const readingBlocks = orderedBlocks(visibleBlocks);
  const shareHostId = [...readingBlocks]
    .reverse()
    .find((block) => !isInterlude(block) && block.generation?.status !== "pending")?.id;
  const readingChildren: VNode[] = [catalogTitle(labels.reading.title)];
  if (readingBlocks.length === 0 && owner) {
    readingChildren.push(h("p", { class: "section-note" }, labels.reading.empty));
  }

  for (const block of readingBlocks) {
    if (block.generation?.status === "pending") {
      if (wait !== null) {
        readingChildren.push(
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
    const blockActionsFor = actions
      .filter((action) => action.id !== "share" || block.id === shareHostId)
      .map((action) => {
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
    const visibleActions = isInterlude(block)
      ? []
      : picking
        ? blockActionsFor.filter((action) => action.id !== "disagree")
        : blockActionsFor;
    const staleNote = blockNote(block, labels);
    const note = staleNote ?? (block.disagreed ? (labels.block.acknowledged ?? null) : null);
    readingChildren.push(
      renderBlock({
        ...blockFromDto(block, { actions: visibleActions, note }),
        note,
        stitchLabel: labels.block.stitch,
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

  const reading =
    owner || readingBlocks.length > 0
      ? h(
          "section",
          { class: "reading", "data-empty": readingBlocks.length === 0 ? "true" : "false" },
          ...readingChildren,
        )
      : null;

  const workbench: VNode[] = [];
  if (options.collecting === true) {
    workbench.push(
      renderWait({
        title: labels.wait.collecting,
        kind: "collecting",
        entering: true,
      }),
    );
  } else if (page.nextPortion !== null && page.nextPortion.questions.length > 0) {
    const current = currentQuestion(page.nextPortion, options.portionIndex);
    workbench.push(
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
  } else if ((page.clarifications?.questions.length ?? 0) > 0) {
    const items = page.clarifications?.questions ?? [];
    workbench.push(
      h(
        "section",
        {
          class: "block",
          "data-clarifications": page.clarifications?.slice ?? "",
        },
        h("h2", { class: "block__heading" }, labels.clarificationsTitle(items.length)),
        ...items.map((text) => h("p", { class: "block__paragraph" }, text)),
      ),
    );
  } else if (!waiting && page.offer !== null && options.publicView !== true) {
    workbench.push(
      renderOffer({
        offer: page.offer,
        labels: labels.offer,
        onBuy: options.onBuy,
        onDecline: options.onDecline,
      }),
    );
  }

  const afterWorkbench: VNode[] = [];
  if (showContactCard && labels.contact) {
    afterWorkbench.push(
      renderContactCard({
        labels: labels.contact,
        values: options.contactValues,
        error: options.contactError,
        onInput: options.onContactInput,
        onSubmit: options.onContactSubmit,
        onSkip: options.onContactSkip,
      }),
    );
  } else if (owner && contactStatus === "saved" && labels.contact) {
    afterWorkbench.push(h("p", { class: "contact__saved", "data-screen": "contact-saved" }, labels.contact.saved));
  }

  if (page.doors.length > 0 && options.publicView !== true) {
    afterWorkbench.push(
      renderRoute({
        doors: page.doors,
        context: routeContext(page),
        formatPrice: labels.route.formatPrice,
        notes: doorNotes(page, labels),
        label: labels.route.label,
        note: page.state === "s0" ? labels.route.note : null,
        strict: false,
      }),
    );
  }

  if (options.publicView === true && labels.public) {
    afterWorkbench.push(
      h(
        "div",
        { class: "page__own" },
        h("p", { class: "page__own-hint" }, labels.public.makeOwnHint),
        h("button", { class: "missing__action", type: "button", onClick: options.onOwn }, labels.public.makeOwn),
      ),
    );
  }

  const cabinet = [portrait, share, reading].filter((node): node is VNode => node !== null);
  if (page.state === "s0") children.push(...workbench, ...cabinet);
  else children.push(...cabinet, ...workbench);
  children.push(...afterWorkbench);

  return h(
    "div",
    {
      class: "page",
      lang: "ru",
      "data-page": page.state,
      "data-edge": options.notice?.id ?? null,
      "data-collecting": options.collecting === true ? "on" : "off",
      "data-profiled": PROFILED.has(page.state) ? "true" : "false",
      "data-view": options.publicView === true ? "public" : "owner",
    },
    ...children,
  );
}
