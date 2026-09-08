/**
 * Живой клиент личной страницы: адрес `/p/{profileId}`, ступень 0, порции,
 * несогласие, ступень 4 с ожиданием генерации, публичный вид и краевые состояния.
 *
 * Состояние страницы приходит с сервера. Сборку экрана делает
 * `renderPersonalPage` — та же функция, что у витрины.
 */

import { renderConsent } from "../components/consent.js";
import { renderDisclaimerList } from "../components/disclaimer.js";
import { renderFooter } from "../components/footer.js";
import { renderIntro } from "../components/intro.js";
import { renderMissing } from "../components/missing.js";
import type { SharePanelProps } from "../components/share-panel.js";
import { countWords, SUBMIT_FROM_WORDS } from "../components/open-field.js";
import { h, mount, type VNode } from "./dom.js";
import type { AnswerInput, DisagreementKind, PageStateDto, QuestionDto } from "./contract.js";
import {
  createProfile,
  disagree,
  enableShare,
  loadGeneration,
  loadPage,
  loadPublic,
  purchase,
  revokeShare,
  submitPortion,
  type Transport,
} from "./api.js";
import { edgeNotice } from "./edges.js";
import { collectingPause, scrollToNewBlock, windowHost, type MotionHost } from "./motion.js";
import { startPoll, windowTimer, type Poller, type TimerHost } from "./poll.js";
import {
  consentCopy,
  consentVersionOf,
  disclaimerPlaces,
  disclaimersFor,
  footerHeading,
  footerLinks,
  unfilledLabel,
} from "./legal-copy.js";
import {
  errorTexts,
  introTexts,
  missingTexts,
  publicNotice,
  publicTexts,
  shareTexts,
} from "./page-copy.js";
import { pageLabels } from "./page-labels.js";
import { pageFromPublic, renderPersonalPage } from "./page.js";
import { pageHref, parseRoute } from "./route.js";
import {
  acceptAnswer,
  choiceAnswer,
  declineOffer,
  emptySession,
  goBack,
  markPaymentFailed,
  markShareClosed,
  newRequestId,
  numberAnswer,
  openAnswer,
  openShare,
  portionRequest,
  rememberShown,
  replacePage,
  setDisagreeing,
  setDraft,
  setIntroValue,
  setNameError,
  showIntro,
  showMissing,
  showPage,
  showPublic,
  storedValue,
  type Session,
} from "./session.js";
import { shareDataFromPage, shareImage } from "../share/image.js";

export interface AppHost extends Transport {
  location: { pathname: string };
  history?: { pushState: (data: unknown, title: string, url: string) => void };
  motion?: MotionHost | null;
  /** Часы опроса. Не движение: при снижении движения опрос не схлопывается. */
  timer?: TimerHost | null;
  now?: () => number;
  title?: (text: string) => void;
  scrollRoot?: { querySelector: (selector: string) => { scrollIntoView: (options: { behavior: "smooth" | "auto"; block: "start" }) => void } | null };
  /**
   * Слой живого DOM: после смены вопроса фокус ставится на первый контроль
   * новой порции, порядок Tab не меняется.
   */
  focusRoot?: { querySelector: (selector: string) => { focus: () => void } | null };
}

export interface PageApp {
  tree: () => VNode;
  session: () => Session;
  start: () => Promise<void>;
  accept: (input: AnswerInput) => Promise<void>;
  back: () => void;
  draft: (value: string) => void;
  intro: (name: string, birthDate: string | null) => Promise<void>;
  consent: (checked: boolean) => void;
  /** Набранное на входе кладётся в состояние, чтобы перерисовка его не стёрла. */
  introInput: (field: "name" | "birthDate", value: string) => void;
  goOwn: () => void;
  openDisagree: (blockId: string) => void;
  pickDisagree: (blockId: string, kind: DisagreementKind) => Promise<void>;
  share: () => void;
  openPublicLink: () => Promise<void>;
  closePublicLink: () => Promise<void>;
  decline: () => void;
  buy: () => Promise<void>;
  /** Остановить опрос статуса. Уход со страницы и тесты. */
  stop: () => void;
  /** Дождаться текущего тика опроса. Нужно тестам: сеть внутри тика асинхронна. */
  flushWatch: () => Promise<void>;
}

