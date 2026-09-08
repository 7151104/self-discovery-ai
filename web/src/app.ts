/**
 * Живой клиент личной страницы: адрес `/p/{profileId}`, ступень 0, порции.
 *
 * Состояние страницы приходит с сервера. Сборку экрана делает
 * `renderPersonalPage` — та же функция, что у витрины.
 */

import { renderIntro } from "../components/intro.js";
import { renderMissing } from "../components/missing.js";
import { h, mount, type VNode } from "./dom.js";
import type { AnswerInput, PageStateDto, QuestionDto } from "./contract.js";
import { createProfile, loadPage, submitPortion, type Transport } from "./api.js";
import { collectingPause, scrollToNewBlock, windowHost, type MotionHost } from "./motion.js";
import { errorTexts, introTexts, missingTexts } from "./page-copy.js";
import { pageLabels } from "./page-labels.js";
import { renderPersonalPage } from "./page.js";
import { pageHref, parseRoute } from "./route.js";
import {
  acceptAnswer,
  choiceAnswer,
  emptySession,
  goBack,
  newRequestId,
  numberAnswer,
  openAnswer,
  portionRequest,
  rememberShown,
  setDraft,
  setNameError,
  showIntro,
  showMissing,
  showPage,
  storedValue,
  type Session,
} from "./session.js";

export interface AppHost extends Transport {
  location: { pathname: string };
  history?: { pushState: (data: unknown, title: string, url: string) => void };
  motion?: MotionHost | null;
  title?: (text: string) => void;
  scrollRoot?: { querySelector: (selector: string) => { scrollIntoView: (options: { behavior: "smooth" | "auto"; block: "start" }) => void } | null };
}

export interface PageApp {
  tree: () => VNode;
  session: () => Session;
  start: () => Promise<void>;
  accept: (input: AnswerInput) => Promise<void>;
  back: () => void;
  draft: (value: string) => void;
  intro: (name: string, birthDate: string | null) => Promise<void>;
  goOwn: () => void;
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

export function renderSession(
  session: Session,
  handlers: {
    onIntro?: (name: string, birthDate: string | null) => void;
    onOwn?: () => void;
    onAnswer?: (event: Event) => void;
    onBack?: () => void;
    onSubmit?: () => void;
  },
): VNode {
  if (session.screen === "missing") {
    return renderMissing(
      { title: missingTexts.title(), text: missingTexts.text(), action: missingTexts.action() },
      handlers.onOwn,
    );
  }
  if (session.screen === "intro") {
    return renderIntro({
      labels: introLabels(),
      values: { name: session.introName, birthDate: session.introDate },
      nameError: session.nameError,
      onSubmit: (value) => handlers.onIntro?.(value.name, value.birthDate),
    });
  }
  if (session.screen === "loading" || session.page === null) {
    return h("div", { class: "page", "data-page": "loading" });
  }

  const question = currentQuestion(session);
  const value = question === null ? null : storedValue(question, session.answers, session.draft);

  return renderPersonalPage(session.page, pageLabels(session.page), {
    portionIndex: session.page.nextPortion ? session.questionIndex : undefined,
    portionValue: value,
    collecting: session.collecting,
    seenBars: session.seenBars,
    seenBlocks: session.seenBlocks,
    onAnswer: handlers.onAnswer,
    onBack: handlers.onBack,
    onSubmit: handlers.onSubmit,
  });
}

const readInputValue = (event: Event): string | null => {
  const target = event.target as { value?: unknown } | null;
  return target && typeof target.value === "string" ? target.value : null;
};

export function createPageApp(host: AppHost, onChange?: () => void): PageApp {
  let session = emptySession();
  let pause: ReturnType<typeof collectingPause> | null = null;

  const paint = () => onChange?.();
  const set = (next: Session) => {
    session = next;
    paint();
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
      set(showPage(session, arrived, "advance"));
      scrollToEntering();
      session = rememberShown(session);
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
      set({ ...session, collecting: false });
      return;
    }
    arrived = result.page;
    if (pause === null || pause.done) reveal();
  };

  const app: PageApp = {
    tree: () =>
      renderSession(session, {
        onIntro: (name, birthDate) => {
          void app.intro(name, birthDate);
        },
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
      }),
    session: () => session,
    start: async () => {
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
      const result = await loadPage(route.profileId, host);
      if (!result.ok) {
        set(showMissing(session));
        return;
      }
      set(showPage(session, result.page, "load"));
      host.title?.(result.page.card.name || missingTexts.title());
    },
    accept: async (input) => {
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
      const result = await createProfile({ name: trimmed, birthDate }, host);
      if (!result.ok) {
        set(setNameError(session, errorTexts.save()));
        return;
      }
      host.history?.pushState(null, "", result.page.url || pageHref(result.page.profileId));
      set(showPage(session, result.page, "load"));
      host.title?.(result.page.card.name);
    },
    goOwn: () => {
      host.history?.pushState(null, "", "/");
      set(showIntro(session));
    },
  };

  return app;
}

const root = typeof document === "undefined" ? null : document.querySelector("#app");
if (root !== null) {
  const host: AppHost = {
    location,
    history,
    fetch,
    motion: windowHost(),
    scrollRoot: document,
    title: (text) => {
      document.title = text;
    },
  };
  const app = createPageApp(host, () => {
    root.replaceChildren();
    mount(app.tree(), root);
  });
  void app.start();
}
