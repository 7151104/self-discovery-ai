/**
 * Обработчики эндпоинтов. Каждый возвращает форму из контракта: типы ответов
 * обёрнуты в `Wire<>`, поэтому вернуть отсюда координату не получится.
 *
 * Правил продукта здесь нет. Проверяется только форма запроса, всё остальное
 * считает движок: состав вопросов, варианты ответов, пороги, цены и предложения
 * берутся из контента через `rawContent` и `buildPage`.
 */

import type {
  AnswerInput,
  BlockResponse,
  BlockSlot,
  DeleteResponse,
  DisagreementKind,
  DisagreementResponse,
  ErrorCode,
  ExportResponse,
  GenerationResponse,
  HealthResponse,
  OrderDto,
  OrderResponse,
  OrderStatus,
  PageStateResponse,
  PortionKey,
  PublicPageResponse,
  QuestionKind,
  ShareResponse,
  WebhookResponse,
} from "../contract/index.js";
import type { ServerConfig } from "../config.js";
import type { Db } from "../db/driver.js";
import { schemaVersion } from "../db/migrate.js";
import { rawContent } from "../engine.js";
import { isValidId, newProfileId, newRecordId, newShareToken } from "../ids.js";
import { assemble, assemblePublic, pageUrl, parseSliceQuestionId, portionOf, shareUrl } from "../page.js";
import {
  enqueueStep4,
  scheduleGenerations,
  toGenerationDto,
  type LlmRuntime,
} from "../generation.js";
import { canTransition } from "../payments/order-state.js";
import type { PaymentProvider, WebhookEvent, WebhookHeaders } from "../payments/provider.js";
import {
  deleteBlock,
  deleteProfile,
  findActiveOrderForSlice,
  findActiveShareToken,
  findBlockById,
  findDelivery,
  findJob,
  findOrder,
  findOrderById,
  findOrderByRequest,
  findProfile,
  findProfileByShareToken,
  findSubmission,
  insertDelivery,
  insertDisagreement,
  insertOrder,
  insertProfile,
  insertShareToken,
  insertSubmission,
  listAnswers,
  listBlocks,
  listDisagreements,
  listOrders,
  markBlocksStale,
  paidSlices,
  recordEvent,
  recordProfileVersion,
  releaseActiveJob,
  revokeShareTokens,
  saveAnswers,
  transitionOrder,
  type OrderRecord,
  type ProfileRecord,
} from "../store.js";

export interface Context {
  db: Db;
  config: ServerConfig;
  /** Платёжный провайдер: поднимается из настроек один раз на запуск сервера. */
  payments: PaymentProvider;
  /** Контур генерации: очередь крутится отсюда, слой LLM его не знает. */
  llm: LlmRuntime;
  startedAt: number;
}

/** Запрос, которому нужно тело дословно: подпись считается по исходной строке. */
export interface RawRequest {
  raw: string;
  headers: WebhookHeaders;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export const fail = (status: number, code: ErrorCode): HandlerResult => ({ status, body: { error: { code } } });

// ── Разбор запроса ────────────────────────────────────────────────────────────

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const DISAGREEMENT_KINDS: DisagreementKind[] = ["not_about_me", "partly", "too_general"];

const question = (id: string) => rawContent.questions.find((candidate) => candidate.id === id);

/** Вопрос по идентификатору: сперва лестница, потом доборы срезов. */
function knownQuestion(id: string): { type: QuestionKind; options: { key: string; text: string }[] } | null {
  const ladder = question(id);
  if (ladder) return { type: ladder.type, options: ladder.options };

  const parsed = parseSliceQuestionId(id);
  if (!parsed) return null;

  const slice = rawContent.slices.find((candidate) => candidate.id === parsed.slice);
  const found = slice?.questions.find((candidate) => candidate.id === parsed.questionId);
  return found ? { type: found.type, options: found.options } : null;
}

/**
 * Один ответ. Тип вопроса и допустимые варианты берутся из контента:
 * сервер их не перечисляет.
 */
function parseAnswer(raw: unknown): AnswerInput | null {
  const body = asObject(raw);
  if (!body) return null;

  const questionId = asString(body["questionId"]);
  const kind = asString(body["kind"]) as QuestionKind | null;
  if (!questionId || !kind) return null;

  const known = knownQuestion(questionId);
  if (!known || known.type !== kind) return null;

  if (kind === "выбор") {
    const option = asString(body["option"]);
    if (!option || !known.options.some((candidate) => candidate.key === option)) return null;
    return { questionId, kind, option };
  }

  if (kind === "шкала") {
    const scale = body["scale"];
    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 1 || scale > 5) return null;
    return { questionId, kind, scale: scale as 1 | 2 | 3 | 4 | 5 };
  }

