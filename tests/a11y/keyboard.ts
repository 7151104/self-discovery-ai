/**
 * Клавиатурное прохождение: Tab по дереву, стрелки в группе радиокнопок,
 * пробел активирует контроль. Браузера нет — события вызываются на тех же
 * обработчиках, которые `mount` повесил бы на DOM.
 *
 * После ответа клиент ставит фокус на первый контроль нового вопроса
 * (`focusRoot`). Следующий вопрос начинается с этой точки, а не Tab'ом
 * с начала страницы.
 */

import type { Child, VNode } from "../visual/capture.js";
import type { Kit } from "../kit.js";
import { tabStops } from "./audit.js";

export type KeyName = "Tab" | "ArrowRight" | " " | "Enter" | "ввод";

type Question = {
  id: string;
  kind: string;
};

type Session = {
  screen: string;
  questionIndex: number;
  collecting: boolean;
  draft: string;
  page: {
    state: string;
    nextPortion: { key: string; questions: Question[] } | null;
  } | null;
};

type AnswerInput = { questionId: string; kind: string; text?: string };

export type PageApp = {
  tree: () => Child;
  session: () => Session;
  start: () => Promise<void>;
  consent: (checked: boolean) => void;
  intro: (name: string, birthDate: string | null) => Promise<void>;
};

export type FocusTrack = {
  selector: () => string | null;
  expected: (question: Question) => string;
};

const fire = (node: VNode, name: string, extra: Record<string, unknown>): void => {
  const handler = node.attrs[name];
  if (typeof handler !== "function") {
    throw new Error(`нет обработчика ${name} на ${node.tag}.${String(node.attrs["class"] ?? "")}`);
  }
  const target = (extra.target as Record<string, unknown> | undefined) ?? extra;
  handler({
    preventDefault() {},
    stopPropagation() {},
    target,
    currentTarget: extra.currentTarget ?? target,
    ...extra,
  });
};

const currentQuestion = (app: PageApp): Question | null => {
  const session = app.session();
  const portion = session.page?.nextPortion;
  if (!portion) return null;
  return portion.questions[session.questionIndex] ?? null;
};

const radiosOf = (tree: Child, kit: Kit, name: string): VNode[] =>
  kit.focusable(tree).filter((node) => node.attrs["type"] === "radio" && String(node.attrs["name"] ?? "") === name);

const submitOf = (tree: Child, kit: Kit): VNode | undefined =>
  kit.byClass(tree, "field__submit")[0];

export async function waitUntil(probe: () => boolean, message: string, ms = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(message);
}

const tabTo = (
  app: PageApp,
  kit: Kit,
  keys: KeyName[],
  match: (node: VNode) => boolean,
  where: string,
  from = 0,
): VNode => {
  const stops = tabStops(app.tree(), kit);
  for (let index = from; index < stops.length; index += 1) {
    keys.push("Tab");
    const node = stops[index];
    if (node && match(node)) return node;
  }
  throw new Error(`Tab не дошёл: ${where}`);
};

const assertFocusOnQuestion = (question: Question, focus: FocusTrack): void => {
  const expected = focus.expected(question);
  const actual = focus.selector();
  if (actual !== expected) {
    throw new Error(`фокус «${actual}», ждали ${expected} (${question.id})`);
  }
};

export async function walkLadder(
  app: PageApp,
  kit: Kit,
  openText: string,
  focus: FocusTrack,
): Promise<{ keys: KeyName[]; questions: number }> {
  const keys: KeyName[] = [];
  let questions = 0;

  while (questions < 12) {
    const question = currentQuestion(app);
    if (question === null) break;
    const beforeId = question.id;
    const beforeState = app.session().page?.state;
    assertFocusOnQuestion(question, focus);

    if (question.kind === "открытый") {
      const field = kit.findAll(app.tree(), "textarea").find((node) => node.attrs["id"] === question.id);
      if (!field) throw new Error(`нет поля ${question.id}`);
      fire(field, "onInput", { target: { value: openText } });
      keys.push("ввод");
      await waitUntil(() => app.session().draft.length > 0, "черновик открытого ответа не записался");
      const submit = submitOf(app.tree(), kit);
      if (!submit || submit.attrs["disabled"] === true) {
        throw new Error("кнопка отправки открытого ответа недоступна");
      }
      const fieldIndex = tabStops(app.tree(), kit).indexOf(field);
      tabTo(
        app,
        kit,
        keys,
        (node) => node === submit || classesOf(node).includes("field__submit"),
        "отправка открытого",
        fieldIndex < 0 ? 0 : fieldIndex,
      );
      fire(submit, "onClick", {});
      keys.push("Enter");
    } else if (question.kind === "шкала") {
      const group = radiosOf(app.tree(), kit, question.id);
      const next = group[1] ?? group[0];
      if (!next) throw new Error(`шкала ${question.id} без отметок`);
      keys.push("ArrowRight");
      fire(next, "onChange", { target: { value: String(next.attrs["value"] ?? "") } });
    } else {
      const radio = radiosOf(app.tree(), kit, question.id)[0];
      if (!radio) throw new Error(`выбор ${question.id} без вариантов`);
      keys.push(" ");
      fire(radio, "onChange", { target: { value: String(radio.attrs["value"] ?? "") } });
    }

    await waitUntil(() => {
      const now = currentQuestion(app);
      const state = app.session().page?.state;
      if (state !== beforeState) return true;
      return now?.id !== beforeId;
    }, `клавиатура не сдвинула вопрос ${question.id}`);
    questions += 1;
  }

  return { keys, questions };
}

const classesOf = (node: VNode): string[] => String(node.attrs["class"] ?? "").split(/\s+/).filter(Boolean);

export type { AnswerInput };
