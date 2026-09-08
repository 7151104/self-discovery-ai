/**
 * Контракт API (E3-02).
 *
 * Главное здесь проверяет не тест, а компилятор: строки с `@ts-expect-error`
 * требуют, чтобы протёкший тип ломал сборку. Если стену типов ослабить, ошибки
 * не будет — и тогда не соберётся уже сам этот файл.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { API, buildPath, type CoordinateLeak, type OperationName, type Wire } from "./contract/index.js";
import {
  collectKeys,
  FORBIDDEN_FIELDS,
  profileAtPaidState,
  profileAtStep,
  startTestServer,
  type TestServer,
} from "./test-support.js";
import { assertNoCoordinates, ResponseLeak } from "./http/guard.js";
import type { PageStateDto, PageStateName } from "./contract/index.js";

// ── Стена типов ───────────────────────────────────────────────────────────────

interface CleanShape {
  blocks: { heading: string; paragraphs: string[] }[];
  offer: { price: number } | null;
}

/** Чистый тип проходит насквозь: `Wire<T>` совпадает с `T`. */
const clean: Wire<CleanShape> = { blocks: [{ heading: "", paragraphs: [] }], offer: null };

interface WithConfidence {
  map: { label: string; confidence: string }[];
}

// @ts-expect-error — `confidence` внутри массива делает тип неприсваиваемым
const leakConfidence: Wire<WithConfidence> = { map: [{ label: "Темп", confidence: "high" }] };

interface WithCoordinateValue {
  block: { heading: string; value: string | null };
}

// @ts-expect-error — значение координаты на второй глубине ломает сборку
const leakValue: Wire<WithCoordinateValue> = { block: { heading: "", value: null } };

interface WithProfile {
  page: { blocks: string[]; internalProfile: { flags: string[] } };
}

// @ts-expect-error — внутренний профиль целиком отдать нельзя
const leakProfile: Wire<WithProfile> = { page: { blocks: [], internalProfile: { flags: [] } } };

/** Протёкший тип называет утёкшее поле: сообщение компилятора читаемо. */
const named: CoordinateLeak<"confidence"> = {} as Wire<WithConfidence>;

test("стена типов: чистые формы проходят, протёкшие не собираются", () => {
  assert.equal(clean.offer, null);
  assert.ok([leakConfidence, leakValue, leakProfile, named].length === 4);
});

// ── Реестр эндпоинтов ─────────────────────────────────────────────────────────

test("реестр покрывает страницу, оплату, публичный вид, выгрузку и здоровье", () => {
  const names = Object.keys(API) as OperationName[];
  assert.deepEqual(names.sort(), [
    "blockText",
    "createProfile",
    "deleteProfile",
    "disagree",
    "editAnswer",
    "exportProfile",
    "generationStatus",
    "health",
    "pageState",
    "publicPage",
    "purchase",
    "refund",
    "reportError",
    "revokeShare",
    "share",
    "submitPortion",
    "webhook",
  ]);
});

test("пути уникальны в паре с методом и начинаются с /api", () => {
  const seen = new Set<string>();
  for (const name of Object.keys(API) as OperationName[]) {
    const route = API[name];
    assert.ok(route.path.startsWith("/api/"), `${name}: ${route.path}`);
    const key = `${route.method} ${route.path}`;
    assert.ok(!seen.has(key), `повтор маршрута ${key}`);
    seen.add(key);
  }
});

test("адрес строится из того же реестра, что и маршруты сервера", () => {
  assert.equal(buildPath("pageState", { profileId: "abc" }), "/api/p/abc");
  assert.equal(
    buildPath("generationStatus", { profileId: "abc", generationId: "gen" }),
    "/api/p/abc/generations/gen",
  );
});

// ── Ответы API ────────────────────────────────────────────────────────────────

/**
 * Все семь состояний страницы из `docs/11-ui-page-spec.md`. Собираются один
 * раз и проверяются целиком: приёмка E3-06 говорит про весь набор `s0`–`paid_done`.
 */
async function everyState(origin: string, db: TestServer["db"]): Promise<Record<PageStateName, PageStateDto>> {
  const collected: Partial<Record<PageStateName, PageStateDto>> = {};
  for (const step of [0, 1, 2, 3, 4] as const) {
    const page = await profileAtStep(origin, step);
    collected[page.state] = page;
  }
  for (const delivered of [false, true]) {
    const page = await profileAtPaidState(origin, db, { delivered });
    collected[page.state] = page;
  }

  const states: PageStateName[] = ["s0", "s1", "s2", "s3", "s4", "paid_pending", "paid_done"];
  for (const state of states) assert.ok(collected[state], `состояние ${state} не собралось`);
  return collected as Record<PageStateName, PageStateDto>;
}

test("состояния s0–paid_done: в ответе нет ни одного поля координаты", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const pages = await everyState(server.origin, server.db);
  for (const [state, page] of Object.entries(pages)) {
    const keys = collectKeys(page);
    for (const forbidden of FORBIDDEN_FIELDS) {
      assert.ok(!keys.has(forbidden), `${state}: в ответе поле ${forbidden}`);
    }
  }
});

test("состояния s0–paid_done: в ответе нет имён координат и машинных кодов", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { rawContent } = await import("./engine.js");
  const names = rawContent.coordinates.map((coordinate) => coordinate.name.toLowerCase());

  const pages = await everyState(server.origin, server.db);
  for (const [state, page] of Object.entries(pages)) {
    const serialized = JSON.stringify(page).toLowerCase();
    for (const name of names) {
      assert.ok(!serialized.includes(`"${name}"`), `${state}: имя координаты «${name}»`);
    }
    assert.ok(!/"(at_80|self_report_mismatch|node_[a-z_]+)"/.test(serialized), `${state}: машинный код`);
  }
});

test("платные состояния собираются сервером, а не выдумываются клиентом", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const pages = await everyState(server.origin, server.db);

  // Оплачено, текста ещё нет: срез объявлен заголовком, абзацев нет,
  // у клиента есть идентификатор генерации, за которым он следит.
  const pendingSlice = pages["paid_pending"].blocks.find((block) => block.id.startsWith("slice:"));
  assert.ok(pendingSlice);
  assert.equal(pendingSlice.generation?.status, "pending");
  assert.deepEqual(pendingSlice.paragraphs, []);
  assert.ok(pendingSlice.heading.length > 0);
  assert.equal(pendingSlice.purchased, true);

  // Текст готов: он приходит из хранилища и виден целиком.
  const doneSlice = pages["paid_done"].blocks.find((block) => block.id.startsWith("slice:"));
  assert.ok(doneSlice);
  assert.equal(doneSlice.generation?.status, "ready");
  assert.ok(doneSlice.paragraphs.length > 0);
  assert.equal(doneSlice.purchased, true);
});

test("проверка на выходе ловит то, что обошло типы", () => {
  const smuggled = { blocks: [{ heading: "узел", meta: { confidence: "high" } }] };
  assert.throws(() => assertNoCoordinates(smuggled), ResponseLeak);
  assert.doesNotThrow(() => assertNoCoordinates({ blocks: [{ heading: "узел" }] }));
});
