/**
 * Контракт API личной страницы. Единственное описание эндпоинтов: сервер
 * реализует его, клиент (E6/E7) импортирует те же типы. Расхождение ломает сборку.
 *
 * Читать этот файл достаточно, чтобы написать клиент: код сервера знать не нужно.
 *
 * Правила контракта:
 *
 * 1. Наружу уходят только блоки, полосы карты, двери, предложение и следующая
 *    порция вопросов. Значения координат, `confidence`, машинные коды и имена
 *    координат остаются на сервере — это проверяет `Wire<>` из `./wire.js`.
 * 2. Продуктовых текстов в контракте нет: все строки, которые видит человек,
 *    приходят из `content/*.md` через движок. Коды ошибок и состояний — машинные.
 * 3. Идентификатор профиля неперебираем и служит адресом страницы `/p/{profileId}`.
 */

import type { AssertClean, AssertViewable, PrivateSlot, Viewable, Wire } from "./wire.js";

// ── Общие формы ───────────────────────────────────────────────────────────────

/** Состояние страницы из `docs/11-ui-page-spec.md`, раздел «Состояния страницы». */
export type PageStateName = "s0" | "s1" | "s2" | "s3" | "s4" | "paid_pending" | "paid_done";

/**
 * Место блока на странице и одновременно его идентификатор для клиента:
 * четыре блока бесплатной лестницы и по блоку на купленный срез.
 */
export type BlockSlot = "step1" | "step2" | "step3" | "step4" | `slice:${string}`;

/**
 * Блоки, которые видит посторонний по публичной ссылке. Узел (3), сюжет (4) и
 * купленные срезы сюда не входят и по API публичного вида не отдаются вообще.
 */
export type PublicSlot = Exclude<BlockSlot, PrivateSlot>;

/**
 * Тип вопроса. Совпадает с типами из `content/questions-ladder.md` и
 * `content/slices/*.md`. Четвёртый — `число` — встречается только в доборах:
 * вопрос спрашивает сразу две величины («сколько начал и сколько довёл»).
 */
export type QuestionKind = "выбор" | "шкала" | "открытый" | "число";

/** Порция вопросов: ступень бесплатной лестницы или добор платного среза. */
export type PortionKey = `step:${1 | 2 | 3 | 4}` | `slice:${string}`;

/** Статус асинхронной генерации текста (ступень 4 и платные срезы). */
export type GenerationStatus = "pending" | "ready" | "failed";

/** Состояние заказа. Переходы описывает E8-02. */
export type OrderStatus = "created" | "paid" | "failed" | "refunded";

/** Варианты несогласия из `docs/11-ui-page-spec.md`: несогласие — это данные. */
export type DisagreementKind = "not_about_me" | "partly" | "too_general";

// ── Данные страницы ───────────────────────────────────────────────────────────

/** Карточка входа: имя и тема периода. Дата рождения в выводах не участвует. */
export interface CardDto {
  name: string;
  /** Сезон берётся по текущей дате, а не по дате рождения. */
  season: string | null;
  theme: string | null;
  metaphor: string | null;
  cta: string;
}

/**
 * Полоса визуальной карты. Номера координаты в ней нет: клиент опознаёт полосу
 * по непрозрачному `id`, а рисует по `position` и `fill`.
 */
export interface MapBarDto {
  /** Устойчивый ключ полосы, например `tempo`. Номером координаты не является. */
  id: string;
  label: string;
  poles: { low: string; high: string } | null;
  /** Пустая, предположительная или точная — три вида полосы. */
  fill: "empty" | "approximate" | "precise";
  /** Позиция маркера 0..1; null — полоса закрыта. */
  position: number | null;
  /** Категориальная полоса «Что задевает»: список вариантов и выбранный. */
  category: { options: string[]; selected: string | null } | null;
  hint: string;
}

/** Блок разбора на странице. */
export interface BlockDto {
  id: BlockSlot;
  heading: string;
  paragraphs: string[];
  /** Фраза-сшивка: визуально сильнее остальных абзацев. */
  highlight: string | null;
  /** Текст ещё пишется; следить за ним через эндпоинт статуса генерации. */
  generation: { id: string; status: GenerationStatus } | null;
  /** Человек отметил несогласие с блоком. */
  disagreed: boolean;
  /** Блок получен за деньги: при правке ответов не переписывается. */
  purchased: boolean;
  /** Ответы изменились после сборки блока — на нём отметка о расхождении. */
  stale: boolean;
}

