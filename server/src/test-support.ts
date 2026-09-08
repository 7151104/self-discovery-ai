/**
 * Общая обвязка тестов сервера: база в памяти, поднятый сервер, ответы порций
 * по составу вопросов из контента.
 *
 * Файл не заканчивается на `.test.ts` и в прогон тестов сам по себе не попадает.
 */

import type { AddressInfo } from "node:net";
import { loadConfig, type ServerConfig } from "./config.js";
import type { Db } from "./db/driver.js";
import { readMigrations, up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import { consentVersion as documentConsentVersion, rawContent, type SliceAnswers } from "./engine.js";
import {
  abortInflightGenerations,
  createLlmRuntime,
  drainGenerations,
  waitForGenerationWorker,
  type LlmRuntime,
} from "./generation.js";
import { createHttpServer } from "./http/server.js";
import type { GenerationProvider } from "../llm/dist/index.js";
import { findActiveJob, saveBlockContent, saveJobResult } from "./store.js";
import { fakeWebhook, FAKE_SIGNATURE_HEADER } from "./payments/fake.js";
import type { WebhookKind } from "./payments/provider.js";
import { createErrorTracker } from "./observability/registry.js";
import type { ErrorTracker } from "./observability/provider.js";
import type { AnswerInput, OrderDto, PageStateDto, PortionDto, PortionKey } from "./contract/index.js";

export { FORBIDDEN_FIELDS } from "./contract/index.js";

export interface TestServer {
  origin: string;
  db: Db;
  config: ServerConfig;
  llm: LlmRuntime;
  errors: ErrorTracker;
  close(): Promise<void>;
}

export interface TestServerOptions {
  /** По умолчанию очередь не крутится: существующие тесты ступени 4 ждут pending. */
  autostart?: boolean;
  provider?: GenerationProvider;
  databasePath?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Подмена базы: тесты трекера роняют запрос изнутри обработчика. */
  wrapDb?: (db: Db) => Db;
}

/** Номер последней миграции: тесты не переписываются при добавлении новой. */
export const latestMigration = (): string => {
  const versions = readMigrations().map((migration) => migration.version);
  return versions[versions.length - 1] ?? "";
};

/**
 * Ключ шифрования для тестов. Не секрет: он лежит в репозитории именно потому,
 * что защищать в тестовой базе нечего. Рабочий ключ приходит из окружения и в
 * репозитории отсутствует.
 */
export const TEST_KEY = "dGVzdC1rZXktZm9yLXVuaXQtdGVzdHMtMzItYnl0ZXM=";

/** Секрет подписи уведомлений в тестах. Рабочий приходит из окружения. */
export const TEST_WEBHOOK_SECRET = "test-webhook-secret";

/**
 * Сервер на случайном порту с чистой базой в памяти.
 * По умолчанию поднимается с шифрованием: тесты идут тем же путём, что рабочее
 * окружение, а не более коротким.
 *
 * Автозапуск очереди выключен: иначе каждый профиль ступени 4 запускал бы
 * провайдера, и старые тесты перестали бы видеть `pending`.
 */
export async function startTestServer(
  env: NodeJS.ProcessEnv = {},
  options: TestServerOptions = {},
): Promise<TestServer> {
  const config: ServerConfig = loadConfig({
    SDAI_ENCRYPTION_KEY: TEST_KEY,
    SDAI_PAYMENT_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    SDAI_BUILD_VERSION: "test",
    SDAI_BUILD_COMMIT: "test-commit",
    ...env,
  });
  const db = openDatabase({ path: options.databasePath ?? ":memory:", keys: config.keys });
  up(db);
  const runtimeDb = options.wrapDb ? options.wrapDb(db) : db;
  const errors = createErrorTracker(config.errors);

  const llm = createLlmRuntime({
    env,
    autostart: options.autostart ?? false,
    sleep: options.sleep ?? (async () => {}),
    ...(options.provider ? { provider: options.provider } : {}),
  });

  const server = createHttpServer({ db: runtimeDb, config, llm, errors });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    db,
    config,
    llm,
    errors,
    close: () =>
      new Promise<void>((resolve) => {
        abortInflightGenerations(llm);
        const worker = waitForGenerationWorker(llm);
        server.close(() => {
          void worker.finally(() => {
            db.close();
            resolve();
          });
        });
      }),
  };
}

