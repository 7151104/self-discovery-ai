/**
 * Причины отказа генерации для журнала (E4-12).
 *
 * `describeRegisterProblem` и `describeViolation` собирают строку
 * `вид: пояснение — «фраза»`. Фраза — кусок текста человека или модели о нём,
 * и в журнал сервера она попасть не должна. Здесь остаётся машинная часть:
 * вид нарушения и устойчивые признаки (группа реестра, confidence, номер
 * координаты), латиницей, чтобы пройти фильтр E9-04.
 */

const QUOTED_TAIL = /\s+[—–-]\s+«[^»]*»?\s*$/u;

/** Словарь вида нарушения → машинный код. Длинные ключи первыми, чтобы не перепутать. */
const KIND_SLUG: [string, string][] = [
  ["регистр сильнее confidence", "register_gt_confidence"],
  ["неизвестное не в последнем абзаце", "unknown_not_last"],
  ["форма не соответствует виду", "form_mismatch"],
  ["цитата не из ответа", "quote_not_from_answer"],
  ["предложение без разметки", "unmarked_sentence"],
  ["фразы нет в тексте", "phrase_not_in_text"],
  ["переписанная инструкция", "rewritten_instruction"],
  ["чужой объём цитаты", "quote_too_long"],
  ["предел стоимости", "cost_limit"],
  ["отказ провайдера", "provider"],
  ["лишняя координата", "extra_coordinate"],
  ["нет координаты", "missing_coordinate"],
  ["координата пуста", "empty_coordinate"],
  ["неизвестный вид", "unknown_kind"],
  ["граница конверта", "envelope_boundary"],
  ["лишнее поле", "extra_field"],
  ["пустой текст", "empty_text"],
  ["нет поля", "missing_field"],
  ["не json", "not_json"],
  ["таймаут", "timeout"],
  ["методика", "method"],
  ["Barnum", "barnum"],
  ["сюжет", "storyline"],
  ["реестр", "forbidden"],
  ["совет", "advice"],
  ["объём", "volume"],
  ["каркас", "frame"],
  ["вода", "vague"],
];

const STATEMENT_SLUG: Record<string, string> = {
  утверждение: "claim",
  вероятность: "probability",
  вопрос: "question",
  цитата: "quote",
  неизвестное: "unknown",
};

/** Хвост с процитированной фразой. Тест падает, если фраза после этой функции ещё видна. */
export function stripQuotedFailureDetail(detail: string): string {
  return detail.replace(QUOTED_TAIL, "").trim();
}

function slugOf(detail: string): string {
  const stripped = stripQuotedFailureDetail(detail);
  const kind = KIND_SLUG.find(([key]) => stripped === key || stripped.startsWith(`${key}:`) || stripped.startsWith(`${key} ·`));
  const parts: string[] = [kind?.[1] ?? "problem"];
  const group = stripped.match(/FORBIDDEN_[A-Z_]+/);
  if (group) parts.push(group[0]);
  const statement = stripped.match(/вид «(утверждение|вероятность|вопрос|цитата|неизвестное)»/);
  if (statement) parts.push(STATEMENT_SLUG[statement[1]!] ?? statement[1]!);
  const confidence = stripped.match(/confidence\s+(high|medium|low)/);
  if (confidence) parts.push(confidence[1]!);
  const coordinate = stripped.match(/координаты\s+(\d+)/);
  if (coordinate) parts.push(`c${coordinate[1]}`);
  const count = stripped.match(/слов\s+(\d+)/);
  if (count) parts.push(`w${count[1]}`);
  const frames = stripped.match(/абзацев\s+(\d+)/);
  if (frames) parts.push(`p${frames[1]}`);
  return parts.join("_").slice(0, 64);
}

/**
 * Список причин в виде, который журнал имеет право напечатать:
 * перечисление машинных кодов через запятую, без фраз человека.
 */
export function failureNotesForLog(details: string[]): string {
  const tokens = details.map(slugOf).filter(Boolean);
  return [...new Set(tokens)].join(",");
}