/** Дверь маршрута. Цена приходит только у предложенной двери. */
export interface DoorDto {
  id: string;
  title: string;
  state: "opens_with_answers" | "paid" | "open";
  price: number | null;
  slice: string | null;
}

/** Одно платное предложение. На экране оплаты их не бывает двух. */
export interface OfferDto {
  slice: string;
  title: string;
  price: number;
  promise: string;
  /** Число вопросов добора строкой: в контенте оно бывает диапазоном. */
  questionCount: string;
}

export interface QuestionDto {
  id: string;
  kind: QuestionKind;
  text: string;
  options: { key: string; text: string }[];
  scale: { low: string; high: string } | null;
}

export interface PortionDto {
  key: PortionKey;
  /** Подводка к порции: обещание конкретного результата. */
  lead: string;
  questions: QuestionDto[];
  /**
   * Вопросы этой порции, ответы на которые уже сохранены. Обычно пусто:
   * клиент отправляет порцию целиком, а черновик держит у себя. Непустым
   * бывает после обрыва связи посреди порции — тогда человек продолжает с
   * первого неотвеченного вопроса, а не начинает заново.
   */
  answered: string[];
}

/** Публичная ссылка на страницу. Появляется только после «Поделиться». */
export interface ShareDto {
  /** Адрес публичного вида. Токен в нём не совпадает с идентификатором профиля. */
  url: string;
  createdAt: string;
}

/** Полное состояние личной страницы. Всё, что клиенту разрешено знать. */
export interface PageStateDto {
  profileId: string;
  /** Постоянная ссылка на страницу. */
  url: string;
  state: PageStateName;
  card: CardDto;
  hook: string | null;
  map: MapBarDto[];
  blocks: BlockDto[];
  doors: DoorDto[];
  offer: OfferDto | null;
  /** Порция, на которой человек остановился. null — свободных вопросов нет. */
  nextPortion: PortionDto | null;
  /** Публичная ссылка, если человек нажал «Поделиться». null — страница закрыта. */
  share: ShareDto | null;
  updatedAt: string;
}

/**
 * Что видит посторонний по публичной ссылке: карта, одна фраза и первые два
 * блока. Узел, сюжет и купленные срезы сюда не попадают — не «не рисуются», а
 * отсутствуют в типе, поэтому положить их в этот ответ нельзя.
 *
 * Ни идентификатора профиля, ни адреса личной страницы здесь нет: публичная
 * ссылка не должна давать доступ к личной.
 */
export interface PublicPageDto {
  state: PageStateName;
  /** Только имя: тема периода и дата рождения посторонним не показываются. */
  name: string;
  hook: string | null;
  map: MapBarDto[];
  blocks: PublicBlockDto[];
}

/** Блок в публичном виде: без отметок владельца и без статуса генерации. */
export interface PublicBlockDto {
  id: PublicSlot;
  heading: string;
  paragraphs: string[];
  highlight: string | null;
}

export interface OrderDto {
  orderId: string;
  slice: string;
  price: number;
  currency: string;
  status: OrderStatus;
  /**
   * Куда вести на оплату и кто её проводит. `mode` — `test` у поддельного
   * провайдера: клиент обязан показать, что деньги не настоящие.
   */
  payment: { provider: string; mode: "test" | "live"; url: string } | null;
}

/**
 * Выгрузка данных человека (E9-03): то, что он дал, и то, что ему показали.
 * Внутреннего профиля здесь нет — координаты не отдаются даже владельцу
 * страницы, иначе выгрузка становится обходом всей стены типов.
 */
export interface ExportDto {
  profileId: string;
  /** Когда собрана выгрузка. */
  exportedAt: string;
  person: { name: string; birthDate: string | null };
  answers: ExportAnswerDto[];
  blocks: BlockDto[];
  orders: OrderDto[];
  disagreements: DisagreementDto[];
  share: ShareDto | null;
}

/** Ответ в выгрузке: вопрос и ответ словами, а не идентификаторами вариантов. */
export interface ExportAnswerDto {
  questionId: string;
  portion: PortionKey;
  question: string;
  answer: string;
}

// ── Запросы ───────────────────────────────────────────────────────────────────