  if (kind === "число") {
    const numbers = body["numbers"];
    if (!Array.isArray(numbers) || !numbers.length || numbers.length > 2) return null;
    if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) return null;
    return { questionId, kind, numbers: numbers as number[] };
  }

  const text = asString(body["text"]);
  if (text === null) return null;
  return { questionId, kind, text };
}

const answerValue = (answer: AnswerInput): string | number => {
  if (answer.kind === "выбор") return answer.option;
  if (answer.kind === "шкала") return answer.scale;
  // Две величины хранятся строкой через запятую: разбирает их движок доборов.
  if (answer.kind === "число") return answer.numbers.join(",");
  return answer.text;
};

// ── Профиль по идентификатору ─────────────────────────────────────────────────

/**
 * Идентификатор проверяется по форме до обращения к базе: перебор соседних
 * значений не доходит до запроса.
 */
function loadProfile(context: Context, profileId: string | undefined): ProfileRecord | null {
  if (!profileId || !isValidId(profileId)) return null;
  return findProfile(context.db, profileId);
}

const page = (context: Context, profile: ProfileRecord): PageStateResponse =>
  assemble({ db: context.db, profile, publicOrigin: context.config.publicOrigin }).page;

/**
 * Ставит финал лестницы в очередь, если задание есть, и будит воркер.
 * Повтор и гонка не порождают вторую генерацию: это держит уникальный индекс.
 */
function kickStep4(context: Context, profile: ProfileRecord): void {
  enqueueStep4({ db: context.db, llm: context.llm }, profile);
  scheduleGenerations({ db: context.db, llm: context.llm });
}

// ── Эндпоинты ─────────────────────────────────────────────────────────────────

export function health(context: Context): HandlerResult {
  let database: HealthResponse["database"] = "ok";
  let version: string | null = null;
  try {
    version = schemaVersion(context.db);
  } catch {
    database = "unavailable";
  }

  const build = context.config.build;
  const body: HealthResponse = {
    status: "ok",
    version: build.version,
    build: { commit: build.commit, builtAt: build.builtAt },
    environment: context.config.environment,
    uptimeMs: Date.now() - context.startedAt,
    database,
    schemaVersion: version,
  };
  return { status: 200, body };
}

