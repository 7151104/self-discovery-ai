/**
 * Журнал сервера (E9-04).
 *
 * Требование `docs/12-target-state.md`, слой 7: в журналах нет открытых
 * ответов, имён и дат рождения. Держать это дисциплиной вызывающего нельзя:
 * одна запись `log("x", { name })` — и требование нарушено молча.
 *
 * Поэтому чистка стоит на входе в журнал и работает по двум правилам сразу:
 *
 * 1. Запрещённое имя поля. Значение не пишется, каким бы оно ни было.
 * 2. Значение не похоже на машинный код. В журнал попадают идентификаторы,
 *    коды, числа и времена; всё остальное — человеческий текст, и он скрывается.
 *
 * Первое правило ловит поле, названное честно (`name`), второе — то же
 * содержимое, положенное под безобидным именем.
 *
 * Тот же фильтр стоит на событиях воронки: таблица `events` — такой же журнал,
 * просто в базе.
 */

/** Что осталось от значения после чистки. */
export const HIDDEN = "[скрыто]";

/**
 * Имена полей, значения которых не попадают в журнал никогда.
 * Список — про данные человека, а не про технику.
 */
export const SENSITIVE_FIELDS = [
  "answer",
  "answers",
  "birthdate",
  "birth_date",
  "body",
  "card",
  "channel",
  "email",
  "heading",
  "highlight",
  "hook",
  "lead",
  "name",
  "paragraph",
  "paragraphs",
  "payload",
  "phone",
  "promise",
  "question",
  "snapshot",
  "text",
  "title",
] as const;

const sensitive = new Set<string>(SENSITIVE_FIELDS);

/**
 * Машинное значение: идентификатор, код, путь, число, время, их перечисление
 * через запятую. Каждый элемент перечисления — до 64 знаков без пробелов и
 * кириллицы: человеческий текст без пробела такой длины не встречается, а список
 * кодов отказа генерации длиннее одного элемента.
 */
const MACHINE_TOKEN = /[A-Za-z0-9_.:/@+-]{1,64}/;
const MACHINE = new RegExp(`^${MACHINE_TOKEN.source}(?:,${MACHINE_TOKEN.source})*$`);

/** Дата рождения выглядит машинно, но человеческая. Полное время — нет. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type LogValue = string | number | boolean | null;

/** Одно значение после чистки. */
export function scrubValue(key: string, value: unknown): LogValue {
  if (sensitive.has(key.toLowerCase())) return HIDDEN;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value !== "string") return HIDDEN;
  if (!MACHINE.test(value)) return HIDDEN;
  if (BARE_DATE.test(value)) return HIDDEN;
  return value;
}

/** Набор полей после чистки. Вложенности в журнале нет: он плоский по замыслу. */
export function scrub(fields: Record<string, unknown>): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = scrubValue(key, value);
  return out;
}

type Sink = (line: string) => void;

let sink: Sink = (line) => process.stdout.write(line);

/** Подменяет приёмник строк. Нужно тестам, чтобы читать то, что ушло бы в вывод. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? ((line) => process.stdout.write(line));
}

/** Строка журнала: имя события плюс очищенные поля. */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  sink(`${JSON.stringify({ event, ...scrub(fields) })}\n`);
}