/** Ступень 0. Собираются только имя и дата рождения. */
export interface CreateProfileRequest {
  name: string;
  /** ISO-дата или null. Без даты — без карточки периода. */
  birthDate: string | null;
}

/** Один ответ. Форма зависит от типа вопроса, поэтому это размеченное объединение. */
export type AnswerInput =
  | { questionId: string; kind: "выбор"; option: string }
  | { questionId: string; kind: "шкала"; scale: 1 | 2 | 3 | 4 | 5 }
  | { questionId: string; kind: "открытый"; text: string }
  /** Одна величина или две, если вопрос спрашивает обе сразу. */
  | { questionId: string; kind: "число"; numbers: number[] };

export interface SubmitPortionRequest {
  portion: PortionKey;
  answers: AnswerInput[];
  /**
   * Ключ отправки: одна и та же порция при повторе даёт один набор ответов.
   * Защиту от дублей по этому ключу реализует E3-05.
   */
  requestId: string;
}

export interface EditAnswerRequest {
  answer: AnswerInput;
}

export interface DisagreementRequest {
  blockId: BlockSlot;
  kind: DisagreementKind;
}

export interface PurchaseRequest {
  slice: string;
  requestId: string;
}

/** Ручная регенерация блока. Ключ отправки ловит повтор того же нажатия. */
export interface RegenerateRequest {
  requestId: string;
}

// ── Ответы ────────────────────────────────────────────────────────────────────

/**
 * Здоровье сервиса и то, что сейчас развёрнуто (E10-03).
 *
 * Персональных данных здесь нет ни одного поля: версия сборки, коммит, время
 * сборки, окружение, состояние базы и номер миграции. По этому ответу видно,
 * что откат состоялся, и внешняя проверка доступности читает его же.
 */
export interface HealthDto {
  status: "ok";
  /** Версия сборки: тег выпуска, а без него — версия из `package.json`. */
  version: string;
  /** Коммит и время сборки. `unknown` — собрано не конвейером. */
  build: { commit: string; builtAt: string | null };
  /** Окружение: `development`, `staging` или `production`. */
  environment: string;
  uptimeMs: number;
  database: "ok" | "unavailable";
  /** Номер последней применённой миграции; null — база пуста. */
  schemaVersion: string | null;
}

export interface GenerationDto {
  id: string;
  blockId: BlockSlot;
  status: GenerationStatus;
  /** Ручная регенерация: этот прогон обошёл кэш и помечен. */
  regenerated: boolean;
}

export interface DisagreementDto {
  disagreementId: string;
  blockId: BlockSlot;
  kind: DisagreementKind;
}

/**
 * Машинный код отказа. Текст для человека клиент берёт из контента:
 * русских продуктовых строк в API нет.
 */
export type ErrorCode =
  | "bad_request"
  | "profile_not_found"
  | "not_found"
  | "method_not_allowed"
  | "unknown_question"
  | "unknown_slice"
  | "payload_too_large"
  | "rate_limited"
  /** Блок закрыт: оплаченного заказа на этот срез нет либо доступ отозван. */
  | "payment_required"
  /** Срез уже куплен или оплата по нему идёт: второй заказ не создаётся. */
  | "slice_already_ordered"
  /** Заказ не может перейти в запрошенное состояние. */
  | "invalid_transition"
  /** Подпись уведомления не сошлась. */
  | "invalid_signature"
  /** Возврат по этому заказу автоматически не проводится. */
  | "refund_unavailable"
  | "internal_error";

export interface ErrorDto {
  error: { code: ErrorCode };
}

// Формы, которые действительно уходят на клиент. `Wire<>` пропускает только
// типы без координат: любое запрещённое поле превращает их в тип, которому
// нельзя присвоить объект, и обработчик перестаёт компилироваться.
export type HealthResponse = Wire<HealthDto>;
export type PageStateResponse = Wire<PageStateDto>;
export type OrderResponse = Wire<{ order: OrderDto; page: PageStateDto }>;
export type GenerationResponse = Wire<{ generation: GenerationDto }>;
export type DisagreementResponse = Wire<{ disagreement: DisagreementDto; page: PageStateDto }>;
export type ShareResponse = Wire<{ share: ShareDto | null; page: PageStateDto }>;
export type BlockResponse = Wire<{ block: BlockDto }>;
export type ExportResponse = Wire<ExportDto>;
export type DeleteResponse = Wire<{ deleted: true }>;
/** Ответ на уведомление провайдера. Провайдеру уходит только машинный исход. */
export type WebhookResponse = Wire<{ received: true; result: "applied" | "duplicate" | "ignored" }>;

