/**
 * Общая обвязка тестов сервера: база в памяти, поднятый сервер, ответы порций
 * по составу вопросов из контента.
 *
 * Файл не заканчивается на `.test.ts` и в прогон тестов сам по себе не попадает.
 */

import type { AddressInfo } from "node:net";
import { loadConfig } from "./config.js";
import type { Db } from "./db/driver.js";
import { up } from "./db/migrate.js";
import { openDatabase } from "./db/sqlite.js";
import { rawContent } from "./engine.js";
import { createHttpServer } from "./http/server.js";
import type { AnswerInput, PageStateDto, PortionKey } from "./contract/index.js";

export interface TestServer {
  origin: string;
  db: Db;
  close(): Promise<void>;
}

/** Сервер на случайном порту с чистой базой в памяти. */
export async function startTestServer(): Promise<TestServer> {
  const db = openDatabase({ path: ":memory:" });
  up(db);

  const server = createHttpServer({ db, config: loadConfig({}), version: "test" });
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

/** Поля внутреннего профиля, которых не должно быть в ответе API ни на одном уровне. */
export const FORBIDDEN_FIELDS = [
  "band",
  "code",
  "confidence",
  "coordinate",
  "coordinates",
  "dominantNode",
  "flags",
  "internalProfile",
  "llmTask",
  "nextPaidOffer",
  "nodes",
  "profile",
  "sources",
  "value",
];

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
