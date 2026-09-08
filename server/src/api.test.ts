/**
 * Каркас сервера и поведение эндпоинтов (E3-01, E3-02).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, loadConfig } from "./config.js";
import { BAR_DEFINITIONS, rawContent } from "./engine.js";
import { barKey } from "./page.js";
import { matchApi, matchPage } from "./http/router.js";
import { answersForStep, call, portionKey, profileAtStep, startTestServer } from "./test-support.js";
import { countProfileVersions, listEvents } from "./store.js";
import type {
  DisagreementResponse,
  ErrorDto,
  GenerationResponse,
  HealthDto,
  OrderResponse,
  PageStateDto,
} from "./contract/index.js";

test("настройки читаются из окружения, значений по умолчанию хватает для разработки", () => {
  assert.deepEqual(loadConfig({}), {
    host: DEFAULTS.host,
    port: DEFAULTS.port,
    databasePath: DEFAULTS.databasePath,
    autoMigrate: true,
    publicOrigin: "",
    maxBodyBytes: DEFAULTS.maxBodyBytes,
  });

  const custom = loadConfig({ SDAI_PORT: "9000", SDAI_PUBLIC_ORIGIN: "https://example.com/", SDAI_DB_AUTO_MIGRATE: "0" });
  assert.equal(custom.port, 9000);
  assert.equal(custom.publicOrigin, "https://example.com");
  assert.equal(custom.autoMigrate, false);

  assert.throws(() => loadConfig({ SDAI_PORT: "восемь" }), /config:SDAI_PORT/);
  assert.throws(() => loadConfig({ SDAI_DB_AUTO_MIGRATE: "maybe" }), /config:SDAI_DB_AUTO_MIGRATE/);
});

test("маршрутизатор строится из реестра контракта", () => {
  assert.deepEqual(matchApi("GET", "/api/health"), { name: "health", params: {} });
  assert.deepEqual(matchApi("GET", "/api/p/abc"), { name: "pageState", params: { profileId: "abc" } });
  assert.deepEqual(matchApi("PATCH", "/api/p/abc/answers/L1"), {
    name: "editAnswer",
    params: { profileId: "abc", questionId: "L1" },
  });
  assert.equal(matchApi("DELETE", "/api/health"), "method_not_allowed");
  assert.equal(matchApi("GET", "/api/unknown"), null);
  assert.deepEqual(matchPage("/p/abc"), { profileId: "abc" });
  assert.equal(matchPage("/p/abc/extra"), null);
});

test("у каждой полосы карты есть устойчивый ключ, номер координаты наружу не идёт", () => {
  const keys = BAR_DEFINITIONS.map((definition) => barKey(definition.coordinate));
  assert.equal(new Set(keys).size, BAR_DEFINITIONS.length);
  for (const key of keys) assert.ok(/^[a-z]+$/.test(key), `ключ полосы «${key}» похож на номер координаты`);
});

test("эндпоинт здоровья отвечает и показывает версию схемы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const reply = await call<HealthDto>(server.origin, "GET", "/api/health");
  assert.equal(reply.status, 200);
  assert.equal(reply.body.status, "ok");
  assert.equal(reply.body.database, "ok");
  assert.equal(reply.body.schemaVersion, "0001");
  assert.ok(reply.body.uptimeMs >= 0);
});

test("страница растёт по порциям: блок, полосы и следующая порция", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const s0 = await profileAtStep(server.origin, 0);
  assert.equal(s0.blocks.length, 0);
  assert.equal(s0.nextPortion?.key, "step:1");
  assert.ok(s0.map.every((bar) => bar.fill === "empty"));

  const s1 = await call<PageStateDto>(server.origin, "POST", `/api/p/${s0.profileId}/portions`, {
    portion: portionKey(1),
    answers: answersForStep(1),
    requestId: "r1",
  });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.state, "s1");
  assert.equal(s1.body.blocks.length, 1);
  assert.equal(s1.body.blocks[0]?.id, "step1");
  assert.ok(s1.body.map.some((bar) => bar.fill !== "empty"));
  assert.equal(s1.body.nextPortion?.key, "step:2");
});

test("ступень 4 отдаёт блок с идентификатором генерации, а не текст", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  assert.equal(page.state, "s4");

  const step4 = page.blocks.find((block) => block.id === "step4");
  assert.ok(step4, "нет блока ступени 4");
  assert.equal(step4.generation?.status, "pending");
  assert.deepEqual(step4.paragraphs, []);

  const generation = await call<GenerationResponse>(
    server.origin,
    "GET",
    `/api/p/${page.profileId}/generations/${step4.generation?.id}`,
  );
  assert.equal(generation.status, 200);
  assert.equal(generation.body.generation.blockId, "step4");
  assert.equal(generation.body.generation.status, "pending");

  const missing = await call<ErrorDto>(
    server.origin,
    "GET",
    `/api/p/${page.profileId}/generations/${"0".repeat(22)}`,
  );
  assert.equal(missing.status, 404);
});

test("предложение появляется после ступени 4 и цена есть только у него", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  assert.ok(page.offer, "нет предложения");
  assert.ok(page.offer.price > 0);

  const priced = page.doors.filter((door) => door.price !== null);
  assert.equal(priced.length, 1);
  assert.equal(priced[0]?.slice, page.offer.slice);
});

test("правка ответа пересчитывает профиль и не переписывает готовые блоки молча", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const before = countProfileVersions(server.db, page.profileId);

  const question = rawContent.questions.find((candidate) => candidate.id === "L1");
  const other = question?.options.find((option) => option.key !== "A")?.key ?? "B";

  const edited = await call<PageStateDto>(server.origin, "PATCH", `/api/p/${page.profileId}/answers/L1`, {
    answer: { questionId: "L1", kind: "выбор", option: other },
  });

  assert.equal(edited.status, 200);
  assert.equal(countProfileVersions(server.db, page.profileId), before + 1);
  assert.notDeepEqual(edited.body.blocks[0]?.paragraphs, page.blocks[0]?.paragraphs);

  const unknown = await call<ErrorDto>(server.origin, "PATCH", `/api/p/${page.profileId}/answers/L1`, {
    answer: { questionId: "L1", kind: "шкала", scale: 3 },
  });
  assert.equal(unknown.status, 400);
});

test("несогласие сохраняется как данные и видно в состоянии страницы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 3);
  const reply = await call<DisagreementResponse>(server.origin, "POST", `/api/p/${page.profileId}/disagreements`, {
    blockId: "step3",
    kind: "partly",
  });

  assert.equal(reply.status, 201);
  assert.equal(reply.body.disagreement.kind, "partly");
  assert.ok(reply.body.page.blocks.find((block) => block.id === "step3")?.disagreed);

  const unknownBlock = await call<ErrorDto>(server.origin, "POST", `/api/p/${page.profileId}/disagreements`, {
    blockId: "slice:none",
    kind: "partly",
  });
  assert.equal(unknownBlock.status, 404);

  const unknownKind = await call<ErrorDto>(server.origin, "POST", `/api/p/${page.profileId}/disagreements`, {
    blockId: "step3",
    kind: "не_нравится",
  });
  assert.equal(unknownKind.status, 400);
});

test("покупка создаёт заказ по цене из контента, повтор ключа не создаёт второй", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const slice = page.offer?.slice ?? "slice_node_finish";
  const price = rawContent.slices.find((candidate) => candidate.id === slice)?.price;

  const first = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: "buy-1",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.order.price, price);
  assert.equal(first.body.order.status, "created");
  assert.equal(first.body.order.payment, null);

  const repeat = await call<OrderResponse>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice,
    requestId: "buy-1",
  });
  assert.equal(repeat.body.order.orderId, first.body.order.orderId);

  const unknown = await call<ErrorDto>(server.origin, "POST", `/api/p/${page.profileId}/orders`, {
    slice: "slice_unknown",
    requestId: "buy-2",
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, "unknown_slice");
});

test("отказ отвечает машинным кодом, без русских продуктовых строк", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const cases: [string, string, unknown, number][] = [
    ["GET", "/api/nothing", undefined, 404],
    ["DELETE", "/api/health", undefined, 405],
    ["POST", "/api/profiles", { name: "" }, 400],
    ["POST", "/api/profiles", { name: "Аня", birthDate: "05.05.1990" }, 400],
  ];

  for (const [method, path, body, status] of cases) {
    const reply = await call<ErrorDto>(server.origin, method, path, body);
    assert.equal(reply.status, status, `${method} ${path}`);
    assert.ok(!/[А-Яа-я]/.test(JSON.stringify(reply.body)), "в отказе русский текст");
  }
});

test("события пишутся без персональных данных", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 4);
  const events = listEvents(server.db, page.profileId);

  assert.deepEqual(
    events.map((event) => event.type),
    ["profile.created", "portion.submitted", "portion.submitted", "portion.submitted", "portion.submitted"],
  );
  for (const event of events) {
    assert.ok(!event.payload.includes("Аня"), "имя в событии");
    assert.ok(!/[А-Яа-я]{10,}/.test(event.payload), "открытый ответ в событии");
  }
});