/** Публичный вид проходит обе стены: без координат и без закрытых блоков. */
export type PublicPageResponse = Viewable<Wire<PublicPageDto>>;

// Проверка на этапе сборки: DTO чисты. Строка перестаёт компилироваться,
// как только в любой из форм появится поле координаты.
const contractIsCoordinateFree: [
  AssertClean<HealthDto>,
  AssertClean<PageStateDto>,
  AssertClean<PublicPageDto>,
  AssertClean<{ order: OrderDto; page: PageStateDto }>,
  AssertClean<{ generation: GenerationDto }>,
  AssertClean<{ disagreement: DisagreementDto; page: PageStateDto }>,
  AssertClean<{ share: ShareDto | null; page: PageStateDto }>,
  AssertClean<ExportDto>,
  AssertClean<{ block: BlockDto }>,
] = [true, true, true, true, true, true, true, true, true];
void contractIsCoordinateFree;

// То же для публичного вида: ни одно поле не способно принести блок 3, 4 или срез.
const publicViewHasNoPrivateBlocks: AssertViewable<PublicPageDto> = true;
void publicViewHasNoPrivateBlocks;

// ── Реестр эндпоинтов ─────────────────────────────────────────────────────────

/**
 * Полный список эндпоинтов. Ключ — имя операции, значение — метод, шаблон пути,
 * параметры пути, тело запроса (`null` — тела нет) и форма ответа.
 */
export interface ApiEndpoints {
  /** Здоровье сервиса. */
  health: {
    method: "GET";
    path: "/api/health";
    params: Record<never, never>;
    body: null;
    response: HealthResponse;
  };
  /** Ступень 0: профиль создаётся здесь, регистрация не требуется. */
  createProfile: {
    method: "POST";
    path: "/api/profiles";
    params: Record<never, never>;
    body: CreateProfileRequest;
    response: PageStateResponse;
  };
  /** Состояние страницы по постоянной ссылке. */
  pageState: {
    method: "GET";
    path: "/api/p/:profileId";
    params: { profileId: string };
    body: null;
    response: PageStateResponse;
  };
  /** Отправка порции ответов. */
  submitPortion: {
    method: "POST";
    path: "/api/p/:profileId/portions";
    params: { profileId: string };
    body: SubmitPortionRequest;
    response: PageStateResponse;
  };
  /** Правка одного ответа: профиль пересчитывается, блоки переписываются. */
  editAnswer: {
    method: "PATCH";
    path: "/api/p/:profileId/answers/:questionId";
    params: { profileId: string; questionId: string };
    body: EditAnswerRequest;
    response: PageStateResponse;
  };
  /** Несогласие с блоком. Это данные, а не жалоба. */
  disagree: {
    method: "POST";
    path: "/api/p/:profileId/disagreements";
    params: { profileId: string };
    body: DisagreementRequest;
    response: DisagreementResponse;
  };
  /**
   * Покупка среза: заводит заказ и платёж у провайдера. Второй заказ на тот же
   * срез не создаётся, пока первый жив.
   */
  purchase: {
    method: "POST";
    path: "/api/p/:profileId/orders";
    params: { profileId: string };
    body: PurchaseRequest;
    response: OrderResponse;
  };
  /**
   * Возврат средств и отзыв доступа. Возврат полный, пока итоговый текст среза
   * не собран; после сборки автоматического возврата нет.
   */
  refund: {
    method: "POST";
    path: "/api/p/:profileId/orders/:orderId/refunds";
    params: { profileId: string; orderId: string };
    body: null;
    response: OrderResponse;
  };
  /**
   * Уведомление провайдера. Единственный вход, которым заказ становится
   * оплаченным: клиенту такой переход недоступен.
   */
  webhook: {
    method: "POST";
    path: "/api/payments/:provider/webhook";
    params: { provider: string };
    body: unknown;
    response: WebhookResponse;
  };
  /**
   * Текст одного блока. Для платного среза требует оплаченного заказа:
   * без него — отказ, а не пустой блок.
   */
  blockText: {
    method: "GET";
    path: "/api/p/:profileId/blocks/:slot";
    params: { profileId: string; slot: string };
    body: null;
    response: BlockResponse;
  };
  /** Выгрузка данных человека в читаемом виде. */
  exportProfile: {
    method: "GET";
    path: "/api/p/:profileId/export";
    params: { profileId: string };
    body: null;
    response: ExportResponse;
  };
  /** Удаление профиля со всеми ответами, блоками и заказами. Отменить нельзя. */
  deleteProfile: {
    method: "DELETE";
    path: "/api/p/:profileId";
    params: { profileId: string };
    body: null;
    response: DeleteResponse;
  };
  /** Статус генерации текста блока. */
  generationStatus: {
    method: "GET";
    path: "/api/p/:profileId/generations/:generationId";
    params: { profileId: string; generationId: string };
    body: null;
    response: GenerationResponse;
  };
  /**
   * Ручная регенерация финала лестницы: обходит кэш, помечает прогон.
   * Повтор с тем же ключом отправки возвращает то же задание.
   */
  regenerate: {
    method: "POST";
    path: "/api/p/:profileId/generations";
    params: { profileId: string };
    body: RegenerateRequest;
    response: GenerationResponse;
  };
  /** «Поделиться»: включает публичную ссылку. Повторный вызов отдаёт ту же. */
  share: {
    method: "POST";
    path: "/api/p/:profileId/share";
    params: { profileId: string };
    body: null;
    response: ShareResponse;
  };
  /** Отзыв публичной ссылки: старый адрес перестаёт работать. */
  revokeShare: {
    method: "DELETE";
    path: "/api/p/:profileId/share";
    params: { profileId: string };
    body: null;
    response: ShareResponse;
  };
  /**
   * Публичный вид по токену. До нажатия «Поделиться» токена не существует,
   * поэтому любая публичная ссылка отвечает отказом.
   */
  publicPage: {
    method: "GET";
    path: "/api/s/:token";
    params: { token: string };
    body: null;
    response: PublicPageResponse;
  };
}