export function createProfile(context: Context, raw: unknown): HandlerResult {
  const body = asObject(raw);
  const name = body ? asString(body["name"])?.trim() : null;
  const birthRaw = body ? body["birthDate"] : undefined;

  if (!name || name.length > 80) return fail(400, "bad_request");
  if (birthRaw !== null && typeof birthRaw !== "string") return fail(400, "bad_request");
  const birthDate = typeof birthRaw === "string" && birthRaw.length ? birthRaw : null;
  if (birthDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return fail(400, "bad_request");

  const profile = context.db.transaction(() => {
    const created = insertProfile(context.db, { profileId: newProfileId(), name, birthDate });
    recordEvent(context.db, "profile.created", {
      profileId: created.profileId,
      payload: { hasBirthDate: birthDate === null ? 0 : 1 },
    });
    return created;
  });

  return { status: 201, body: page(context, profile) };
}

export function pageState(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");
  const body = context.db.transaction(() => {
    enqueueStep4({ db: context.db, llm: context.llm }, profile);
    return page(context, profile);
  });
  scheduleGenerations({ db: context.db, llm: context.llm });
  return { status: 200, body };
}

/**
 * Приём порции. Идемпотентность держится ключом отправки: повтор при обрыве
 * связи или двойном нажатии не пишет ответы второй раз и не пересчитывает
 * профиль второй раз, а отвечает текущим состоянием страницы.
 */
export function submitPortion(context: Context, params: Record<string, string>, raw: unknown): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const body = asObject(raw);
  const portion = body ? (asString(body["portion"]) as PortionKey | null) : null;
  const requestId = body ? asString(body["requestId"]) : null;
  const list = body?.["answers"];
  if (!portion || !requestId || !Array.isArray(list) || !list.length) return fail(400, "bad_request");

  const answers = list.map(parseAnswer);
  if (answers.some((answer) => answer === null)) return fail(400, "unknown_question");

  const parsed = answers as AnswerInput[];
  if (parsed.some((answer) => portionOf(answer.questionId) !== portion)) return fail(400, "bad_request");

  const state = context.db.transaction(() => {
    // Повтор той же отправки: ответы уже записаны, профиль уже пересчитан.
    if (findSubmission(context.db, profile.profileId, requestId)) {
      enqueueStep4({ db: context.db, llm: context.llm }, profile);
      return page(context, profile);
    }

    saveAnswers(
      context.db,
      profile.profileId,
      parsed.map((answer) => ({
        questionId: answer.questionId,
        kind: answer.kind,
        portion,
        value: answerValue(answer),
      })),
    );
    recordEvent(context.db, "portion.submitted", {
      profileId: profile.profileId,
      payload: { portion, answers: parsed.length },
    });

    const version = revise(context, profile, "portion");
    insertSubmission(context.db, profile.profileId, {
      requestId,
      portion,
      answerCount: parsed.length,
      profileVersion: version,
    });
    const current = findProfile(context.db, profile.profileId);
    if (current) enqueueStep4({ db: context.db, llm: context.llm }, current);
    return currentPage(context, profile.profileId);
  });

  scheduleGenerations({ db: context.db, llm: context.llm });
  return { status: 200, body: state };
}

export function editAnswer(context: Context, params: Record<string, string>, raw: unknown): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const questionId = params["questionId"];
  const body = asObject(raw);
  const answer = body ? parseAnswer(body["answer"]) : null;
  if (!questionId || !answer || answer.questionId !== questionId) return fail(400, "bad_request");

  const portion = portionOf(questionId);
  if (!portion) return fail(400, "unknown_question");

  const known = listAnswers(context.db, profile.profileId).some((record) => record.questionId === questionId);
  if (!known) return fail(404, "not_found");

  const state = context.db.transaction(() => {
    saveAnswers(context.db, profile.profileId, [
      { questionId, kind: answer.kind, portion, value: answerValue(answer) },
    ]);
    // Купленные и сгенерированные блоки не переписываются: на них отметка о расхождении.
    markBlocksStale(context.db, profile.profileId);
    recordEvent(context.db, "answer.edited", { profileId: profile.profileId, payload: { portion } });
    revise(context, profile, "answer_edit");
    // Вход генерации изменился: живое задание со старым хешем снимаем со слота,
    // место в уникальном индексе освобождается под новое.
    releaseActiveJob(context.db, profile.profileId, "step4", "superseded");
    return currentPage(context, profile.profileId);
  });

  const fresh = findProfile(context.db, profile.profileId);
  if (fresh) kickStep4(context, fresh);
  return { status: 200, body: state };
}

