/**
 * Разбор текста на слова и предложения.
 *
 * Здесь нет ни одного продуктового правила: только то, как считается объём и где
 * кончается предложение. Всё остальное — в валидаторе и в контенте.
 */

/** Слова текста: буквы и цифры, дефис внутри слова не разрывает. */
export const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];

export const wordCount = (text: string): number => words(text).length;

/** Нормализованный вид для сравнения фраз: регистр, `ё`, кавычки и пробелы. */
export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„']/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Предложения текста. Граница — точка, восклицательный или вопросительный знак,
 * за которым идёт пробел и заглавная буква, либо конец абзаца. Многоточие внутри
 * предложения границей не считается: в разборе оно стоит в середине фразы.
 */
export function sentences(text: string): string[] {
  const found: string[] = [];
  for (const paragraph of text.split(/\n{2,}|\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const parts = trimmed
      .replace(/([.!?])\s+(?=[«"(]?[A-ZА-ЯЁ])/gu, "$1\u0000")
      .split("\u0000")
      .map((part) => part.trim())
      .filter(Boolean);
    found.push(...parts);
  }
  return found;
}

export const paragraphs = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Фраза найдена в тексте: сравнение по нормализованному виду. */
export const containsPhrase = (text: string, phrase: string): boolean =>
  normalize(text).includes(normalize(phrase));