/** Доиграть очередь тестового сервера без включения автозапуска навсегда. */
export const drainServer = (server: TestServer): Promise<void> =>
  drainGenerations({ db: server.db, llm: server.llm });

export interface Reply<T> {
  status: number;
  body: T;
}

export async function call<T>(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply<T>> {
  const response = await fetch(`${origin}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

const OPEN_ANSWER =
  "Обычно я берусь за дело быстро и с интересом, довожу почти до конца, а потом нахожу " +
  "причину отложить и возвращаюсь к нему через несколько недель уже без всякого желания";

/** Ответы одной ступени: состав вопросов берётся из контента, не из кода теста. */
export function answersForStep(step: 1 | 2 | 3 | 4): AnswerInput[] {
  return rawContent.questions
    .filter((question) => question.step === step)
    .map((question): AnswerInput => {
      if (question.type === "выбор") {
        return { questionId: question.id, kind: "выбор", option: question.options[0]?.key ?? "A" };
      }
      if (question.type === "шкала") return { questionId: question.id, kind: "шкала", scale: 4 };
      return { questionId: question.id, kind: "открытый", text: OPEN_ANSWER };
    });
}

/**
 * Лестница демо-человека из `examples/demo-person-answers.md`.
 * На первых вариантах вопросов карта после добора часто не меняется:
 * полосы уже точные. У демо уточнение среза видно на карте.
 */
const DEMO_LADDER: Record<string, string | number> = {
  L1: "B",
  L2: "C",
  L3: "A",
  L4: "B",
  L5: "D",
  L6: 5,
  L7: 2,
  L8: "A",
  L9: 5,
  L10: 4,
  L11: 4,
};

export function answersForDemoStep(step: 1 | 2 | 3 | 4): AnswerInput[] {
  return rawContent.questions
    .filter((question) => question.step === step)
    .map((question): AnswerInput => {
      if (question.type === "открытый") return { questionId: question.id, kind: "открытый", text: OPEN_ANSWER };
      const value = DEMO_LADDER[question.id];
      if (question.type === "шкала") {
        const scale = Number(value ?? 4);
        return { questionId: question.id, kind: "шкала", scale: scale as 1 | 2 | 3 | 4 | 5 };
      }
      return { questionId: question.id, kind: "выбор", option: String(value ?? question.options[0]?.key ?? "A") };
    });
}

export const portionKey = (step: 1 | 2 | 3 | 4): PortionKey => `step:${step}`;

/** Отпечаток текущего полного текста согласия — тот же, что запишет сервер. */
export const currentConsentVersion = (): string => documentConsentVersion();

/** Тело создания профиля с отметкой согласия: без неё ответы не сохраняются. */
export const profileBody = (
  name = "Аня",
  birthDate: string | null = "1990-05-05",
): { name: string; birthDate: string | null; consentVersion: string } => ({
  name,
  birthDate,
  consentVersion: documentConsentVersion(),
});

/** Профиль, доведённый до указанной ступени. */
export async function profileAtStep(origin: string, step: 0 | 1 | 2 | 3 | 4): Promise<PageStateDto> {
  return climbToStep(origin, step, answersForStep);
}

/** Профиль демо-человека на указанной ступени. */
export async function profileAtDemo(origin: string, step: 0 | 1 | 2 | 3 | 4 = 4): Promise<PageStateDto> {
  return climbToStep(origin, step, answersForDemoStep);
}

async function climbToStep(
  origin: string,
  step: 0 | 1 | 2 | 3 | 4,
  answersOf: (step: 1 | 2 | 3 | 4) => AnswerInput[],
): Promise<PageStateDto> {
  const created = await call<PageStateDto>(origin, "POST", "/api/profiles", profileBody());
  let page = created.body;

  for (let current = 1; current <= step; current += 1) {
    const level = current as 1 | 2 | 3 | 4;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: portionKey(level),
      answers: answersOf(level),
      requestId: `test-${level}`,
    });
    page = reply.body;
  }

  return page;
}

/** Доставка уведомления провайдера с подписью. Тот же путь, что у настоящего. */
export async function deliverWebhook(
  origin: string,
  input: { kind: WebhookKind; orderId: string; reference: string; amount: number; eventId?: string },
  secret: string = TEST_WEBHOOK_SECRET,
): Promise<Reply<{ result: string }>> {
  const { raw, signature } = fakeWebhook(secret, input);
  const response = await fetch(`${origin}/api/payments/fake/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signature },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as { result: string } };
}