export function disagree(context: Context, params: Record<string, string>, raw: unknown): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const body = asObject(raw);
  const blockId = body ? (asString(body["blockId"]) as BlockSlot | null) : null;
  const kind = body ? (asString(body["kind"]) as DisagreementKind | null) : null;
  if (!blockId || !kind || !DISAGREEMENT_KINDS.includes(kind)) return fail(400, "bad_request");

  const result = context.db.transaction(() => {
    const current = page(context, profile);
    const block = current.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return null;

    const disagreement = insertDisagreement(context.db, profile.profileId, {
      slot: blockId,
      blockId: block.generation?.id ?? null,
      kind,
    });
    recordEvent(context.db, "block.disagreed", {
      profileId: profile.profileId,
      payload: { slot: blockId, kind },
    });

    const response: DisagreementResponse = {
      disagreement: { disagreementId: disagreement.disagreementId, blockId, kind },
      page: page(context, profile),
    };
    return response;
  });

  return result === null ? fail(404, "not_found") : { status: 201, body: result };
}

/** Проекция заказа в контракт. Платёжный адрес держится только у живого заказа. */
const projectOrder = (context: Context, order: OrderRecord, url: string | null): OrderDto => ({
  orderId: order.orderId,
  slice: order.slice,
  price: order.price,
  currency: order.currency,
  status: order.status,
  payment:
    url && order.provider && order.mode ? { provider: order.provider, mode: order.mode, url } : null,
});

/**
 * Покупка среза.
 *
 * Цена и состав среза приходят из `content/slices/README.md` через сборщик
 * (E8-08): числа цен в коде сервера нет ни одного.
 *
 * Повторная покупка невозможна двумя способами сразу (E8-07). Ключ отправки
 * ловит повтор одного и того же запроса; уникальный индекс по «профиль плюс
 * живой срез» ловит две разные попытки купить один срез — в том числе
 * одновременные, потому что решает не проверка в коде, а база.
 */
export function purchase(context: Context, params: Record<string, string>, raw: unknown): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const body = asObject(raw);
  const slice = body ? asString(body["slice"]) : null;
  const requestId = body ? asString(body["requestId"]) : null;
  if (!slice || !requestId) return fail(400, "bad_request");

  // Состав срезов и цены — из content/slices/README.md, а не из кода сервера.
  const known = rawContent.slices.find((candidate) => candidate.id === slice);
  if (!known) return fail(400, "unknown_slice");

  const result = context.db.transaction((): { order: OrderRecord; created: boolean; url: string | null } => {
    const repeat = findOrderByRequest(context.db, profile.profileId, requestId);
    if (repeat) return { order: repeat, created: false, url: null };

    const active = findActiveOrderForSlice(context.db, profile.profileId, slice);
    if (active) return { order: active, created: false, url: null };

    const payment = context.payments.createPayment({
      orderId: newRecordId(),
      amount: known.price,
      currency: "RUB",
      slice,
      returnUrl: pageUrl(context.config.publicOrigin, profile.profileId),
    });

    const order = insertOrder(context.db, profile.profileId, {
      slice,
      price: known.price,
      requestId,
      provider: context.payments.name,
      providerRef: payment.reference,
      mode: context.payments.mode,
    });
    recordEvent(context.db, "order.created", {
      profileId: profile.profileId,
      payload: { slice, provider: context.payments.name, mode: context.payments.mode },
    });
    return { order, created: true, url: payment.url };
  });

  const response: OrderResponse = {
    order: projectOrder(context, result.order, result.url),
    page: context.db.transaction(() => page(context, profile)),
  };
  return { status: result.created ? 201 : 200, body: response };
}

/**
 * Уведомление провайдера (E8-03).
 *
 * Единственный вход, которым заказ становится оплаченным: клиент такого
 * перехода запросить не может. Порядок жёсткий — сперва подпись, потом
 * защита от повторной доставки, и только потом заказ.
 *
 * Провайдеры повторяют уведомление, пока не получат подтверждение, поэтому
 * повтор — обычное дело, а не ошибка: на него отвечаем успехом и `duplicate`,
 * иначе провайдер будет слать его вечно.
 */