const introLabels = () => ({
  title: introTexts.title(),
  about: introTexts.about(),
  nameLabel: introTexts.nameLabel(),
  namePlaceholder: introTexts.namePlaceholder(),
  nameRequired: introTexts.nameRequired(),
  dateLabel: introTexts.dateLabel(),
  dateHint: introTexts.dateHint(),
  submit: introTexts.submit(),
});

const currentQuestion = (session: Session): QuestionDto | null => {
  const portion = session.page?.nextPortion;
  if (!portion) return null;
  return portion.questions[session.questionIndex] ?? null;
};

const escapeAttr = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Первый интерактив нового вопроса: радиокнопка варианта, поле шкалы
 * или текстовое поле. Порядок в дереве не меняется — только точка входа Tab.
 */
export function firstQuestionControlSelector(kind: QuestionDto["kind"] | string, questionId: string): string {
  if (kind === "выбор" || kind === "шкала") {
    return `input[type="radio"][name="${escapeAttr(questionId)}"]`;
  }
  if (kind === "открытый") {
    return `[id="${escapeAttr(questionId)}"]`;
  }
  if (kind === "число") {
    return ".portion__number-input";
  }
  return "";
}

const questionFocusKey = (session: Session): string => {
  const question = currentQuestion(session);
  const portion = session.page?.nextPortion;
  if (question === null || portion === null || portion === undefined || session.collecting) return "";
  return `${portion.key}:${question.id}`;
};

const openSubmitFrom = (session: Session): number =>
  session.page?.nextPortion?.key.startsWith("slice:") === true ? 1 : SUBMIT_FROM_WORDS;

const ownerPage = (session: Session): PageStateDto | null => {
  if (session.page === null) return null;
  if (session.offerDeclined && session.page.offer !== null) {
    const slice = session.page.offer.slice;
    return {
      ...session.page,
      offer: null,
      doors: session.page.doors.map((door) => (door.slice === slice ? { ...door, price: null } : door)),
    };
  }
  return session.page;
};

const sharePanel = (session: Session, onOpen: () => void, onClose: () => void): SharePanelProps | null => {
  if (!session.shareOpen || session.page === null) return null;
  const shared = session.page.share;
  return {
    imageReady: shareTexts.imageReady(),
    imageOnly: shareTexts.imageOnly(),
    saveLabel: shareTexts.save(),
    svg: session.shareSvg,
    privacy: shared ? null : shareTexts.privacy(),
    live: shareTexts.live(),
    openLabel: shared ? null : shareTexts.open(),
    publicOn: shared ? shareTexts.publicOn() : null,
    link: shared ? shareTexts.link(shared.url) : null,
    closeLabel: shared ? shareTexts.close() : null,
    closed: session.shareClosed ? shareTexts.closed() : null,
    onOpen,
    onClose,
  };
};

export function renderSession(
  session: Session,
  handlers: {
    onIntro?: (name: string, birthDate: string | null) => void;
    onIntroInput?: (field: "name" | "birthDate", value: string) => void;
    onOwn?: () => void;
    onAnswer?: (event: Event) => void;
    onBack?: () => void;
    onSubmit?: () => void;
    consent?: VNode;
    submitDisabled?: boolean;
    onDisagree?: (blockId: string) => void;
    onDisagreePick?: (blockId: string, kind: DisagreementKind) => void;
    onShare?: () => void;
    onShareOpen?: () => void;
    onShareClose?: () => void;
    onDecline?: () => void;
    onBuy?: () => void;
  },
  clock: { now: number } = { now: Date.now() },
): VNode {
  if (session.screen === "missing") {
    const revoked = session.missingKind === "revoked";
    return renderMissing(
      {
        title: revoked ? publicTexts.revoked() : missingTexts.title(),
        text: revoked ? publicTexts.makeOwnHint() : missingTexts.text(),
        action: missingTexts.action(),
      },
      handlers.onOwn,
    );
  }
  if (session.screen === "intro") {
    return renderIntro({
      labels: introLabels(),
      values: { name: session.introName, birthDate: session.introDate },
      nameError: session.nameError,
      consent: handlers.consent,
      submitDisabled: handlers.submitDisabled,
      onInput: handlers.onIntroInput,
      onSubmit: (value) => handlers.onIntro?.(value.name, value.birthDate),
    });
  }
  if (session.screen === "loading" || session.page === null) {
    return h("div", { class: "page", "data-page": "loading" });
  }

  if (session.screen === "public") {
    return renderPersonalPage(session.page, pageLabels(session.page), {
      publicView: true,
      notice: publicNotice({ name: session.page.card.name, map: session.page.map }),
      seenBars: session.seenBars,
      seenBlocks: session.seenBlocks,
      onOwn: handlers.onOwn,
    });
  }

  const page = ownerPage(session);
  if (page === null) return h("div", { class: "page", "data-page": "loading" });

  const question = currentQuestion(session);
  const value = question === null ? null : storedValue(question, session.answers, session.draft);
  const labels = pageLabels(page);
  if (session.portionError) labels.portion.openHint = session.portionError;

  return renderPersonalPage(page, labels, {
    portionIndex: page.nextPortion ? session.questionIndex : undefined,
    portionValue: value,
    collecting: session.collecting,
    seenBars: session.seenBars,
    seenBlocks: session.seenBlocks,
    reopened: session.waitResumed,
    now: clock.now,
    notice: edgeNotice(page, {
      returned: session.returned,
      offerDeclined: session.offerDeclined,
      paymentFailed: session.paymentFailed,
    }),
    disagreeing: session.disagreeing,
    sharePanel: sharePanel(session, () => handlers.onShareOpen?.(), () => handlers.onShareClose?.()),
    onAnswer: handlers.onAnswer,
    onBack: handlers.onBack,
    onSubmit: handlers.onSubmit,
    onDisagree: handlers.onDisagree,
    onDisagreePick: handlers.onDisagreePick,
    onShare: handlers.onShare,
    onDecline: handlers.onDecline,
    onBuy: handlers.onBuy,
  });
}

