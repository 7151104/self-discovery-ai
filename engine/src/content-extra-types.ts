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

export interface RawExtraContent {
  interludes: RawSliceInterlude[];
  doors: RawDoorLabels;
  disclaimers: RawDisclaimer[];
}