export function webhook(context: Context, params: Record<string, string>, input: RawRequest): HandlerResult {
  const provider = params["provider"];
  if (provider !== context.payments.name) return fail(404, "not_found");

  // Подпись считается по телу запроса дословно, поэтому уведомление —
  // единственный эндпоинт, которому нужен не разобранный JSON, а исходная строка.
  const event = context.payments.parseWebhook(input.raw, input.headers);
  if (!event) return fail(400, "invalid_signature");

  const result = context.db.transaction((): WebhookResponse["result"] => {
    if (findDelivery(context.db, provider, event.eventId)) return "duplicate";

    const order = findOrderById(context.db, event.orderId);
    const applied = order ? applyWebhook(context, order, event) : "ignored";
    insertDelivery(context.db, {
      provider,
      eventId: event.eventId,
      kind: event.kind,
      orderId: order?.orderId ?? null,
      result: applied,
    });
    return applied;
  });

  const body: WebhookResponse = { received: true, result };
  return { status: 200, body };
}

/** Что уведомление делает с заказом. Недопустимый переход не выполняется. */
function applyWebhook(context: Context, order: OrderRecord, event: WebhookEvent): "applied" | "ignored" {
  const target: OrderStatus | null =
    event.kind === "payment.succeeded"
      ? "paid"
      : event.kind === "payment.failed"
        ? "failed"
        : event.kind === "refund.succeeded"
          ? "refunded"
          : null;

  if (!target || !canTransition(order.status, target)) return "ignored";

  // Сумма из уведомления должна совпадать с заказом: цену назначает контент,
  // а не тот, кто прислал уведомление.
  if (target === "paid" && event.amount !== order.price) return "ignored";

  transitionOrder(context.db, order, target, "webhook");
  if (target === "refunded") revokeSliceAccess(context, order);

  recordEvent(context.db, `order.${target}`, {
    profileId: order.profileId,
    payload: { slice: order.slice, provider: context.payments.name },
  });
  return "applied";
}

/**
 * Возврат средств и отзыв доступа (E8-06).
 *
 * Решение основателя: возврат полный, пока итоговый текст среза не собран.
 * После сборки текста автоматического возврата нет — заказ помечается для
 * ручного разбора, а не отклоняется молча.
 */
export function refund(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const orderId = params["orderId"];
  const order = orderId ? findOrder(context.db, profile.profileId, orderId) : null;
  if (!order) return fail(404, "not_found");
  if (!canTransition(order.status, "refunded")) return fail(409, "invalid_transition");

  const delivered = listBlocks(context.db, profile.profileId).some(
    (block) => block.slot === `slice:${order.slice}` && block.status === "ready",
  );
  if (delivered) {
    recordEvent(context.db, "refund.manual_required", {
      profileId: profile.profileId,
      payload: { slice: order.slice },
    });
    return fail(409, "refund_unavailable");
  }

  const updated = context.db.transaction(() => {
    context.payments.refund({
      reference: order.providerRef ?? order.orderId,
      amount: order.price,
      currency: order.currency,
    });
    const next = transitionOrder(context.db, order, "refunded", "refund_requested");
    revokeSliceAccess(context, order);
    recordEvent(context.db, "order.refunded", {
      profileId: profile.profileId,
      payload: { slice: order.slice, initiator: "owner" },
    });
    return next;
  });

  const response: OrderResponse = {
    order: projectOrder(context, updated, null),
    page: context.db.transaction(() => currentPage(context, profile.profileId)),
  };
  return { status: 200, body: response };
}

/**
 * Отзыв доступа к срезу: блок убирается вместе с текстом.
 *
 * Ответы добора остаются: их дал человек, и стирать их за возврат — наказание,
 * а не отзыв доступа.
 */
function revokeSliceAccess(context: Context, order: OrderRecord): void {
  deleteBlock(context.db, order.profileId, `slice:${order.slice}`);
}

/**
 * Текст одного блока.
 *
 * Платный срез требует оплаченного заказа (E8-04). Проверяется заказ, а не
 * наличие блока: без заказа ответ отказной, даже если текст в базе есть.
 */
