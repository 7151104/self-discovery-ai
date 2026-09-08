/**
 * Состояние прохождения лестницы: курсор внутри порции, локальные ответы,
 * пауза «собираю». Сервер хранит закрытые порции; локально — черновик
 * текущего ответа и ответы открытой порции до отправки.
 */

import type { AnswerInput, PageStateDto, QuestionDto, SubmitPortionRequest } from "./contract.js";

export type Screen = "intro" | "page" | "public" | "missing" | "loading";

export interface Session {
  screen: Screen;
  page: PageStateDto | null;
  questionIndex: number;
  answers: AnswerInput[];
  draft: string;
  collecting: boolean;
  nameError: string | null;
  introName: string;
  introDate: string;
  seenBlocks: Set<string>;
  seenBars: Set<string>;
  /** Блок, у которого открыт выбор варианта несогласия. */
  disagreeing: string | null;
  /** Панель шеринга открыта. */
  shareOpen: boolean;
  /** SVG картинки шеринга. null — ещё не собирали или крючка нет. */
  shareSvg: string | null;
  /** Публичную ссылку только что отозвали: показать «закрыто». */
  shareClosed: boolean;
  /** Отказ от оплаты в этот визит. */
  offerDeclined: boolean;
  /** Попытка оплаты не прошла. */
  paymentFailed: boolean;
  /** Возврат на порцию, где часть вопросов уже сохранена. */
  returned: boolean;
  /**
   * Страница открыта заново, а генерация ещё пишется. Ожидание то же,
   * пометка «продолжилась» — чтобы не выглядело как новый запуск.
   */
  waitResumed: boolean;
  /** Сервер отбил открытый ответ: подсказка поля, не заметка страницы. */
  portionError: string | null;
  missingKind: "missing" | "revoked";
}

export function emptySession(): Session {
  return {
    screen: "loading",
    page: null,
    questionIndex: 0,
    answers: [],
    draft: "",
    collecting: false,
    nameError: null,
    introName: "",
    introDate: "",
    seenBlocks: new Set(),
    seenBars: new Set(),
    disagreeing: null,
    shareOpen: false,
    shareSvg: null,
    shareClosed: false,
    offerDeclined: false,
    paymentFailed: false,
    returned: false,
    waitResumed: false,
    portionError: null,
    missingKind: "missing",
  };
}

const answeredIds = (page: PageStateDto, extra: AnswerInput[]): Set<string> =>
  new Set([...(page.nextPortion?.answered ?? []), ...extra.map((answer) => answer.questionId)]);

export function firstUnanswered(page: PageStateDto, extra: AnswerInput[] = []): number {
  const portion = page.nextPortion;
  if (!portion || portion.questions.length === 0) return 0;
  const answered = answeredIds(page, extra);
  const index = portion.questions.findIndex((question) => !answered.has(question.id));
  return index === -1 ? Math.max(0, portion.questions.length - 1) : index;
}

export function portionComplete(page: PageStateDto, answers: AnswerInput[]): boolean {
  const portion = page.nextPortion;
  if (!portion || portion.questions.length === 0) return false;
  const answered = answeredIds(page, answers);
  return portion.questions.every((question) => answered.has(question.id));
}

export function upsertAnswer(answers: AnswerInput[], input: AnswerInput): AnswerInput[] {
  return [...answers.filter((answer) => answer.questionId !== input.questionId), input];
}

export function choiceAnswer(question: QuestionDto, value: string): AnswerInput | null {
  if (question.kind === "выбор") return { questionId: question.id, kind: "выбор", option: value };
  if (question.kind === "шкала") {
    const scale = Number(value);
    if (scale === 1 || scale === 2 || scale === 3 || scale === 4 || scale === 5) {
      return { questionId: question.id, kind: "шкала", scale };
    }
  }
  return null;
}

export function openAnswer(question: QuestionDto, text: string): AnswerInput {
  return { questionId: question.id, kind: "открытый", text };
}

export function numberAnswer(question: QuestionDto, raw: string): AnswerInput {
  const numbers = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
  return { questionId: question.id, kind: "число", numbers };
}

export function storedValue(question: QuestionDto, answers: AnswerInput[], draft: string): string | null {
  const found = answers.find((answer) => answer.questionId === question.id);
  if (found === undefined) return draft.length > 0 ? draft : null;
  if (found.kind === "выбор") return found.option;
  if (found.kind === "шкала") return String(found.scale);
  if (found.kind === "открытый") return found.text;
  return found.numbers.join(",");
}

export function showIntro(session: Session): Session {
  return { ...session, screen: "intro", page: null, collecting: false, nameError: null };
}

