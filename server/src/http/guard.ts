/**
 * Последняя проверка перед отправкой ответа (E3-06).
 *
 * Главную работу делает компилятор: типы ответов обёрнуты в `Wire<>` и
 * `Viewable<>`, и координата в ответе ломает сборку. Эта проверка — вторая
 * линия на случай, когда форма собрана обходом типов: приведением, `unknown`
 * или объектом, пришедшим из базы. Она стоит на самом выходе, поэтому мимо
 * неё ответ не проходит.
 *
 * Список запрещённых полей общий с типами: он объявлен один раз в контракте.
 */

import { FORBIDDEN_FIELDS, PRIVATE_BLOCK_SLOTS } from "../contract/index.js";

const forbidden = new Set<string>(FORBIDDEN_FIELDS);

export class ResponseLeak extends Error {
  constructor(readonly field: string) {
    super(`response-leak:${field}`);
    this.name = "ResponseLeak";
  }
}

/** Обходит ответ и падает, если встретил поле внутреннего профиля. */
export function assertNoCoordinates(payload: unknown): void {
  walk(payload, (key) => {
    if (forbidden.has(key)) throw new ResponseLeak(key);
  });
}

/**
 * То же для публичного вида: блоков 3, 4 и купленных срезов в нём не должно
 * быть ни в одном поле, включая идентификаторы блоков.
 */
export function assertNoPrivateBlocks(payload: unknown): void {
  walk(payload, (_key, value) => {
    if (typeof value !== "string") return;
    if ((PRIVATE_BLOCK_SLOTS as readonly string[]).includes(value) || value.startsWith("slice:")) {
      throw new ResponseLeak(value);
    }
  });
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    visit(key, nested);
    walk(nested, visit);
  }
}
