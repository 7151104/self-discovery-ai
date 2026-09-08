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
  BlockSlot,
  DisagreementKind,
  DisagreementResponse,
  ErrorCode,
  GenerationResponse,
  HealthResponse,
  OrderResponse,
  PageStateResponse,
  PortionKey,
  PublicPageResponse,
  QuestionKind,
  ShareResponse,
} from "../contract/index.js";
import type { ServerConfig } from "../config.js";
import type { Db } from "../db/driver.js";
import { schemaVersion } from "../db/migrate.js";
import { rawContent } from "../engine.js";
import { isValidId, newProfileId, newShareToken } from "../ids.js";
import { assemble, assemblePublic, portionOf, shareUrl } from "../page.js";
import {
  findActiveShareToken,
  findBlockById,
  findOrderByRequest,
  findProfile,
  findProfileByShareToken,
  findSubmission,
  insertDisagreement,
  insertOrder,
  insertProfile,
  insertShareToken,
  insertSubmission,
  listAnswers,
  markBlocksStale,
  recordEvent,
  recordProfileVersion,
  revokeShareTokens,
  saveAnswers,
  type ProfileRecord,
} from "../store.js";

export interface Context {
  db: Db;
  config: ServerConfig;
  version: string;
  startedAt: number;
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

  const known = question(questionId);
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

  const text = asString(body["text"]);
  if (text === null) return null;
  return { questionId, kind, text };
}

const answerValue = (answer: AnswerInput): string | number =>
  answer.kind === "выбор" ? answer.option : answer.kind === "шкала" ? answer.scale : answer.text;

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

// ── Эндпоинты ─────────────────────────────────────────────────────────────────

export function health(context: Context): HandlerResult {
  let database: HealthResponse["database"] = "ok";
  let version: string | null = null;
  try {
    version = schemaVersion(context.db);
  } catch {
    database = "unavailable";
  }

  const body: HealthResponse = {
    status: "ok",
    version: context.version,
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
  return { status: 200, body: context.db.transaction(() => page(context, profile)) };
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
    return currentPage(context, profile.profileId);
  });

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
    return currentPage(context, profile.profileId);
  });

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

  const result = context.db.transaction(() => {
    const existing = findOrderByRequest(context.db, profile.profileId, requestId);
    const order = existing ?? insertOrder(context.db, profile.profileId, { slice, price: known.price, requestId });
    if (!existing) {
      recordEvent(context.db, "order.created", { profileId: profile.profileId, payload: { slice } });
    }

    const response: OrderResponse = {
      // Провайдер платежей выбирается в E8: до него ссылки на оплату нет.
      order: { ...order, payment: null },
      page: page(context, profile),
    };
    return response;
  });

  return { status: existingStatus(result), body: result };
}

const existingStatus = (response: OrderResponse): number => (response.order.status === "created" ? 201 : 200);

export function generationStatus(context: Context, params: Record<string, string>): HandlerResult {
  const profile = loadProfile(context, params["profileId"]);
  if (!profile) return fail(404, "profile_not_found");

  const generationId = params["generationId"];
  if (!generationId || !isValidId(generationId)) return fail(404, "not_found");

  const block = findBlockById(context.db, profile.profileId, generationId);
  if (!block) return fail(404, "not_found");

  const body: GenerationResponse = {
    generation: { id: block.blockId, blockId: block.slot, status: block.status },
  };
  return { status: 200, body };
}

/** Пересчёт профиля: новая версия и снимок. Возвращает номер версии. */
function revise(context: Context, profile: ProfileRecord, reason: "portion" | "answer_edit"): number {
  const { internal } = assemble({ db: context.db, profile, publicOrigin: context.config.publicOrigin });
  return recordProfileVersion(context.db, profile.profileId, reason, internal.internalProfile);
}

/** Состояние страницы по свежей записи профиля: версия и время уже обновлены. */
function currentPage(context: Context, profileId: string): PageStateResponse {
  const profile = findProfile(context.db, profileId);
  if (!profile) throw new Error(`profile-vanished:${profileId}`);
  return page(context, profile);
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
