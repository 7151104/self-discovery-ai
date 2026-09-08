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
import { collectKeys, FORBIDDEN_FIELDS, profileAtStep, startTestServer } from "./test-support.js";
import type { PageStateDto } from "./contract/index.js";

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

test("реестр покрывает шесть эндпоинтов страницы плюс создание профиля и здоровье", () => {
  const names = Object.keys(API) as OperationName[];
  assert.deepEqual(names.sort(), [
    "createProfile",
    "disagree",
    "editAnswer",
    "generationStatus",
    "health",
    "pageState",
    "purchase",
    "submitPortion",
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

test("состояния s0–s4: в ответе нет ни одного поля координаты", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  for (const step of [0, 1, 2, 3, 4] as const) {
    const page = await profileAtStep(server.origin, step);
    const keys = collectKeys(page);
    for (const forbidden of FORBIDDEN_FIELDS) {
      assert.ok(!keys.has(forbidden), `ступень ${step}: в ответе поле ${forbidden}`);
    }
  }
});

test("состояния s0–s4: в ответе нет имён координат и машинных кодов", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { rawContent } = await import("./engine.js");
  const names = rawContent.coordinates.map((coordinate) => coordinate.name.toLowerCase());

  for (const step of [0, 1, 2, 3, 4] as const) {
    const page: PageStateDto = await profileAtStep(server.origin, step);
    const serialized = JSON.stringify(page).toLowerCase();
    for (const name of names) {
      assert.ok(!serialized.includes(`"${name}"`), `ступень ${step}: имя координаты «${name}»`);
    }
    assert.ok(!/"(at_80|self_report_mismatch|node_[a-z_]+)"/.test(serialized), `ступень ${step}: машинный код`);
  }
});