const readInputValue = (event: Event): string | null => {
  const target = event.target as { value?: unknown } | null;
  return target && typeof target.value === "string" ? target.value : null;
};

export function createPageApp(host: AppHost, onChange?: () => void): PageApp {
  let session = emptySession();
  let pause: ReturnType<typeof collectingPause> | null = null;
  let consented = false;
  let watching: Poller | null = null;
  let watchId: string | null = null;

  const paint = () => onChange?.();
  let lastFocusKey = "";
  const restoreFocus = (current: Session) => {
    const key = questionFocusKey(current);
    if (key === "" || key === lastFocusKey) return;
    lastFocusKey = key;
    const question = currentQuestion(current);
    const root = host.focusRoot;
    if (question === null || root === undefined) return;
    const selector = firstQuestionControlSelector(question.kind, question.id);
    if (selector === "") return;
    root.querySelector(selector)?.focus();
  };
  const set = (next: Session) => {
    session = next;
    paint();
    restoreFocus(session);
  };
  const now = (): number => host.now?.() ?? Date.now();
  const timer = (): TimerHost =>
    host.timer ??
    windowTimer() ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id),
    };

  const stopWatch = (): void => {
    watching?.stop();
    watching = null;
    watchId = null;
  };

  const pendingOf = (page: PageStateDto | null) =>
    page?.blocks.find((block) => block.generation?.status === "pending")?.generation ?? null;

  const revealPage = (page: PageStateDto, mode: "load" | "advance"): void => {
    set(showPage(session, page, mode));
    if (mode === "advance") scrollToEntering();
    session = rememberShown(session);
    watchIfNeeded(session.page);
  };

  const watchIfNeeded = (page: PageStateDto | null): void => {
    const pending = pendingOf(page);
    if (page === null || pending === null) {
      stopWatch();
      return;
    }
    if (watching !== null && watchId === pending.id) return;

    stopWatch();
    const profileId = page.profileId;
    const generationId = pending.id;
    watchId = generationId;
    watching = startPoll({
      host: timer(),
      tick: async () => {
        if (session.page?.profileId !== profileId) return false;
        const status = await loadGeneration(profileId, generationId, host);
        if (!status.ok) return !status.missing;
        if (status.generation.status === "pending") {
          set({ ...session });
          return true;
        }
        const result = await loadPage(profileId, host);
        if (!result.ok) return !result.missing;
        stopWatch();
        revealPage(result.page, "advance");
        return false;
      },
    });
  };

  const chrome = (view: VNode): VNode => {
    const product = disclaimersFor(disclaimerPlaces({ screen: session.screen, page: session.page }));
    const footer = disclaimersFor(["подвал"]);
    const label = unfilledLabel();
    // Пометки состояния остаются на корне: подвал и дисклеймеры обрамляют
    // страницу, но не отменяют того, что на ней сейчас происходит.
    const marks = Object.fromEntries(
      Object.entries(view.attrs).filter(([key]) => key.startsWith("data-")),
    );
    return h(
      "div",
      { class: "page-shell", ...marks },
      view,
      renderDisclaimerList({ items: product, unfilledLabel: label }),
      renderFooter({ heading: footerHeading(), links: footerLinks() }),
      renderDisclaimerList({ items: footer, unfilledLabel: label }),
    );
  };

  const consentSlot = (): VNode => {
    const short = consentCopy();
    return renderConsent({
      title: short.title,
      body: short.body,
      mark: short.mark,
      refuse: short.refuse,
      checked: consented,
      onChange: (value) => {
        consented = value;
        paint();
      },
    });
  };

  const motion = (): MotionHost =>
    host.motion ??
    windowHost() ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id),
    };

  const scrollToEntering = () => {
    const target = host.scrollRoot?.querySelector('.block[data-enter="on"]');
    if (target) scrollToNewBlock(target, motion());
  };

  const finishPortion = async () => {
    const page = session.page;
    const payload = portionRequest(session, newRequestId());
    if (payload === null || page === null) {
      set({ ...session, collecting: false });
      return;
    }

    let arrived: PageStateDto | null = null;
    const reveal = () => {
      if (arrived === null) return;
      revealPage(arrived, "advance");
    };

    pause = collectingPause({
      host: motion(),
      onDone: () => {
        pause = null;
        reveal();
      },
    });

    const result = await submitPortion(page.profileId, payload, host);
    if (!result.ok) {
      pause?.skip();
      pause = null;
      const open = session.answers.find((answer) => answer.kind === "открытый");
      const draft = open && open.kind === "открытый" ? open.text : session.draft;
      const portionError = !result.missing && result.code === "answer_too_short" ? errorTexts.tooShort() : null;
      set({ ...session, collecting: false, draft, portionError });
      return;
    }
    arrived = result.page;
    if (pause === null || pause.done) reveal();
  };

  const app: PageApp = {
    tree: () =>
      chrome(
        renderSession(
          session,
          {
          onIntro: (name, birthDate) => {
            void app.intro(name, birthDate);
          },
          onIntroInput: (field, value) => app.introInput(field, value),
          onOwn: () => app.goOwn(),
          onAnswer: (event) => {
            const question = currentQuestion(session);
            if (question === null) return;
            const value = readInputValue(event);
            if (question.kind === "открытый" || question.kind === "число") {
              if (value !== null) app.draft(value);
              return;
            }
            if (value === null) return;
            const input = choiceAnswer(question, value);
            if (input) void app.accept(input);
          },
          onBack: () => app.back(),
          onSubmit: () => {
            const question = currentQuestion(session);
            if (question === null) return;
            if (question.kind === "открытый") void app.accept(openAnswer(question, session.draft));
            if (question.kind === "число") void app.accept(numberAnswer(question, session.draft));
          },
          onDisagree: (blockId) => app.openDisagree(blockId),
          onDisagreePick: (blockId, kind) => {
            void app.pickDisagree(blockId, kind);
          },
          onShare: () => app.share(),
          onShareOpen: () => {
            void app.openPublicLink();
          },
          onShareClose: () => {
            void app.closePublicLink();
          },
          onDecline: () => app.decline(),
          onBuy: () => {
            void app.buy();
          },
          consent: session.screen === "intro" ? consentSlot() : undefined,
          submitDisabled: session.screen === "intro" ? !consented : undefined,
          },
          { now: now() },
        ),
      ),
    session: () => session,
    start: async () => {
      stopWatch();
      const route = parseRoute(host.location.pathname);
      if (route.kind === "intro") {
        set(showIntro(session));
        host.title?.(missingTexts.title());
        return;
      }
      if (route.kind === "missing") {
        set(showMissing(session));
        return;
      }
      if (route.kind === "public") {
        const result = await loadPublic(route.token, host);
        if (!result.ok) {
          set(showMissing(session, "revoked"));
          host.title?.(publicTexts.revoked());
          return;
        }
        const page = pageFromPublic(result.page);
        set(showPublic(session, page));
        host.title?.(publicTexts.title(result.page.name));
        return;
      }
      const result = await loadPage(route.profileId, host);
      if (!result.ok) {
        set(showMissing(session));
        return;
      }
      revealPage(result.page, "load");
      host.title?.(result.page.card.name || missingTexts.title());
    },
    accept: async (input) => {
      if (input.kind === "открытый" && countWords(input.text) < openSubmitFrom(session)) {
        set(setDraft(session, input.text));
        return;
      }
      const next = acceptAnswer(session, input);
      set(next);
      if (next.collecting) await finishPortion();
    },
    back: () => set(goBack(session)),
    draft: (value) => set(setDraft(session, value)),
    intro: async (name, birthDate) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        set(setNameError(session, introTexts.nameRequired()));
        return;
      }
      if (!consented) return;
      const result = await createProfile({ name: trimmed, birthDate, consentVersion: consentVersionOf() }, host);
      if (!result.ok) {
        set(setNameError(session, errorTexts.save()));
        return;
      }
      host.history?.pushState(null, "", result.page.url || pageHref(result.page.profileId));
      revealPage(result.page, "load");
      host.title?.(result.page.card.name);
    },
    consent: (checked) => {
      consented = checked;
      paint();
    },
    // Без перерисовки: поле уже содержит набранное, а состояние нужно тому
    // перерисовыванию, которое случится дальше — например от отметки согласия.
    introInput: (field, value) => {
      session = setIntroValue(session, field, value);
    },
    goOwn: () => {
      stopWatch();
      consented = false;
      host.history?.pushState(null, "", "/");
      set(showIntro(session));
    },
    openDisagree: (blockId) => {
      set(setDisagreeing(session, session.disagreeing === blockId ? null : blockId));
    },
    pickDisagree: async (blockId, kind) => {
      const page = session.page;
      if (page === null || page.profileId.length === 0) return;
      const before = page.blocks.find((block) => block.id === blockId);
      const result = await disagree(page.profileId, blockId, kind, host);
      if (!result.ok) return;
      const after = result.page.blocks.find((block) => block.id === blockId);
      if (before && after && before.paragraphs.join("\u0000") !== after.paragraphs.join("\u0000")) {
        return;
      }
      set(replacePage(session, result.page));
    },
    share: () => {
      const page = session.page;
      if (page === null) return;
      const data = shareDataFromPage(page);
      const image = data === null ? null : shareImage(data);
      set(openShare(session, image?.svg ?? null));
    },
    openPublicLink: async () => {
      const page = session.page;
      if (page === null || page.profileId.length === 0) return;
      const result = await enableShare(page.profileId, host);
      if (!result.ok) return;
      set(replacePage({ ...session, shareOpen: true, shareClosed: false }, result.page));
    },
    closePublicLink: async () => {
      const page = session.page;
      if (page === null || page.profileId.length === 0) return;
      const result = await revokeShare(page.profileId, host);
      if (!result.ok) return;
      set(markShareClosed(replacePage({ ...session, shareOpen: true }, result.page)));
    },
    decline: () => set(declineOffer(session)),
    buy: async () => {
      const page = session.page;
      const slice = page?.offer?.slice;
      if (page === null || slice === undefined || page.profileId.length === 0) return;
      const result = await purchase(page.profileId, slice, newRequestId(), host);
      if (!result.ok) {
        set(markPaymentFailed(session));
        return;
      }
      if (result.page.nextPortion?.key.startsWith("slice:") === true) {
        revealPage(result.page, "advance");
        return;
      }
      set(replacePage(session, result.page));
      watchIfNeeded(result.page);
    },
    stop: () => {
      pause?.skip();
      pause = null;
      stopWatch();
    },
    flushWatch: () => watching?.idle() ?? Promise.resolve(),
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => app.stop());
  }

  return app;
}

/**
 * Окружение живого клиента. Собирается отдельной функцией, потому что одну
 * строку в нём проверить нельзя иначе: `fetch` вызывается как поле объекта, и
 * браузер такой вызов запрещает («Illegal invocation»), а Node — разрешает.
 * Поэтому все обращения к окну идут обёрткой с явным получателем, как в
 * `windowTimer()` и `windowHost()`.
 */
export function browserHost(): AppHost {
  return {
    location,
    history,
    fetch: (input, init) => globalThis.fetch(input, init),
    motion: windowHost(),
    timer: windowTimer(),
    scrollRoot: document,
    focusRoot: document,
    title: (text) => {
      document.title = text;
    },
  };
}

const root = typeof document === "undefined" ? null : document.querySelector("#app");
if (root !== null) {
  const host: AppHost = browserHost();
  const app = createPageApp(host, () => {
    root.replaceChildren();
    mount(app.tree(), root);
  });
  void app.start();
}