export function showMissing(session: Session, kind: "missing" | "revoked" = "missing"): Session {
  return { ...session, screen: "missing", page: null, collecting: false, missingKind: kind };
}

/** Блоки, которые человек уже видел как текст. Ожидание в этот набор не входит: когда сюжет приедет, он проявится. */
export const shownBlockIds = (page: PageStateDto): Set<string> =>
  new Set(page.blocks.filter((block) => block.generation?.status !== "pending").map((block) => block.id));

const pendingGeneration = (page: PageStateDto): boolean =>
  page.blocks.some((block) => block.generation?.status === "pending");

export function showPage(session: Session, page: PageStateDto, mode: "load" | "advance"): Session {
  const waiting = pendingGeneration(page);
  const seenBlocks = mode === "load" ? shownBlockIds(page) : session.seenBlocks;
  const seenBars = mode === "load" ? new Set(page.map.filter((bar) => bar.fill !== "empty").map((bar) => bar.id)) : session.seenBars;
  const returned =
    mode === "load" && (page.nextPortion?.answered.length ?? 0) > 0;
  return {
    ...session,
    screen: "page",
    page,
    collecting: false,
    answers: [],
    draft: "",
    questionIndex: firstUnanswered(page, []),
    seenBlocks,
    seenBars,
    disagreeing: null,
    shareOpen: false,
    shareSvg: null,
    shareClosed: false,
    offerDeclined: mode === "load" ? false : session.offerDeclined,
    paymentFailed: mode === "load" ? false : session.paymentFailed,
    returned,
    waitResumed: mode === "load" && waiting,
    portionError: null,
  };
}

/** То же состояние страницы без сброса курсора порции: несогласие, шеринг. */
export function replacePage(session: Session, page: PageStateDto): Session {
  return {
    ...session,
    screen: "page",
    page,
    collecting: false,
    disagreeing: null,
  };
}

export function showPublic(session: Session, page: PageStateDto): Session {
  return {
    ...session,
    screen: "public",
    page,
    collecting: false,
    answers: [],
    draft: "",
    questionIndex: 0,
    seenBlocks: new Set(page.blocks.map((block) => block.id)),
    seenBars: new Set(page.map.filter((bar) => bar.fill !== "empty").map((bar) => bar.id)),
    disagreeing: null,
    shareOpen: false,
    shareSvg: null,
    returned: false,
  };
}

export function rememberShown(session: Session): Session {
  if (session.page === null) return session;
  return {
    ...session,
    seenBlocks: shownBlockIds(session.page),
    seenBars: new Set(session.page.map.filter((bar) => bar.fill !== "empty").map((bar) => bar.id)),
  };
}

export function acceptAnswer(session: Session, input: AnswerInput): Session {
  if (session.page === null || session.collecting) return session;
  const answers = upsertAnswer(session.answers, input);
  if (portionComplete(session.page, answers)) {
    return { ...session, answers, draft: "", collecting: true };
  }
  return {
    ...session,
    answers,
    draft: "",
    questionIndex: firstUnanswered(session.page, answers),
  };
}

export function goBack(session: Session): Session {
  if (session.collecting) return session;
  return { ...session, questionIndex: Math.max(0, session.questionIndex - 1), draft: "" };
}

export function setDraft(session: Session, draft: string): Session {
  return { ...session, draft, portionError: null };
}

export function setNameError(session: Session, error: string | null): Session {
  return { ...session, nameError: error };
}

/**
 * Введённое на входе имя и дата. Держатся в состоянии, а не только в поле:
 * страница перерисовывается целиком, и отметка согласия стирала бы набранное.
 */
export function setIntroValue(session: Session, field: "name" | "birthDate", value: string): Session {
  return field === "name" ? { ...session, introName: value } : { ...session, introDate: value };
}

export function setDisagreeing(session: Session, blockId: string | null): Session {
  return { ...session, disagreeing: blockId };
}

export function openShare(session: Session, svg: string | null): Session {
  return { ...session, shareOpen: true, shareSvg: svg, shareClosed: false };
}

export function markShareClosed(session: Session): Session {
  return { ...session, shareClosed: true };
}

export function declineOffer(session: Session): Session {
  return { ...session, offerDeclined: true, paymentFailed: false };
}

export function markPaymentFailed(session: Session): Session {
  return { ...session, paymentFailed: true };
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `r-${Date.now().toString(16)}`;
}

export function portionRequest(session: Session, requestId: string): SubmitPortionRequest | null {
  const portion = session.page?.nextPortion;
  if (portion === null || portion === undefined || session.answers.length === 0) return null;
  return { portion: portion.key, answers: session.answers, requestId };
}