export interface PaidProfile {
  page: PageStateDto;
  slice: string;
  orderId: string;
  reference: string;
  price: number;
}

/**
 * Профиль с оплаченным срезом. Оплата идёт настоящим маршрутом: заказ,
 * уведомление провайдера, подпись — без денег, но и без обходных путей.
 */
export async function purchaseSlice(
  origin: string,
  sliceId?: string,
  from?: PageStateDto,
): Promise<PaidProfile> {
  const page = from ?? (await profileAtStep(origin, 4));
  const slice = sliceId ?? page.offer?.slice ?? "slice_node_finish";

  const order = await call<{ order: OrderDto }>(origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: `buy-${slice}`,
  });
  const orderId = order.body.order.orderId;
  const reference = referenceOf(order.body.order);

  await deliverWebhook(origin, {
    kind: "payment.succeeded",
    orderId,
    reference,
    amount: order.body.order.price,
  });

  const state = await call<PageStateDto>(origin, "GET", `/api/p/${page.profileId}`);
  return { page: state.body, slice, orderId, reference, price: order.body.order.price };
}

/** Идентификатор платежа у провайдера: он зашит в выданный адрес оплаты. */
const referenceOf = (order: OrderDto): string =>
  order.payment?.url.split("/pay/fake/")[1]?.split("?")[0] ?? "";

const localSliceQuestionId = (slice: string, questionId: string): string =>
  questionId.startsWith(`${slice}:`) ? questionId.slice(slice.length + 1) : questionId;

/** Ответы одной порции добора: состав вопросов берётся из состояния страницы. */
export const answersForPortion = (portion: PortionDto): AnswerInput[] =>
  portion.questions.map((question): AnswerInput => {
    if (question.kind === "выбор") {
      return { questionId: question.id, kind: "выбор", option: question.options[0]?.key ?? "A" };
    }
    if (question.kind === "шкала") return { questionId: question.id, kind: "шкала", scale: 4 };
    if (question.kind === "число") return { questionId: question.id, kind: "число", numbers: [5, 2] };
    return { questionId: question.id, kind: "открытый", text: OPEN_ANSWER };
  });

/** Ответы порции из эталона среза: порог проходится, следующее предложение берётся из таблицы. */
export const answersForSliceFixture = (slice: string, portion: PortionDto, fixtures: SliceAnswers): AnswerInput[] =>
  portion.questions.map((question): AnswerInput => {
    const value = fixtures[localSliceQuestionId(slice, question.id)];
    if (question.kind === "выбор") {
      return { questionId: question.id, kind: "выбор", option: String(value ?? question.options[0]?.key ?? "A") };
    }
    if (question.kind === "шкала") {
      const scale = Number(value ?? 4);
      return { questionId: question.id, kind: "шкала", scale: scale as 1 | 2 | 3 | 4 | 5 };
    }
    if (question.kind === "число") {
      const numbers = Array.isArray(value) ? value.map(Number) : typeof value === "number" ? [value] : [5, 2];
      return { questionId: question.id, kind: "число", numbers };
    }
    return { questionId: question.id, kind: "открытый", text: String(value ?? OPEN_ANSWER) };
  });

const sliceOfPortion = (key: string): string | null => {
  const match = /^slice:([^:]+):\d+$/.exec(key);
  return match?.[1] ?? null;
};

