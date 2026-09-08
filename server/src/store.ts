/**
 * Хранение. Единственный модуль, который знает SQL; выше него ходят только
 * записи, описанные здесь.
 *
 * Правил продукта тут нет: скоринг, узлы, блоки, карту и офферы считает движок.
 * Хранятся ответы, снимки профиля, тексты, которые пересчитать нельзя, заказы,
 * несогласия и события.
 */

import type { BlockSlot, DisagreementKind, OrderStatus, PortionKey, QuestionKind } from "./contract/index.js";
import type { Db } from "./db/driver.js";
import { seal, unseal, unsealOptional, PLAINTEXT } from "./db/stored-text.js";
import { newRecordId } from "./ids.js";
import { scrub } from "./log.js";

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

export function findProfile(db: Db, profileId: string): ProfileRecord | null {
  const row = db.get<ProfileRow>(
    `SELECT profile_id, name_payload, name_enc, birth_date_payload, birth_date_enc, version, created_at, updated_at
       FROM profiles WHERE profile_id = ?`,
    [profileId],
  );
  return row ? toProfile(db, row) : null;
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
  slice: string;
  price: number;
  currency: string;
  status: OrderStatus;
}

interface OrderRow {
  order_id: string;
  slice: string;
  amount: number;
  currency: string;
  status: OrderStatus;
}

const toOrder = (row: OrderRow): OrderRecord => ({
  orderId: row.order_id,
  slice: row.slice,
  price: row.amount,
  currency: row.currency,
  status: row.status,
});

export function listOrders(db: Db, profileId: string): OrderRecord[] {
  return db
    .all<OrderRow>(
      "SELECT order_id, slice, amount, currency, status FROM orders WHERE profile_id = ? ORDER BY created_at",
      [profileId],
    )
    .map(toOrder);
}

export function findOrderByRequest(db: Db, profileId: string, requestId: string): OrderRecord | null {
  const row = db.get<OrderRow>(
    "SELECT order_id, slice, amount, currency, status FROM orders WHERE profile_id = ? AND request_id = ?",
    [profileId, requestId],
  );
  return row ? toOrder(row) : null;
}

export function insertOrder(
  db: Db,
  profileId: string,
  input: { slice: string; price: number; requestId: string },
): OrderRecord {
  const timestamp = now();
  const orderId = newRecordId();
  db.run(
    `INSERT INTO orders (order_id, profile_id, slice, amount, currency, status, request_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'RUB', 'created', ?, ?, ?)`,
    [orderId, profileId, input.slice, input.price, input.requestId, timestamp, timestamp],
  );
  return { orderId, slice: input.slice, price: input.price, currency: "RUB", status: "created" };
}

/** Смена состояния заказа. Полный набор переходов с проверками — задача E8-02. */
export function updateOrderStatus(db: Db, profileId: string, orderId: string, status: OrderStatus): void {
  db.run("UPDATE orders SET status = ?, updated_at = ? WHERE profile_id = ? AND order_id = ?", [
    status,
    now(),
    profileId,
    orderId,
  ]);
}

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
