/**
 * Формы данных для текстов этапа E5: промежуточные блоки прикладных срезов,
 * подписи закрытых дверей, дисклеймеры внутри продукта.
 *
 * Отдельно от `content-types.ts` по той же причине, по которой сборщик пишет
 * второй файл: тексты E5 приходят партиями и не должны переписывать уже
 * собранное. См. engine/scripts/build-content.mjs, блок «Тексты этапа E5».
 */

/** Ось промежуточного блока: вопрос добора и полный набор его вариантов. */
export interface RawInterludeAxis {
  /** Идентификатор вопроса внутри среза: S4, S5. */
  id: string;
  keys: string[];
}

/** Промежуточный lookup-блок прикладного среза после первой порции. */
export interface RawSliceInterlude {
  slice: string;
  file: string;
  heading: string;
  /** Две оси матрицы в порядке колонок таблицы. */
  axes: RawInterludeAxis[];
  /**
   * Ключи вариантов так, как они перечислены в таблице вопросов порции.
   * Пусто, если строка вопроса ссылается на варианты другого вопроса.
   */
  questionKeys: { first: string[]; second: string[] };
  pairs: { first: string; second: string; text: string }[];
}

/**
 * Подписи закрытых дверей (content/doors.md).
 *
 * `nodes` — дверь собственного среза узла, подпись под профиль.
 * `applied` — узел × прикладной срез: тот же механизм в области жизни.
 * `slices` — общая подпись, когда тема двери человеку ещё не известна.
 *
 * `null` в `applied` означает «подпись берётся из `nodes`»: этот срез и есть
 * собственный срез узла, второй подписи у него быть не должно.
 */
export interface RawDoorLabels {
  nodes: Record<string, string>;
  slices: Record<string, string>;
  applied: Record<string, Record<string, string | null>>;
}

/** Дисклеймер продукта: текст и места показа внутри потока (content/legal/disclaimers.md). */
export interface RawDisclaimer {
  id: string;
  text: string;
  where: string[];
}

/** Степень запрета: см. `content/forbidden.md`, раздел «Как читать реестр». */
export type ForbiddenDegree = "жёсткий" | "по контексту" | "подозрение";

/** Область, в которой форма запрещена. */
export type ForbiddenScope = "разбор" | "вопросы" | "интерфейс" | "промпты";

/** Одна строка реестра: формы одного запрета, его исключения и обоснование. */
export interface RawForbiddenEntry {
  forms: string[];
  /** Точные разрешённые формулировки; `отрицание` — особое значение. */
  exceptions: string[];
  reason: string;
}

/** Группа реестра: общая степень и область для своих строк. */
export interface RawForbiddenGroup {
  id: string;
  title: string;
  degree: ForbiddenDegree;
  scopes: ForbiddenScope[];
  entries: RawForbiddenEntry[];
}

/** Реестр запрещённых формулировок (content/forbidden.md). */
export interface RawForbidden {
  groups: RawForbiddenGroup[];
  /** Формулировки-исключения, общие для всего реестра. */
  allowed: string[];
}

/** Уровень кризисной категории: см. `content/crisis.md`, раздел «Как читать файл». */
export type CrisisLevel = "кризис" | "с оговоркой";

/** Категория кризисных триггеров: формы речи, уровень и действие детектора. */
export interface RawCrisisTrigger {
  id: string;
  title: string;
  level: CrisisLevel;
  action: string;
  forms: string[];
}

/** Кризисный текст: что показывается вместо разбора и где. */
export interface RawCrisisText {
  id: string;
  text: string;
  where: string[];
}

/** Строка контактов помощи. `placeholder` не пуст, пока номер не заполнен основателем. */
export interface RawCrisisContact {
  id: string;
  title: string;
  value: string;
  placeholder: string | null;
}

/** Кризисный файл целиком (content/crisis.md). */
export interface RawCrisis {
  triggers: RawCrisisTrigger[];
  /** Похожие, но не кризисные формулировки: обязательный корпус для детектора. */
  safe: string[];
  texts: RawCrisisText[];
  contacts: RawCrisisContact[];
}

/** Строка интерфейса: идентификатор, текст, места показа и подстановки. */
export interface RawUiCopy {
  id: string;
  /** Группа реестра, она же экран или состояние: `INTRO`, `MAP`, `EDGE`… */
  group: string;
  text: string;
  where: string[];
  /** Имена подстановок вида `{имя}`, которые обязан передать код. */
  params: string[];
}