export type OperationName = keyof ApiEndpoints;

/**
 * Тот же реестр в виде данных: по нему сервер строит маршрутизатор, а клиент —
 * адреса запросов. Тип берётся из `ApiEndpoints`, поэтому разойтись они не могут.
 */
export const API: {
  readonly [Name in OperationName]: {
    readonly method: ApiEndpoints[Name]["method"];
    readonly path: ApiEndpoints[Name]["path"];
  };
} = {
  health: { method: "GET", path: "/api/health" },
  createProfile: { method: "POST", path: "/api/profiles" },
  pageState: { method: "GET", path: "/api/p/:profileId" },
  submitPortion: { method: "POST", path: "/api/p/:profileId/portions" },
  editAnswer: { method: "PATCH", path: "/api/p/:profileId/answers/:questionId" },
  disagree: { method: "POST", path: "/api/p/:profileId/disagreements" },
  purchase: { method: "POST", path: "/api/p/:profileId/orders" },
  refund: { method: "POST", path: "/api/p/:profileId/orders/:orderId/refunds" },
  webhook: { method: "POST", path: "/api/payments/:provider/webhook" },
  blockText: { method: "GET", path: "/api/p/:profileId/blocks/:slot" },
  exportProfile: { method: "GET", path: "/api/p/:profileId/export" },
  deleteProfile: { method: "DELETE", path: "/api/p/:profileId" },
  generationStatus: { method: "GET", path: "/api/p/:profileId/generations/:generationId" },
  regenerate: { method: "POST", path: "/api/p/:profileId/generations" },
  share: { method: "POST", path: "/api/p/:profileId/share" },
  revokeShare: { method: "DELETE", path: "/api/p/:profileId/share" },
  publicPage: { method: "GET", path: "/api/s/:token" },
} as const;

/** Адрес личной страницы. Один шаблон и для сервера, и для клиента. */
export const PAGE_PATH = "/p/:profileId";

/** Адрес публичного вида. Токен не совпадает с идентификатором профиля. */
export const PUBLIC_PAGE_PATH = "/s/:token";

/** Подстановка параметров в шаблон пути: `/api/p/:profileId` → `/api/p/abc`. */
export function buildPath<Name extends OperationName>(
  name: Name,
  params: ApiEndpoints[Name]["params"],
): string {
  const values = params as Record<string, string>;
  return API[name].path.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`no-path-param:${key}`);
    return encodeURIComponent(value);
  });
}
