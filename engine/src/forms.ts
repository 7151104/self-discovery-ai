/**
 * Сопоставление формы речи с текстом.
 *
 * Разметка форм одна для двух реестров — `content/forbidden.md` и
 * `content/crisis.md`, оба описывают её одинаково: `слово` — целое слово,
 * `основа*` — любое слово с этой основой, `несколько слов` — последовательность
 * слов. Регистр букв не важен, `ё` и `е` считаются одной буквой.
 *
 * Здесь нет ни одной формы: только то, как форма превращается в поиск. Формы
 * приходят из контента.
 */

const WORD = "\\p{L}\\p{N}_";

/** Приведение текста к виду, в котором формы сравниваются. */
export const fold = (text: string): string => text.toLowerCase().replace(/ё/g, "е");

/** Форма реестра → регулярное выражение. Звёздочка снимает границу справа. */
function patternOf(form: string): RegExp {
  const open = form.endsWith("*");
  const body = fold(open ? form.slice(0, -1) : form)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const right = open ? "" : `(?![${WORD}])`;
  return new RegExp(`(?<![${WORD}])${body}${right}`, "gu");
}

const cache = new Map<string, RegExp>();

/** Выражение для формы. Кэш нужен потому, что реестры перебираются на каждый текст. */
export const patternFor = (form: string): RegExp => {
  const cached = cache.get(form);
  if (cached) return cached;
  const pattern = patternOf(form);
  cache.set(form, pattern);
  return pattern;
};

/** Где форма встретилась в уже приведённом тексте. */
export function findForm(folded: string, form: string): { index: number; length: number }[] {
  const pattern = patternFor(form);
  pattern.lastIndex = 0;
  const out: { index: number; length: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(folded)) !== null) out.push({ index: match.index, length: match[0].length });
  return out;
}

/** Предложение вокруг найденного места: исключения действуют в его границах. */
export function sentenceAround(text: string, index: number): { sentence: string; offset: number } {
  const before = text.slice(0, index);
  const start = Math.max(...[".", "!", "?", ";", "\n", "|"].map((mark) => before.lastIndexOf(mark))) + 1;
  const rest = text.slice(index);
  const endMatch = /[.!?;\n|]/.exec(rest);
  const end = index + (endMatch ? endMatch.index : rest.length);
  return { sentence: text.slice(start, end), offset: index - start };
}

/**
 * Место в тексте накрыто одной из форм: найденное совпадение целиком лежит внутри
 * более длинной законной формулировки. Так «хочу исчезнуть» перестаёт быть
 * находкой внутри «хочу исчезнуть на пару дней».
 */
export function coveredByForm(folded: string, index: number, forms: string[]): boolean {
  return forms.some((form) =>
    findForm(folded, form).some((found) => index >= found.index && index < found.index + found.length),
  );
}
