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
import { rawContent } from "./engine.js";
import { createHttpServer } from "./http/server.js";
import { saveBlockContent, updateOrderStatus } from "./store.js";
import type { AnswerInput, PageStateDto, PortionKey } from "./contract/index.js";

export { FORBIDDEN_FIELDS } from "./contract/index.js";

export interface TestServer {
  origin: string;
  db: Db;
  close(): Promise<void>;
}

/** Номер последней миграции: тесты не переписываются при добавлении новой. */
export const latestMigration = (): string => {
  const versions = readMigrations().map((migration) => migration.version);
  return versions[versions.length - 1] ?? "";
};

/** Сервер на случайном порту с чистой базой в памяти. */
export async function startTestServer(env: NodeJS.ProcessEnv = {}): Promise<TestServer> {
  const db = openDatabase({ path: ":memory:" });
  up(db);

  const config: ServerConfig = loadConfig(env);
  const server = createHttpServer({ db, config, version: "test" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    db,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

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

export const portionKey = (step: 1 | 2 | 3 | 4): PortionKey => `step:${step}`;

/** Профиль, доведённый до указанной ступени. */
export async function profileAtStep(origin: string, step: 0 | 1 | 2 | 3 | 4): Promise<PageStateDto> {
  const created = await call<PageStateDto>(origin, "POST", "/api/profiles", {
    name: "Аня",
    birthDate: "1990-05-05",
  });
  let page = created.body;

  for (let current = 1; current <= step; current += 1) {
    const level = current as 1 | 2 | 3 | 4;
    const reply = await call<PageStateDto>(origin, "POST", `/api/p/${page.profileId}/portions`, {
      portion: portionKey(level),
      answers: answersForStep(level),
      requestId: `test-${level}`,
    });
    page = reply.body;
  }

  return page;
}

/**
 * Профиль в платном состоянии.
 *
 * Оплата — задача E8, тексты платных срезов — E4, поэтому заказ переводится в
 * оплаченный и блок среза записывается напрямую в хранилище. Проекции состояния
 * этого достаточно: она собирает страницу из того, что лежит в базе.
 */
export async function profileAtPaidState(
  origin: string,
  db: Db,
  options: { delivered: boolean },
): Promise<PageStateDto> {
  const page = await profileAtStep(origin, 4);
  const slice = page.offer?.slice ?? "slice_node_finish";

  const order = await call<{ order: { orderId: string } }>(origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: "paid",
  });
  updateOrderStatus(db, page.profileId, order.body.order.orderId, "paid");

  if (options.delivered) {
    saveBlockContent(db, page.profileId, {
      slot: `slice:${slice}`,
      profileVersion: 1,
      purchased: true,
      heading: "Почему ты останавливаешься у финиша",
      paragraphs: ["Механизм включается на восьмидесяти процентах пути.", "Дальше идёт цена этого механизма."],
      highlight: "Обрыв у финиша — не лень, а способ не проверять результат.",
    });
  }

  const state = await call<PageStateDto>(origin, "GET", `/api/p/${page.profileId}`);
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