export function blockText(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const slot = params["slot"] as BlockSlot | undefined;
  if (!slot) return fail(400, "bad_request");

  if (slot.startsWith("slice:")) {
    const slice = slot.slice("slice:".length);
    if (!paidSlices(context.db, profile.profileId).includes(slice)) return fail(402, "payment_required");
  }

  const current = context.db.transaction(() => page(context, profile));
  const block = current.blocks.find((candidate) => candidate.id === slot);
  if (!block) return fail(404, "not_found");

  const body: BlockResponse = { block };
  return { status: 200, body };
}

export function generationStatus(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const generationId = params["generationId"];
  if (!generationId || !isValidId(generationId)) return fail(404, "not_found");

  const job = findJob(context.db, profile.profileId, generationId);
  if (job) {
    const body: GenerationResponse = { generation: toGenerationDto(job) };
    return { status: 200, body };
  }

  const block = findBlockById(context.db, profile.profileId, generationId);
  if (!block) return fail(404, "not_found");

  const body: GenerationResponse = {
    generation: { id: block.blockId, blockId: block.slot, status: block.status, regenerated: false },
  };
  return { status: 200, body };
}

/**
 * Ручная регенерация финала лестницы. Обходит кэш, помечает прогон.
 * Повтор с тем же ключом отправки возвращает то же задание.
 */
export function regenerate(context: Context, params: Record<string, string>, raw: unknown): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const body = asObject(raw);
  const requestId = body ? asString(body["requestId"]) : null;
  if (!requestId) return fail(400, "bad_request");

  const job = context.db.transaction(() =>
    enqueueStep4({ db: context.db, llm: context.llm }, profile, { regenerate: true, requestId }),
  );
  scheduleGenerations({ db: context.db, llm: context.llm });
  if (!job) return fail(404, "not_found");

  const response: GenerationResponse = { generation: toGenerationDto(job) };
  return { status: 200, body: response };
}

/** Пересчёт профиля: новая версия и снимок. Возвращает номер версии. */
function revise(context: Context, profile: ProfileRecord, reason: "portion" | "answer_edit"): number {
  const { internal } = assemble({ db: context.db, profile, publicOrigin: context.config.publicOrigin });
  return recordProfileVersion(context.db, profile.profileId, reason, internal.internal.profile);
}

/** Состояние страницы по свежей записи профиля: версия и время уже обновлены. */
function currentPage(context: Context, profileId: string): PageStateResponse {
  const profile = findProfile(context.db, profileId);
  if (!profile) throw new Error(`profile-vanished:${profileId}`);
  return page(context, profile);
}

// ── Выгрузка и удаление данных ────────────────────────────────────────────────

/**
 * Выгрузка данных человека (E9-03).
 *
 * Отдаётся то, что человек дал, и то, что ему показали: ответы словами,
 * блоки, заказы, несогласия, публичная ссылка. Внутреннего профиля здесь нет —
 * координаты не отдаются даже владельцу страницы, иначе выгрузка становится
 * дырой в стене типов, а не выгрузкой.
 */
export function exportProfile(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const current = context.db.transaction(() => page(context, profile));
  const share = findActiveShareToken(context.db, profile.profileId);

  const body: ExportResponse = {
    profileId: profile.profileId,
    exportedAt: new Date().toISOString(),
    person: { name: profile.name, birthDate: profile.birthDate },
    answers: listAnswers(context.db, profile.profileId).map((record) => ({
      questionId: record.questionId,
      portion: record.portion,
      question: questionText(record.questionId),
      answer: answerText(record.questionId, record.value),
    })),
    blocks: current.blocks,
    orders: listOrders(context.db, profile.profileId).map((order) => projectOrder(context, order, null)),
    disagreements: listDisagreements(context.db, profile.profileId).map((record) => ({
      disagreementId: record.disagreementId,
      blockId: record.slot,
      kind: record.kind,
    })),
    share: share ? { url: shareUrl(context.config.publicOrigin, share.token), createdAt: share.createdAt } : null,
  };
  return { status: 200, body };
}

