/**
 * Хранение. Единственный модуль, который знает SQL; выше него ходят только
 * записи, описанные здесь.
 *
 * Правил продукта тут нет: скоринг, узлы, блоки, карту и офферы считает движок.
 * Хранятся ответы, снимки профиля, тексты, которые пересчитать нельзя, заказы,
 * несогласия и события.
 */

import type {
  BlockSlot,
  DisagreementKind,
  GenerationStatus,
  OrderStatus,
  PortionKey,
  QuestionKind,
} from "./contract/index.js";
import type { Db } from "./db/driver.js";
import { seal, unseal, unsealOptional, PLAINTEXT } from "./db/stored-text.js";
import { newRecordId } from "./ids.js";
import { scrub } from "./log.js";
import { canTransition, InvalidTransition, isActive, type TransitionReason } from "./payments/order-state.js";
import type { PaymentMode } from "./payments/provider.js";

const now = (): string => new Date().toISOString();

// ── Профиль ───────────────────────────────────────────────────────────────────

export interface ProfileRecord {
  profileId: string;
  name: string;
  birthDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ProfileRow {
  profile_id: string;
  name_payload: string;
  name_enc: string;
  birth_date_payload: string | null;
  birth_date_enc: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const toProfile = (db: Db, row: ProfileRow): ProfileRecord => ({
  profileId: row.profile_id,
  name: unseal(db.keys, { payload: row.name_payload, enc: row.name_enc }),
  birthDate: unsealOptional(db.keys, row.birth_date_payload, row.birth_date_enc),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function insertProfile(
  db: Db,
  input: { profileId: string; name: string; birthDate: string | null },
): ProfileRecord {
  const timestamp = now();
  const name = seal(db.keys, input.name);
  const birth = input.birthDate === null ? null : seal(db.keys, input.birthDate);

  db.run(
    `INSERT INTO profiles
       (profile_id, name_payload, name_enc, birth_date_payload, birth_date_enc, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [input.profileId, name.payload, name.enc, birth?.payload ?? null, birth?.enc ?? PLAINTEXT, timestamp, timestamp],
  );

  return {
    profileId: input.profileId,
    name: input.name,
    birthDate: input.birthDate,
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Удаляет профиль со всем, что к нему привязано (E9-03).
 *
 * Ответы, снимки, блоки, заказы, журнал заказов, несогласия и токены уходят
 * каскадом — связи объявлены в схеме, второго списка таблиц в коде нет и он не
 * может разойтись со схемой. События воронки остаются, но теряют профиль:
 * связь объявлена как ON DELETE SET NULL, то есть в базе остаётся «кто-то дошёл
 * до ступени 3», без указания кто.
 */
export function deleteProfile(db: Db, profileId: string): boolean {
  return db.transaction(() => {
    if (!findProfile(db, profileId)) return false;
    db.run("DELETE FROM profiles WHERE profile_id = ?", [profileId]);
    return true;
  });
}

export function findProfile(db: Db, profileId: string): ProfileRecord | null {
  const row = db.get<ProfileRow>(
    `SELECT profile_id, name_payload, name_enc, birth_date_payload, birth_date_enc, version, created_at, updated_at
       FROM profiles WHERE profile_id = ?`,
    [profileId],
  );
  return row ? toProfile(db, row) : null;
}

// ── Согласие ──────────────────────────────────────────────────────────────────

export interface ConsentRecord {
  profileId: string;
  version: string;
  consentedAt: string;
}

interface ConsentRow {
  profile_id: string;
  version: string;
  consented_at: string;
}

const toConsent = (row: ConsentRow): ConsentRecord => ({
  profileId: row.profile_id,
  version: row.version,
  consentedAt: row.consented_at,
});

/** Записывает отметку согласия. Повтор обновляет версию и время. */
export function insertConsent(db: Db, profileId: string, version: string): ConsentRecord {
  const timestamp = now();
  db.run(
    `INSERT INTO consents (profile_id, version, consented_at)
     VALUES (?, ?, ?)
     ON CONFLICT (profile_id) DO UPDATE SET
       version = excluded.version,
       consented_at = excluded.consented_at`,
    [profileId, version, timestamp],
  );
  return { profileId, version, consentedAt: timestamp };
}

export function findConsent(db: Db, profileId: string): ConsentRecord | null {
  const row = db.get<ConsentRow>(
    "SELECT profile_id, version, consented_at FROM consents WHERE profile_id = ?",
    [profileId],
  );
  return row ? toConsent(row) : null;
}

// ── Ответы ────────────────────────────────────────────────────────────────────

export interface AnswerRecord {
  questionId: string;
  kind: QuestionKind;
  portion: PortionKey;
  /** Шкала приходит числом, выбор и открытый ответ — строкой. */
  value: string | number;
  revision: number;
}

interface AnswerRow {
  question_id: string;
  question_kind: QuestionKind;
  portion: PortionKey;
  payload: string;
  payload_enc: string;
  revision: number;
}

const toAnswer = (db: Db, row: AnswerRow): AnswerRecord => {
  const text = unseal(db.keys, { payload: row.payload, enc: row.payload_enc });
  return {
    questionId: row.question_id,
    kind: row.question_kind,
    portion: row.portion,
    value: row.question_kind === "шкала" ? Number(text) : text,
    revision: row.revision,
  };
};

export function listAnswers(db: Db, profileId: string): AnswerRecord[] {
  return db
    .all<AnswerRow>(
      `SELECT question_id, question_kind, portion, payload, payload_enc, revision
         FROM answers WHERE profile_id = ? ORDER BY question_id`,
      [profileId],
    )
    .map((row) => toAnswer(db, row));
}

export interface AnswerInputRecord {
  questionId: string;
  kind: QuestionKind;
  portion: PortionKey;
  value: string | number;
}

/** Записывает ответы порции. Повторная запись того же вопроса поднимает ревизию. */
export function saveAnswers(db: Db, profileId: string, answers: AnswerInputRecord[]): void {
  const timestamp = now();
  for (const answer of answers) {
    const stored = seal(db.keys, String(answer.value));
    db.run(
      `INSERT INTO answers
         (profile_id, question_id, question_kind, portion, payload, payload_enc, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (profile_id, question_id) DO UPDATE SET
         question_kind = excluded.question_kind,
         portion       = excluded.portion,
         payload       = excluded.payload,
         payload_enc   = excluded.payload_enc,
         revision      = answers.revision + 1,
         updated_at    = excluded.updated_at`,
      [
        profileId,
        answer.questionId,
        answer.kind,
        answer.portion,
        stored.payload,
        stored.enc,
        timestamp,
        timestamp,
      ],
    );
  }
}

// ── Отправки порций ───────────────────────────────────────────────────────────

export interface SubmissionRecord {
  requestId: string;
  portion: PortionKey;
  answerCount: number;
  profileVersion: number;
}

export function findSubmission(db: Db, profileId: string, requestId: string): SubmissionRecord | null {
  const row = db.get<{ request_id: string; portion: PortionKey; answer_count: number; profile_version: number }>(
    `SELECT request_id, portion, answer_count, profile_version
       FROM portion_submissions WHERE profile_id = ? AND request_id = ?`,
    [profileId, requestId],
  );
  return row
    ? {
        requestId: row.request_id,
        portion: row.portion,
        answerCount: row.answer_count,
        profileVersion: row.profile_version,
      }
    : null;
}

/**
 * Отмечает отправку выполненной. Первичный ключ (profile_id, request_id) не даёт
 * записать её дважды: при гонке двух одинаковых запросов вторая вставка падает,
 * и вызывающий разбирает это как повтор.
 */
export function insertSubmission(db: Db, profileId: string, record: SubmissionRecord): void {
  db.run(
    `INSERT INTO portion_submissions
       (profile_id, request_id, portion, answer_count, profile_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [profileId, record.requestId, record.portion, record.answerCount, record.profileVersion, now()],
  );
}

export function countSubmissions(db: Db, profileId: string): number {
  const row = db.get<{ total: number }>("SELECT COUNT(*) AS total FROM portion_submissions WHERE profile_id = ?", [
    profileId,
  ]);
  return row?.total ?? 0;
}

// ── Токен публичной ссылки ────────────────────────────────────────────────────

export interface ShareTokenRecord {
  token: string;
  createdAt: string;
}

/** Действующий токен профиля или null: пока его нет, страница закрыта. */
export function findActiveShareToken(db: Db, profileId: string): ShareTokenRecord | null {
  const row = db.get<{ token: string; created_at: string }>(
    `SELECT token, created_at FROM share_tokens
       WHERE profile_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
    [profileId],
  );
  return row ? { token: row.token, createdAt: row.created_at } : null;
}

/** Профиль по действующему токену. Отозванный токен не находится. */
export function findProfileByShareToken(db: Db, token: string): ProfileRecord | null {
  const row = db.get<{ profile_id: string }>(
    "SELECT profile_id FROM share_tokens WHERE token = ? AND revoked_at IS NULL",
    [token],
  );
  return row ? findProfile(db, row.profile_id) : null;
}

export function insertShareToken(db: Db, profileId: string, token: string): ShareTokenRecord {
  const timestamp = now();
  db.run("INSERT INTO share_tokens (token, profile_id, created_at, revoked_at) VALUES (?, ?, ?, NULL)", [
    token,
    profileId,
    timestamp,
  ]);
  return { token, createdAt: timestamp };
}

/** Отзывает все действующие токены профиля. Возвращает, сколько отозвано. */
export function revokeShareTokens(db: Db, profileId: string): number {
  const before = db.get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM share_tokens WHERE profile_id = ? AND revoked_at IS NULL",
    [profileId],
  );
  db.run("UPDATE share_tokens SET revoked_at = ? WHERE profile_id = ? AND revoked_at IS NULL", [
    now(),
    profileId,
  ]);
  return before?.total ?? 0;
}

// ── Версии профиля ────────────────────────────────────────────────────────────

export type VersionReason = "portion" | "answer_edit" | "purchase";

/** Пересчёт профиля: новая версия и снимок. Снимок наружу не отдаётся. */
export function recordProfileVersion(
  db: Db,
  profileId: string,
  reason: VersionReason,
  snapshot: unknown,
): number {
  const timestamp = now();
  db.run("UPDATE profiles SET version = version + 1, updated_at = ? WHERE profile_id = ?", [timestamp, profileId]);
  const row = db.get<{ version: number }>("SELECT version FROM profiles WHERE profile_id = ?", [profileId]);
  const version = row?.version ?? 0;
  const stored = seal(db.keys, JSON.stringify(snapshot));

  db.run(
    `INSERT INTO profile_versions (version_id, profile_id, version, reason, snapshot, snapshot_enc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newRecordId(), profileId, version, reason, stored.payload, stored.enc, timestamp],
  );
  return version;
}

export function countProfileVersions(db: Db, profileId: string): number {
  const row = db.get<{ total: number }>("SELECT COUNT(*) AS total FROM profile_versions WHERE profile_id = ?", [
    profileId,
  ]);
  return row?.total ?? 0;
}

// ── Блоки ─────────────────────────────────────────────────────────────────────

export interface BlockRecord {
  blockId: string;
  slot: BlockSlot;
  profileVersion: number;
  status: "pending" | "ready" | "failed";
  origin: "lookup" | "llm";
  purchased: boolean;
  stale: boolean;
  heading: string;
  paragraphs: string[];
  highlight: string | null;
}

interface BlockRow {
  block_id: string;
  slot: BlockSlot;
  profile_version: number;
  status: BlockRecord["status"];
  origin: BlockRecord["origin"];
  purchased: number;
  stale: number;
  heading_payload: string;
  heading_enc: string;
  body_payload: string;
  body_enc: string;
}

interface BlockBody {
  paragraphs: string[];
  highlight: string | null;
}

const toBlock = (db: Db, row: BlockRow): BlockRecord => {
  const raw = unseal(db.keys, { payload: row.body_payload, enc: row.body_enc });
  const body: BlockBody = raw ? (JSON.parse(raw) as BlockBody) : { paragraphs: [], highlight: null };
  return {
    blockId: row.block_id,
    slot: row.slot,
    profileVersion: row.profile_version,
    status: row.status,
    origin: row.origin,
    purchased: row.purchased === 1,
    stale: row.stale === 1,
    heading: unseal(db.keys, { payload: row.heading_payload, enc: row.heading_enc }),
    paragraphs: body.paragraphs,
    highlight: body.highlight,
  };
};

const BLOCK_COLUMNS = `block_id, slot, profile_version, status, origin, purchased, stale,
  heading_payload, heading_enc, body_payload, body_enc`;

export function listBlocks(db: Db, profileId: string): BlockRecord[] {
  return db
    .all<BlockRow>(`SELECT ${BLOCK_COLUMNS} FROM blocks WHERE profile_id = ? ORDER BY slot`, [profileId])
    .map((row) => toBlock(db, row));
}

export function findBlockById(db: Db, profileId: string, blockId: string): BlockRecord | null {
  const row = db.get<BlockRow>(`SELECT ${BLOCK_COLUMNS} FROM blocks WHERE profile_id = ? AND block_id = ?`, [
    profileId,
    blockId,
  ]);
  return row ? toBlock(db, row) : null;
}

export interface BlockInput {
  slot: BlockSlot;
  profileVersion: number;
  status: BlockRecord["status"];
  origin: BlockRecord["origin"];
  purchased: boolean;
  heading: string;
  paragraphs: string[];
  highlight: string | null;
}

/** Создаёт блок, если его ещё нет. Существующий не переписывается. */
export function ensureBlock(db: Db, profileId: string, input: BlockInput): BlockRecord {
  const existing = db.get<BlockRow>(`SELECT ${BLOCK_COLUMNS} FROM blocks WHERE profile_id = ? AND slot = ?`, [
    profileId,
    input.slot,
  ]);
  if (existing) return toBlock(db, existing);

  const timestamp = now();
  const blockId = newRecordId();
  const heading = seal(db.keys, input.heading);
  const body = seal(db.keys, JSON.stringify({ paragraphs: input.paragraphs, highlight: input.highlight } satisfies BlockBody));

  db.run(
    `INSERT INTO blocks
       (block_id, profile_id, slot, profile_version, status, origin, purchased, stale,
        heading_payload, heading_enc, body_payload, body_enc, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      blockId,
      profileId,
      input.slot,
      input.profileVersion,
      input.status,
      input.origin,
      input.purchased ? 1 : 0,
      heading.payload,
      heading.enc,
      body.payload,
      body.enc,
      timestamp,
      timestamp,
    ],
  );

  return {
    blockId,
    slot: input.slot,
    profileVersion: input.profileVersion,
    status: input.status,
    origin: input.origin,
    purchased: input.purchased,
    stale: false,
    heading: input.heading,
    paragraphs: input.paragraphs,
    highlight: input.highlight,
  };
}

/**
 * Записывает готовый текст блока. Тексты пишет LLM (E4) и покупка среза;
 * движок такие блоки не пересчитывает, поэтому они живут только здесь.
 */
export function saveBlockContent(
  db: Db,
  profileId: string,
  input: {
    slot: BlockSlot;
    profileVersion: number;
    purchased: boolean;
    heading: string;
    paragraphs: string[];
    highlight: string | null;
  },
): BlockRecord {
  ensureBlock(db, profileId, {
    slot: input.slot,
    profileVersion: input.profileVersion,
    status: "pending",
    origin: "llm",
    purchased: input.purchased,
    heading: input.heading,
    paragraphs: [],
    highlight: null,
  });

  const heading = seal(db.keys, input.heading);
  const body = seal(db.keys, JSON.stringify({ paragraphs: input.paragraphs, highlight: input.highlight } satisfies BlockBody));

  db.run(
    `UPDATE blocks SET status = 'ready', stale = 0, purchased = ?, profile_version = ?,
       heading_payload = ?, heading_enc = ?, body_payload = ?, body_enc = ?, updated_at = ?
     WHERE profile_id = ? AND slot = ?`,
    [
      input.purchased ? 1 : 0,
      input.profileVersion,
      heading.payload,
      heading.enc,
      body.payload,
      body.enc,
      now(),
      profileId,
      input.slot,
    ],
  );

  const saved = db.get<BlockRow>(`SELECT ${BLOCK_COLUMNS} FROM blocks WHERE profile_id = ? AND slot = ?`, [
    profileId,
    input.slot,
  ]);
  if (!saved) throw new Error(`block-not-saved:${input.slot}`);
  return toBlock(db, saved);
}

/** Убирает блок вместе с текстом. Используется при возврате: доступ отозван — текста нет. */
export function deleteBlock(db: Db, profileId: string, slot: BlockSlot): void {
  db.run("DELETE FROM blocks WHERE profile_id = ? AND slot = ?", [profileId, slot]);
}

/**
 * Правка ответов не переписывает купленные блоки: на них ставится отметка о
 * расхождении (`docs/11-ui-page-spec.md`, «Изменение ответа»).
 */
export function markBlocksStale(db: Db, profileId: string): void {
  db.run("UPDATE blocks SET stale = 1, updated_at = ? WHERE profile_id = ? AND status = 'ready'", [
    now(),
    profileId,
  ]);
}

// ── Заказы ────────────────────────────────────────────────────────────────────

export interface OrderRecord {
  orderId: string;
  profileId: string;
  slice: string;
  price: number;
  currency: string;
  status: OrderStatus;
  provider: string | null;
  providerRef: string | null;
  /** Режим провайдера, создавшего заказ. Тестовый заказ виден в базе навсегда. */
  mode: PaymentMode | null;
  createdAt: string;
}

interface OrderRow {
  order_id: string;
  profile_id: string;
  slice: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  provider: string | null;
  provider_ref: string | null;
  provider_mode: PaymentMode | null;
  created_at: string;
}

const ORDER_COLUMNS = `order_id, profile_id, slice, amount, currency, status,
  provider, provider_ref, provider_mode, created_at`;

const toOrder = (row: OrderRow): OrderRecord => ({
  orderId: row.order_id,
  profileId: row.profile_id,
  slice: row.slice,
  price: row.amount,
  currency: row.currency,
  status: row.status,
  provider: row.provider,
  providerRef: row.provider_ref,
  mode: row.provider_mode,
  createdAt: row.created_at,
});

export function listOrders(db: Db, profileId: string): OrderRecord[] {
  return db
    .all<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE profile_id = ? ORDER BY created_at`, [profileId])
    .map(toOrder);
}

export function findOrder(db: Db, profileId: string, orderId: string): OrderRecord | null {
  const row = db.get<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE profile_id = ? AND order_id = ?`, [
    profileId,
    orderId,
  ]);
  return row ? toOrder(row) : null;
}

/** Заказ по идентификатору без профиля: так его находит уведомление провайдера. */
export function findOrderById(db: Db, orderId: string): OrderRecord | null {
  const row = db.get<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE order_id = ?`, [orderId]);
  return row ? toOrder(row) : null;
}

export function findOrderByRequest(db: Db, profileId: string, requestId: string): OrderRecord | null {
  const row = db.get<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE profile_id = ? AND request_id = ?`, [
    profileId,
    requestId,
  ]);
  return row ? toOrder(row) : null;
}

/** Живой заказ на срез: 'created' или 'paid'. Он же — занятое место в уникальном индексе. */
export function findActiveOrderForSlice(db: Db, profileId: string, slice: string): OrderRecord | null {
  const row = db.get<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE profile_id = ? AND active_slice = ?`, [
    profileId,
    slice,
  ]);
  return row ? toOrder(row) : null;
}

/** Срезы, доступ к которым оплачен и не отозван. */
export const paidSlices = (db: Db, profileId: string): string[] =>
  listOrders(db, profileId)
    .filter((order) => order.status === "paid")
    .map((order) => order.slice);

export function insertOrder(
  db: Db,
  profileId: string,
  input: {
    slice: string;
    price: number;
    requestId: string;
    provider: string;
    providerRef: string;
    mode: PaymentMode;
  },
): OrderRecord {
  const timestamp = now();
  const orderId = newRecordId();
  db.run(
    `INSERT INTO orders
       (order_id, profile_id, slice, amount, currency, status, provider, provider_ref, provider_mode,
        active_slice, request_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'RUB', 'created', ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      profileId,
      input.slice,
      input.price,
      input.provider,
      input.providerRef,
      input.mode,
      input.slice,
      input.requestId,
      timestamp,
      timestamp,
    ],
  );

  return {
    orderId,
    profileId,
    slice: input.slice,
    price: input.price,
    currency: "RUB",
    status: "created",
    provider: input.provider,
    providerRef: input.providerRef,
    mode: input.mode,
    createdAt: timestamp,
  };
}

/**
 * Смена состояния заказа с проверкой перехода (E8-02). Недопустимый переход —
 * исключение, а не тихая запись. Каждый переход попадает в журнал заказа.
 *
 * Место среза в уникальном индексе освобождается ровно тогда, когда заказ
 * перестаёт быть живым: после отказа или возврата срез снова можно купить.
 */
export function transitionOrder(
  db: Db,
  order: OrderRecord,
  to: OrderStatus,
  reason: TransitionReason,
): OrderRecord {
  if (!canTransition(order.status, to)) throw new InvalidTransition(order.status, to);

  const timestamp = now();
  db.run(
    `UPDATE orders SET status = ?, updated_at = ?, active_slice = ?,
       paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
       refunded_at = CASE WHEN ? = 'refunded' THEN ? ELSE refunded_at END
     WHERE order_id = ?`,
    [to, timestamp, isActive(to) ? order.slice : null, to, timestamp, to, timestamp, order.orderId],
  );

  db.run(
    `INSERT INTO order_events (order_event_id, order_id, profile_id, from_status, to_status, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newRecordId(), order.orderId, order.profileId, order.status, to, reason, timestamp],
  );

  return { ...order, status: to };
}

export interface OrderEventRecord {
  from: OrderStatus;
  to: OrderStatus;
  reason: string;
  createdAt: string;
}

export function listOrderEvents(db: Db, orderId: string): OrderEventRecord[] {
  return db
    .all<{ from_status: OrderStatus; to_status: OrderStatus; reason: string; created_at: string }>(
      "SELECT from_status, to_status, reason, created_at FROM order_events WHERE order_id = ? ORDER BY created_at",
      [orderId],
    )
    .map((row) => ({ from: row.from_status, to: row.to_status, reason: row.reason, createdAt: row.created_at }));
}

// ── Уведомления провайдера ────────────────────────────────────────────────────

/**
 * Отмечает уведомление доставленным. Первичный ключ (provider, event_id) не даёт
 * записать его дважды: повторная доставка падает на вставке, и вызывающий
 * разбирает это как повтор — доступ второй раз не выдаётся.
 */
export function insertDelivery(
  db: Db,
  input: { provider: string; eventId: string; kind: string; orderId: string | null; result: string },
): void {
  db.run(
    `INSERT INTO webhook_deliveries (provider, event_id, kind, order_id, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.provider, input.eventId, input.kind, input.orderId, input.result, now()],
  );
}

export function findDelivery(db: Db, provider: string, eventId: string): { result: string } | null {
  return db.get<{ result: string }>(
    "SELECT result FROM webhook_deliveries WHERE provider = ? AND event_id = ?",
    [provider, eventId],
  );
}

export const countDeliveries = (db: Db): number =>
  db.get<{ total: number }>("SELECT COUNT(*) AS total FROM webhook_deliveries")?.total ?? 0;

// ── Несогласия ────────────────────────────────────────────────────────────────

export interface DisagreementRecord {
  disagreementId: string;
  slot: BlockSlot;
  kind: DisagreementKind;
}

export function listDisagreements(db: Db, profileId: string): DisagreementRecord[] {
  return db
    .all<{ disagreement_id: string; slot: BlockSlot; kind: DisagreementKind }>(
      "SELECT disagreement_id, slot, kind FROM disagreements WHERE profile_id = ? ORDER BY created_at",
      [profileId],
    )
    .map((row) => ({ disagreementId: row.disagreement_id, slot: row.slot, kind: row.kind }));
}

export function insertDisagreement(
  db: Db,
  profileId: string,
  input: { slot: BlockSlot; blockId: string | null; kind: DisagreementKind },
): DisagreementRecord {
  const disagreementId = newRecordId();
  db.run(
    `INSERT INTO disagreements (disagreement_id, profile_id, slot, block_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [disagreementId, profileId, input.slot, input.blockId, input.kind, now()],
  );
  return { disagreementId, slot: input.slot, kind: input.kind };
}

// ── События ───────────────────────────────────────────────────────────────────

/**
 * Событие воронки. Таблица `events` — тот же журнал, только в базе, поэтому
 * `payload` проходит ту же чистку, что и строки вывода (E9-04): наружу
 * попадают машинные коды и идентификаторы, человеческий текст скрывается.
 */
export function recordEvent(
  db: Db,
  type: string,
  input: { profileId?: string | null; payload?: Record<string, unknown> } = {},
): void {
  db.run("INSERT INTO events (event_id, profile_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)", [
    newRecordId(),
    input.profileId ?? null,
    type,
    JSON.stringify(scrub(input.payload ?? {})),
    now(),
  ]);
}

export function listEvents(db: Db, profileId: string): { type: string; payload: string }[] {
  return db.all<{ type: string; payload: string }>(
    "SELECT type, payload FROM events WHERE profile_id = ? ORDER BY created_at",
    [profileId],
  );
}

// ── Генерация: очередь, журнал вызовов, кэш (E4-03, E4-10, E4-11) ─────────────

/**
 * Отказ уникального индекса. Сообщение у SQLite своё, у других баз — другое;
 * ловим оба семейства, чтобы переезд порта не заставил переписывать очередь.
 */
export function isUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|unique constraint|duplicate key/i.test(message);
}

export type GenerationFailureCode =
  | "provider"
  | "timeout"
  | "cost_limit"
  | "validation"
  | "hijack"
  | "output"
  | "storyline"
  | "superseded"
  | "crisis"
  | "threshold";

export type CallOutcome = "ok" | "temporary" | "permanent" | "timeout" | "cached";

/** Готовый результат задания: текст блока и сюжет координаты 15, если он есть. */
export interface GenerationResultBody {
  heading: string;
  paragraphs: string[];
  highlight: string | null;
  storyline?: { value: string; code: string; confidence: "low" | "medium" | "high" };
}

export interface GenerationJobRecord {
  generationId: string;
  profileId: string;
  slot: BlockSlot;
  status: GenerationStatus;
  inputHash: string;
  contentVersion: string;
  regenerated: boolean;
  requestId: string | null;
  result: GenerationResultBody | null;
  failureCode: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobRow {
  generation_id: string;
  profile_id: string;
  slot: BlockSlot;
  status: GenerationStatus;
  input_hash: string;
  content_version: string;
  regenerated: number;
  request_id: string | null;
  result_payload: string | null;
  result_enc: string;
  failure_code: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

const JOB_COLUMNS = `generation_id, profile_id, slot, status, input_hash, content_version,
  regenerated, request_id, result_payload, result_enc, failure_code, attempt_count,
  next_attempt_at, created_at, updated_at`;

const toJob = (db: Db, row: JobRow): GenerationJobRecord => {
  const result =
    row.result_payload === null
      ? null
      : (JSON.parse(unseal(db.keys, { payload: row.result_payload, enc: row.result_enc })) as GenerationResultBody);
  return {
    generationId: row.generation_id,
    profileId: row.profile_id,
    slot: row.slot,
    status: row.status,
    inputHash: row.input_hash,
    contentVersion: row.content_version,
    regenerated: row.regenerated === 1,
    requestId: row.request_id,
    result,
    failureCode: row.failure_code,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export function findJob(db: Db, profileId: string, generationId: string): GenerationJobRecord | null {
  const row = db.get<JobRow>(`SELECT ${JOB_COLUMNS} FROM generation_jobs WHERE profile_id = ? AND generation_id = ?`, [
    profileId,
    generationId,
  ]);
  return row ? toJob(db, row) : null;
}

/** Задание по идентификатору без профиля: так его находит воркер очереди. */
export function findJobById(db: Db, generationId: string): GenerationJobRecord | null {
  const row = db.get<JobRow>(`SELECT ${JOB_COLUMNS} FROM generation_jobs WHERE generation_id = ?`, [generationId]);
  return row ? toJob(db, row) : null;
}

/** Живое задание слота: оно же занимает место в уникальном индексе. */
export function findActiveJob(db: Db, profileId: string, slot: BlockSlot): GenerationJobRecord | null {
  const row = db.get<JobRow>(`SELECT ${JOB_COLUMNS} FROM generation_jobs WHERE profile_id = ? AND active_slot = ?`, [
    profileId,
    slot,
  ]);
  return row ? toJob(db, row) : null;
}

export function findJobByRequest(db: Db, profileId: string, requestId: string): GenerationJobRecord | null {
  const row = db.get<JobRow>(`SELECT ${JOB_COLUMNS} FROM generation_jobs WHERE profile_id = ? AND request_id = ?`, [
    profileId,
    requestId,
  ]);
  return row ? toJob(db, row) : null;
}

/** Последнее задание слота: страница показывает его статус. */
export function findLatestJob(db: Db, profileId: string, slot: BlockSlot): GenerationJobRecord | null {
  const row = db.get<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM generation_jobs
      WHERE profile_id = ? AND slot = ? ORDER BY created_at DESC`,
    [profileId, slot],
  );
  return row ? toJob(db, row) : null;
}

export function listJobs(db: Db, profileId: string): GenerationJobRecord[] {
  return db
    .all<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM generation_jobs WHERE profile_id = ? ORDER BY created_at`,
      [profileId],
    )
    .map((row) => toJob(db, row));
}

export const countJobs = (db: Db, profileId?: string): number => {
  if (!profileId) return db.get<{ total: number }>("SELECT COUNT(*) AS total FROM generation_jobs")?.total ?? 0;
  return (
    db.get<{ total: number }>("SELECT COUNT(*) AS total FROM generation_jobs WHERE profile_id = ?", [profileId])
      ?.total ?? 0
  );
};

/**
 * Ставит задание в очередь. При гонке двух одновременных постановок вторую
 * отбивает уникальный индекс, а не проверка в коде: вызывающий получает
 * уже существующее живое задание.
 */
export function insertJob(
  db: Db,
  profileId: string,
  input: {
    slot: BlockSlot;
    inputHash: string;
    contentVersion: string;
    regenerated: boolean;
    requestId: string | null;
  },
): { job: GenerationJobRecord; created: boolean } {
  const timestamp = now();
  const generationId = newRecordId();

  try {
    db.run(
      `INSERT INTO generation_jobs
         (generation_id, profile_id, slot, status, active_slot, input_hash, content_version,
          regenerated, request_id, result_payload, result_enc, failure_code, attempt_count,
          next_attempt_at, created_at, updated_at, started_at, finished_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL, ?, NULL, 0, NULL, ?, ?, NULL, NULL)`,
      [
        generationId,
        profileId,
        input.slot,
        input.slot,
        input.inputHash,
        input.contentVersion,
        input.regenerated ? 1 : 0,
        input.requestId,
        PLAINTEXT,
        timestamp,
        timestamp,
      ],
    );
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const raced =
      (input.requestId ? findJobByRequest(db, profileId, input.requestId) : null) ??
      findActiveJob(db, profileId, input.slot);
    if (!raced) throw error;
    return { job: raced, created: false };
  }

  const saved = findJob(db, profileId, generationId);
  if (!saved) throw new Error(`job-not-saved:${generationId}`);
  return { job: saved, created: true };
}

/** Снимает живое задание со слота: место в уникальном индексе освобождается. */
export function releaseActiveJob(db: Db, profileId: string, slot: BlockSlot, failure: GenerationFailureCode): void {
  const timestamp = now();
  db.run(
    `UPDATE generation_jobs
        SET active_slot = NULL,
            status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END,
            failure_code = CASE WHEN status = 'pending' THEN ? ELSE failure_code END,
            finished_at = CASE WHEN status = 'pending' THEN ? ELSE finished_at END,
            updated_at = ?
      WHERE profile_id = ? AND active_slot = ?`,
    [failure, timestamp, timestamp, profileId, slot],
  );
}

export function saveJobResult(
  db: Db,
  job: GenerationJobRecord,
  result: GenerationResultBody,
): GenerationJobRecord {
  const timestamp = now();
  const stored = seal(db.keys, JSON.stringify(result));
  db.run(
    `UPDATE generation_jobs
        SET status = 'ready', active_slot = NULL, result_payload = ?, result_enc = ?,
            failure_code = NULL, finished_at = ?, updated_at = ?
      WHERE generation_id = ?`,
    [stored.payload, stored.enc, timestamp, timestamp, job.generationId],
  );
  const saved = findJob(db, job.profileId, job.generationId);
  if (!saved) throw new Error(`job-not-saved:${job.generationId}`);
  return saved;
}

export function failJob(
  db: Db,
  job: GenerationJobRecord,
  failure: GenerationFailureCode,
): GenerationJobRecord {
  const timestamp = now();
  db.run(
    `UPDATE generation_jobs
        SET status = 'failed', active_slot = NULL, failure_code = ?, finished_at = ?, updated_at = ?
      WHERE generation_id = ?`,
    [failure, timestamp, timestamp, job.generationId],
  );
  const saved = findJob(db, job.profileId, job.generationId);
  if (!saved) throw new Error(`job-not-saved:${job.generationId}`);
  return saved;
}

/**
 * Временный отказ провайдера: задание остаётся живым, чтобы доиграться после
 * восстановления, и не занимает второе место в уникальном индексе.
 */
export function deferJob(
  db: Db,
  job: GenerationJobRecord,
  nextAttemptAt: string,
): GenerationJobRecord {
  const timestamp = now();
  db.run(
    `UPDATE generation_jobs
        SET attempt_count = attempt_count + 1, next_attempt_at = ?,
            failure_code = 'provider', updated_at = ?
      WHERE generation_id = ?`,
    [nextAttemptAt, timestamp, job.generationId],
  );
  const saved = findJob(db, job.profileId, job.generationId);
  if (!saved) throw new Error(`job-not-saved:${job.generationId}`);
  return saved;
}

export function markJobStarted(db: Db, job: GenerationJobRecord): void {
  const timestamp = now();
  db.run(
    `UPDATE generation_jobs
        SET started_at = COALESCE(started_at, ?), next_attempt_at = NULL, updated_at = ?
      WHERE generation_id = ?`,
    [timestamp, timestamp, job.generationId],
  );
}

/** Задания, которые пора доигрывать: живые и без отложенной попытки в будущем. */
export function listDueJobs(db: Db, nowIso: string = now()): GenerationJobRecord[] {
  return db
    .all<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM generation_jobs
        WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at`,
      [nowIso],
    )
    .map((row) => toJob(db, row));
}

export interface GenerationCallRecord {
  callId: string;
  generationId: string | null;
  profileId: string;
  provider: string;
  model: string;
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  costKopecks: number;
  durationMs: number;
  outcome: CallOutcome;
  createdAt: string;
}

export function insertCall(
  db: Db,
  input: {
    generationId: string | null;
    profileId: string;
    provider: string;
    model: string;
    attempt: number;
    inputTokens: number;
    outputTokens: number;
    costKopecks: number;
    durationMs: number;
    outcome: CallOutcome;
  },
): GenerationCallRecord {
  const timestamp = now();
  const callId = newRecordId();
  db.run(
    `INSERT INTO generation_calls
       (call_id, generation_id, profile_id, provider, model, attempt,
        input_tokens, output_tokens, cost_kopecks, duration_ms, outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      callId,
      input.generationId,
      input.profileId,
      input.provider,
      input.model,
      input.attempt,
      input.inputTokens,
      input.outputTokens,
      input.costKopecks,
      input.durationMs,
      input.outcome,
      timestamp,
    ],
  );
  return { callId, ...input, createdAt: timestamp };
}

export function listCalls(db: Db, profileId: string): GenerationCallRecord[] {
  return db
    .all<{
      call_id: string;
      generation_id: string | null;
      profile_id: string;
      provider: string;
      model: string;
      attempt: number;
      input_tokens: number;
      output_tokens: number;
      cost_kopecks: number;
      duration_ms: number;
      outcome: CallOutcome;
      created_at: string;
    }>(
      `SELECT call_id, generation_id, profile_id, provider, model, attempt,
              input_tokens, output_tokens, cost_kopecks, duration_ms, outcome, created_at
         FROM generation_calls WHERE profile_id = ? ORDER BY created_at`,
      [profileId],
    )
    .map((row) => ({
      callId: row.call_id,
      generationId: row.generation_id,
      profileId: row.profile_id,
      provider: row.provider,
      model: row.model,
      attempt: row.attempt,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costKopecks: row.cost_kopecks,
      durationMs: row.duration_ms,
      outcome: row.outcome,
      createdAt: row.created_at,
    }));
}

/** Фактически потраченное на профиль: сумма журнала вызовов, не оценка. */
export function profileCostKopecks(db: Db, profileId: string): number {
  return (
    db.get<{ total: number | null }>(
      "SELECT SUM(cost_kopecks) AS total FROM generation_calls WHERE profile_id = ?",
      [profileId],
    )?.total ?? 0
  );
}

export function findCache(db: Db, profileId: string, inputHash: string): GenerationResultBody | null {
  const row = db.get<{ result_payload: string; result_enc: string }>(
    "SELECT result_payload, result_enc FROM generation_cache WHERE profile_id = ? AND input_hash = ?",
    [profileId, inputHash],
  );
  if (!row) return null;
  return JSON.parse(unseal(db.keys, { payload: row.result_payload, enc: row.result_enc })) as GenerationResultBody;
}

export function saveCache(
  db: Db,
  profileId: string,
  input: { inputHash: string; contentVersion: string; result: GenerationResultBody },
): void {
  const stored = seal(db.keys, JSON.stringify(input.result));
  db.run(
    `INSERT INTO generation_cache (profile_id, input_hash, content_version, result_payload, result_enc, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, input_hash) DO UPDATE SET
       content_version = excluded.content_version,
       result_payload  = excluded.result_payload,
       result_enc      = excluded.result_enc,
       created_at      = excluded.created_at`,
    [profileId, input.inputHash, input.contentVersion, stored.payload, stored.enc, now()],
  );
}