/**
 * Вопрос добора полной карты. Текст, тип и варианты пришли из банка по идентификатору:
 * в `content/slices/full-map.md` стоят только идентификаторы, чтобы у формулировки
 * остался один источник правды.
 */
export interface RawFullMapQuestion {
  /** Идентификатор банка: `Q1`–`Q40`, `О1`–`О3`. */
  id: string;
  type: string;
  text: string;
  coordinates: number[];
  direction: string;
  role: string | null;
  options: { key: string; text: string }[];
  /** Зачем вопрос стоит в этой порции; человеку не показывается. */
  why: string;
}

export interface RawFullMapPortion {
  number: number;
  questions: RawFullMapQuestion[];
}

/**
 * Ось промежуточного блока полной карты. `полоса` — полоса пары шкальных вопросов
 * (ключи `низко`, `середина`, `высоко`), `вариант` — вариант категориального вопроса
 * (ключи из банка).
 */
export interface RawFullMapAxis {
  ids: string[];
  kind: "полоса" | "вариант";
  keys: string[];
  /** Подписи полюсов для того, кто читает файл: ключ → что он означает. */
  poles: Record<string, string>;
}

export interface RawFullMapInterlude {
  number: number;
  heading: string;
  axes: RawFullMapAxis[];
  pairs: { first: string; second: string; text: string }[];
}

/** Добор самого дорогого среза (content/slices/full-map.md). */
export interface RawFullMap {
  slice: string;
  file: string;
  title: string;
  price: number;
  promise: string;
  portions: RawFullMapPortion[];
  interludes: RawFullMapInterlude[];
  subtypes: { code: string; text: string }[];
  threshold: { checks: string[]; followUps: string[] };
  report: string[];
  /** Границы точности: честный список того, где карта опирается на два ответа. */
  accuracy: string[];
  restrictions: string[];
  /** `slice` пуст, когда предложения после среза нет вовсе. */
  nextDoors: { condition: string; slice: string | null; note: string }[];
}

/**
 * Экран оплаты одного среза (раздел «Экран оплаты» в файле среза).
 *
 * `promise` — то же обещание, что в оффере: второй записи у него нет. `contents` — состав,
 * а не список выгод. Цена на экране одна и живёт полем `price`, в текстах её нет.
 */
export interface RawPayScreen {
  slice: string;
  file: string;
  price: number;
  promise: string;
  contents: string[];
  decline: string;
}

/**
 * Письмо (content/emails.md). `withoutEmail` — место на странице, которое говорит то же
 * самое: почта не основной носитель, и её может не быть вовсе (открытый вопрос 6).
 */
export interface RawEmail {
  id: string;
  title: string;
  /** Событие, по которому письмо уходит. Писем по расписанию в продукте нет. */
  when: string;
  subject: string;
  withoutEmail: string;
  body: string[];
  /** Имена подстановок вида `{имя}` в теме и теле. */
  params: string[];
}

/** Общая часть подвала письма: стоит в каждом письме и правится один раз. */
export interface RawEmailFooter {
  id: string;
  text: string;
  where: string[];
}

export interface RawEmails {
  emails: RawEmail[];
  footer: RawEmailFooter[];
}

/** Слой шеринговой картинки: что на ней стоит и откуда это берётся. */
export interface RawShareLayer {
  name: string;
  content: string;
  source: string;
}

/**
 * Подпись на картинке. `placeholders` — имена реквизитов основателя в двойных скобках;
 * пока хотя бы один не заполнен, картинка не собирается (открытый вопрос 4).
 */
export interface RawShareCaption {
  id: string;
  text: string;
  where: string;
  placeholders: string[];
}

/** Формат картинки: превью ссылки и вертикальная картинка для публикации. */
export interface RawShareFormat {
  name: string;
  width: number;
  height: number;
  purpose: string;
}

export interface RawShare {
  layers: RawShareLayer[];
  captions: RawShareCaption[];
  formats: RawShareFormat[];
}

export interface RawExtraContent {
  interludes: RawSliceInterlude[];
  doors: RawDoorLabels;
  disclaimers: RawDisclaimer[];
  forbidden: RawForbidden;
  crisis: RawCrisis;
  uiCopy: RawUiCopy[];
  fullMap: RawFullMap;
  payScreens: RawPayScreen[];
  emails: RawEmails;
  share: RawShare;
}
