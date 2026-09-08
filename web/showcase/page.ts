/**
 * Сборка личной страницы из состояния сервера (E6-12).
 *
 * Это не маршрутизация E7 и не живой клиент: одна чистая функция, которая
 * из `PageStateDto` и готовых строк собирает то же дерево, что витрина
 * показывает, а тесты читают строкой. Настоящий интерфейс в E7 подключит
 * её к адресу `/p/{id}` и к событиям; визуал страницы с этого момента один.
 *
 * Порядок экрана — `docs/11-ui-page-spec.md`: шапка, крючок, карта, блоки,
 * порция или предложение, маршрут. Ожидание подменяет блок, который ещё
 * пишется. Краевое сообщение — сверху, после шапки.
 */

import { h, type VNode } from "../src/dom.js";
import type { BlockDto, DoorDto, PageStateDto, PageStateName, PortionDto } from "../src/contract.js";
import { blockFromDto, renderBlock, type BlockAction } from "../components/block.js";
import { renderRoute, type RouteContext } from "../components/door.js";
import { renderMap, type Zone } from "../components/map.js";
import { renderOffer, type OfferLabels } from "../components/offer.js";
import { renderHead, renderHook } from "../components/page-head.js";
import { renderPortion, type PortionLabels } from "../components/portion.js";
import { renderWait, waitFromPage, type WaitState } from "../components/wait.js";

const PROFILED: ReadonlySet<PageStateName> = new Set(["s3", "s4", "paid_pending", "paid_done"]);

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
  block: { actions: BlockAction[]; updated: string; diverged: string };
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
  };
  head: { noPeriod: string };
}

export interface PageViewOptions {
  notice?: PageNotice | null;
  /** Какой вопрос порции показать. По умолчанию — первый без ответа. */
  portionIndex?: number;
  portionValue?: string | null;
  now?: number;
  reopened?: boolean;
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

const currentQuestion = (portion: PortionDto, override?: number): { question: PortionDto["questions"][number]; index: number } => {
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

export function renderPersonalPage(page: PageStateDto, labels: PageViewLabels, options: PageViewOptions = {}): VNode {
  const now = options.now ?? Date.parse(page.updatedAt);
  const wait = waitFromPage(page, { now, reopened: options.reopened === true });
  const card = {
    ...page.card,
    theme: page.card.theme ?? labels.head.noPeriod,
  };

  const children: VNode[] = [renderHead(card)];
  if (options.notice) children.push(...renderNotices(options.notice));
  if (page.hook) children.push(renderHook(page.hook));

  children.push(
    renderMap({
      bars: page.map,
      label: labels.map.label,
      zoneLabel: labels.map.zoneLabel,
      fillLabels: labels.map.fillLabels,
    }),
  );

  for (const block of page.blocks) {
    if (block.generation?.status === "pending") {
      if (wait !== null) {
        children.push(
          renderWait({
            title: labels.wait.title(wait),
            topics: labels.wait.topics(page),
            longNote: labels.wait.longNote(wait),
            resumedNote: labels.wait.resumedNote(wait),
            kind: wait.kind,
          }),
        );
      }
      continue;
    }
    if (block.generation?.status === "failed") continue;
    children.push(
      renderBlock(
        blockFromDto(block, {
          actions: labels.block.actions,
          note: blockNote(block, labels),
        }),
      ),
    );
  }

  if (page.nextPortion !== null && page.nextPortion.questions.length > 0) {
    const current = currentQuestion(page.nextPortion, options.portionIndex);
    children.push(
      renderPortion({
        id: page.nextPortion.key,
        question: current.question,
        index: current.index,
        total: page.nextPortion.questions.length,
        labels: portionLabels(page, labels, current.index, page.nextPortion.questions.length),
        value: options.portionValue ?? null,
      }),
    );
  } else if (page.offer !== null) {
    children.push(renderOffer({ offer: page.offer, labels: labels.offer }));
  }

  if (page.doors.length > 0) {
    children.push(
      renderRoute({
        doors: page.doors,
        context: routeContext(page),
        formatPrice: labels.route.formatPrice,
        notes: doorNotes(page, labels),
        label: labels.route.label,
      }),
    );
  }

  return h(
    "div",
    {
      class: "page",
      "data-page": page.state,
      "data-edge": options.notice?.id ?? null,
    },
    ...children,
  );
}