/** Проходит все порции добора до конца. Возвращает состояние страницы после последней. */
export async function answerSlicePortions(origin: string, profileId: string): Promise<PageStateDto> {
  let page = (await call<PageStateDto>(origin, "GET", `/api/p/${profileId}`)).body;

  for (let guard = 0; guard < 5; guard += 1) {
    const portion = page.nextPortion;
    if (!portion || !portion.key.startsWith("slice:")) break;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${profileId}/portions`, {
      portion: portion.key,
      answers: answersForPortion(portion),
      requestId: `portion-${portion.key}`,
    });
    page = reply.body;
  }

  return page;
}

/**
 * Добор эталонными ответами среза: порог проходится, следующее предложение
 * считается таблицей «Следующие двери», а не первыми вариантами вопроса.
 */
export async function answerSliceFixtures(origin: string, profileId: string, slice: string): Promise<PageStateDto> {
  const { sliceAnswers } = (await import("../../engine/dist/slice-fixtures.js")) as {
    sliceAnswers: (id: string) => SliceAnswers;
  };
  const fixtures = sliceAnswers(slice);
  let page = (await call<PageStateDto>(origin, "GET", `/api/p/${profileId}`)).body;

  for (let guard = 0; guard < 5; guard += 1) {
    const portion = page.nextPortion;
    if (!portion || !portion.key.startsWith("slice:")) break;
    const id = sliceOfPortion(portion.key) ?? slice;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${profileId}/portions`, {
      portion: portion.key,
      answers: answersForSliceFixture(id, portion, fixtures),
      requestId: `portion-fixture-${portion.key}`,
    });
    page = reply.body;
  }

  return page;
}

/**
 * Профиль в платном состоянии.
 *
 * Оплата проходит целиком. После добора очередь ставит задание среза (E4-08).
 * Состояние `delivered` подставляет готовый текст в хранилище и закрывает живое
 * задание тем же содержимым: очередь в тестах контракта не крутится, а страница
 * должна показать `ready`, а не `pending` поверх уже записанного блока.
 */
const STEP4_READY = {
  heading: "Что у тебя сейчас происходит",
  paragraphs: ["Ты описал остановку перед сдачей.", "Это тот же механизм, что виден в ответах про темп."],
  highlight: "Незакрытое держит внимание сильнее закрытого.",
};

const SLICE_READY = {
  heading: "Почему ты останавливаешься у финиша",
  paragraphs: ["Механизм включается на восьмидесяти процентах пути.", "Дальше идёт цена этого механизма."],
  highlight: "Обрыв у финиша — не лень, а способ не проверять результат.",
};

function deliverSlot(
  db: Db,
  profileId: string,
  slot: "step4" | `slice:${string}`,
  purchased: boolean,
  text: { heading: string; paragraphs: string[]; highlight: string },
): void {
  saveBlockContent(db, profileId, { slot, profileVersion: 1, purchased, ...text });
  const job = findActiveJob(db, profileId, slot);
  if (job) saveJobResult(db, job, text);
}

/** Подставляет готовые тексты ступени 4 и среза: очередь в таких тестах не крутится. */
export function deliverPaidReady(db: Db, profileId: string, slice: string): void {
  deliverSlot(db, profileId, `slice:${slice}`, true, SLICE_READY);
  deliverSlot(db, profileId, "step4", false, STEP4_READY);
}

export async function profileAtPaidState(
  origin: string,
  db: Db,
  options: { delivered: boolean },
): Promise<PageStateDto> {
  const paid = await purchaseSlice(origin);
  const profileId = paid.page.profileId;
  await answerSliceFixtures(origin, profileId, paid.slice);

  if (options.delivered) deliverPaidReady(db, profileId, paid.slice);

  const state = await call<PageStateDto>(origin, "GET", `/api/p/${profileId}`);
  return state.body;
}

/** Все ключи в дереве ответа. */
export function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      collectKeys(nested, found);
    }
  }
  return found;
}
