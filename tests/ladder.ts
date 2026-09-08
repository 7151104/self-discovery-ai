/**
 * Демо-лестница для сквозных и нагрузочных прогонов.
 *
 * Ответы — демо-человек из слоя LLM: только на них эталонный конверт
 * проходит валидатор, и блок сюжета появляется по-настоящему.
 */

import { load, server } from "./load.js";

type AnswerInput =
  | { questionId: string; kind: "выбор"; option: string }
  | { questionId: string; kind: "шкала"; scale: 1 | 2 | 3 | 4 | 5 }
  | { questionId: string; kind: "открытый"; text: string }
  | { questionId: string; kind: "число"; numbers: number[] };

export type LadderPage = {
  profileId: string;
  state: string;
  offer: { slice: string } | null;
};

type Question = { id: string; step: number; type: "выбор" | "шкала" | "открытый"; options: { key: string }[] };

type Engine = { rawContent: { questions: Question[] } };
type Llm = {
  DEMO_ANSWERS: Record<string, string | number>;
  DEMO_PERSON: { name: string; birthDate: string };
};

type Support = {
  call: <T>(origin: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
  profileBody: (name?: string, birthDate?: string | null) => unknown;
};

type SliceFixtures = { sliceAnswers: (id: string) => Record<string, unknown> };

let engine: Engine | null = null;
let llm: Llm | null = null;
let support: Support | null = null;
let sliceFixtures: SliceFixtures | null = null;

const engineOf = async (): Promise<Engine> => {
  engine ??= await load<Engine>("engine/dist/index.js");
  return engine;
};

const llmOf = async (): Promise<Llm> => {
  llm ??= await load<Llm>("server/llm/dist/index.js");
  return llm;
};

const supportOf = async (): Promise<Support> => {
  support ??= await server<Support>("test-support.js");
  return support;
};

const sliceFixturesOf = async (): Promise<SliceFixtures> => {
  sliceFixtures ??= await load<SliceFixtures>("engine/dist/slice-fixtures.js");
  return sliceFixtures;
};

const localSliceQuestionId = (slice: string, questionId: string): string =>
  questionId.startsWith(`${slice}:`) ? questionId.slice(slice.length + 1) : questionId;

export const demoPerson = async (): Promise<{ name: string; birthDate: string }> => (await llmOf()).DEMO_PERSON;

export async function demoAnswersForStep(step: 1 | 2 | 3 | 4): Promise<AnswerInput[]> {
  const { rawContent } = await engineOf();
  const { DEMO_ANSWERS } = await llmOf();
  return rawContent.questions
    .filter((question) => question.step === step)
    .map((question): AnswerInput => {
      const value = DEMO_ANSWERS[question.id];
      if (value === undefined) throw new Error(`нет демо-ответа на ${question.id}`);
      if (question.type === "выбор") return { questionId: question.id, kind: "выбор", option: String(value) };
      if (question.type === "шкала") {
        return { questionId: question.id, kind: "шкала", scale: Number(value) as 1 | 2 | 3 | 4 | 5 };
      }
      return { questionId: question.id, kind: "открытый", text: String(value) };
    });
}

/** Ответ на вопрос порции: значение берётся из демо-человека по идентификатору. */
export async function demoAnswerFor(question: {
  id: string;
  kind: string;
}): Promise<AnswerInput> {
  const { DEMO_ANSWERS } = await llmOf();
  const value = DEMO_ANSWERS[question.id];
  if (value === undefined) throw new Error(`нет демо-ответа на ${question.id}`);
  if (question.kind === "выбор") return { questionId: question.id, kind: "выбор", option: String(value) };
  if (question.kind === "шкала") {
    return { questionId: question.id, kind: "шкала", scale: Number(value) as 1 | 2 | 3 | 4 | 5 };
  }
  return { questionId: question.id, kind: "открытый", text: String(value) };
}

/**
 * Ответ на вопрос добора: значение берётся из эталона среза (`sliceAnswers`),
 * а не из первых вариантов вопроса. Иначе порог не берётся, и путь
 * заканчивается уточняющими вместо отчёта.
 */
export async function sliceAnswerFor(
  slice: string,
  question: { id: string; kind: string },
): Promise<AnswerInput> {
  const { sliceAnswers } = await sliceFixturesOf();
  const value = sliceAnswers(slice)[localSliceQuestionId(slice, question.id)];
  if (value === undefined) throw new Error(`нет эталонного ответа на ${question.id} среза ${slice}`);
  if (question.kind === "выбор") return { questionId: question.id, kind: "выбор", option: String(value) };
  if (question.kind === "шкала") {
    return { questionId: question.id, kind: "шкала", scale: Number(value) as 1 | 2 | 3 | 4 | 5 };
  }
  if (question.kind === "число") {
    const numbers = Array.isArray(value) ? value.map(Number) : [Number(value)];
    return { questionId: question.id, kind: "число", numbers };
  }
  return { questionId: question.id, kind: "открытый", text: String(value) };
}

/** Профиль демо-человека, доведённый до ступени 4 по API. Очередь не крутится. */
export async function profileAtDemoLadder(origin: string): Promise<LadderPage> {
  const api = await supportOf();
  const person = await demoPerson();
  const created = await api.call<LadderPage>(origin, "POST", "/api/profiles", api.profileBody(person.name, person.birthDate));
  if (created.status >= 400) throw new Error(`создание профиля: ${created.status}`);
  let page = created.body;
  for (const step of [1, 2, 3, 4] as const) {
    const reply = await api.call<LadderPage>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: `step:${step}`,
      answers: await demoAnswersForStep(step),
      requestId: `ladder-${page.profileId}-${step}`,
    });
    if (reply.status >= 400) throw new Error(`ступень ${step}: ${reply.status}`);
    page = reply.body;
  }
  return page;
}