/** Формулировка вопроса из контента: в выгрузке человек читает вопрос, а не его код. */
function questionText(questionId: string): string {
  const ladder = question(questionId);
  if (ladder) return ladder.text;

  const parsed = parseSliceQuestionId(questionId);
  if (!parsed) return questionId;
  const known = rawContent.slices
    .find((candidate) => candidate.id === parsed.slice)
    ?.questions.find((candidate) => candidate.id === parsed.questionId);
  return known?.text ?? questionId;
}

/** Ответ словами: выбранный вариант разворачивается в его текст. */
function answerText(questionId: string, value: string | number): string {
  if (typeof value === "number") return String(value);

  const ladder = question(questionId);
  const option = ladder?.options.find((candidate) => candidate.key === value);
  if (option) return option.text;

  const parsed = parseSliceQuestionId(questionId);
  const sliceOption = parsed
    ? rawContent.slices
        .find((candidate) => candidate.id === parsed.slice)
        ?.questions.find((candidate) => candidate.id === parsed.questionId)
        ?.options.find((candidate) => candidate.key === value)
    : undefined;
  return sliceOption?.text ?? value;
}

/**
 * Удаление профиля (E9-03).
 *
 * Удаляется всё, что к профилю привязано: ответы, снимки, блоки, заказы,
 * журнал заказов, несогласия и токены публичной ссылки. Событий воронки это не
 * стирает, но отвязывает: в базе остаётся «кто-то дошёл до ступени 3», без
 * указания кто. Отменить удаление нельзя, подтверждение спрашивает интерфейс.
 */
export function deleteProfileHandler(context: Context, params: Record<string, string>): HandlerResult {
  const profileId = params["profileId"];
  if (!profileId || !isValidId(profileId)) return fail(404, "profile_not_found");

  const removed = deleteProfile(context.db, profileId);
  if (!removed) return fail(404, "profile_not_found");

  // Событие пишется без профиля: связывать запись об удалении с удалённым
  // человеком значит не удалить его.
  recordEvent(context.db, "profile.deleted");

  const body: DeleteResponse = { deleted: true };
  return { status: 200, body };
}

// ── Публичный вид и токен шеринга ─────────────────────────────────────────────

/** «Поделиться». Повторное нажатие отдаёт тот же токен, а не плодит ссылки. */
export function share(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const body = context.db.transaction(() => {
    const existing = findActiveShareToken(context.db, profile.profileId);
    const token = existing ?? insertShareToken(context.db, profile.profileId, newShareToken());
    if (!existing) recordEvent(context.db, "share.enabled", { profileId: profile.profileId });

    const response: ShareResponse = {
      share: { url: shareUrl(context.config.publicOrigin, token.token), createdAt: token.createdAt },
      page: page(context, profile),
    };
    return response;
  });

  return { status: 200, body };
}

/** Отзыв публичной ссылки: выданный адрес перестаёт работать. */
export function revokeShare(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const body = context.db.transaction(() => {
    const revoked = revokeShareTokens(context.db, profile.profileId);
    if (revoked) recordEvent(context.db, "share.revoked", { profileId: profile.profileId, payload: { revoked } });
    const response: ShareResponse = { share: null, page: page(context, profile) };
    return response;
  });

  return { status: 200, body };
}

/**
 * Публичный вид по токену.
 *
 * Пока человек не нажал «Поделиться», токена не существует, поэтому любая
 * публичная ссылка отвечает отказом; отозванный токен не находится тем же
 * запросом. Отказ один и тот же, чтобы по коду ответа нельзя было отличить
 * «не было» от «отозвано».
 */
export function publicPage(context: Context, params: Record<string, string>): HandlerResult {
  const token = params["token"];
  if (!token || !isValidId(token)) return fail(404, "not_found");

  const profile = findProfileByShareToken(context.db, token);
  if (!profile) return fail(404, "not_found");

  const full = context.db.transaction(() => page(context, profile));
  const body: PublicPageResponse = assemblePublic(full);
  return { status: 200, body };
}
