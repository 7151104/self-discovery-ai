/**
 * Состояние прохождения лестницы: курсор внутри порции, локальные ответы,
 * пауза «собираю». Сервер хранит закрытые порции; локально — черновик
 * текущего ответа и ответы открытой порции до отправки.
 */

import type { AnswerInput, PageStateDto, QuestionDto, SubmitPortionRequest } from "./contract.js";

export type Screen = "intro" | "page" | "missing" | "loading";

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

export function showMissing(session: Session): Session {
  return { ...session, screen: "missing", page: null, collecting: false };
}

export function showPage(session: Session, page: PageStateDto, mode: "load" | "advance"): Session {
  const seenBlocks = mode === "load" ? new Set(page.blocks.map((block) => block.id)) : session.seenBlocks;
  const seenBars = mode === "load" ? new Set(page.map.filter((bar) => bar.fill !== "empty").map((bar) => bar.id)) : session.seenBars;
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
  };
}

export function rememberShown(session: Session): Session {
  if (session.page === null) return session;
  return {
    ...session,
    seenBlocks: new Set(session.page.blocks.map((block) => block.id)),
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
  return { ...session, draft };
}

export function setNameError(session: Session, error: string | null): Session {
  return { ...session, nameError: error };
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
