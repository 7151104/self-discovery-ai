/**
 * Две стены типов между внутренним состоянием и клиентом.
 *
 * Первая — `Wire<T>`: продуктовое решение из `docs/14-state.md` о том, что
 * значения координат наружу не уходят. Вторая — `Viewable<T>`: требование
 * `docs/11-ui-page-spec.md` о том, что публичный вид не отдаёт блоки 3 и 4.
 *
 * Обе устроены одинаково. Тип, в котором на любой глубине встретилось
 * запрещённое, теряет свою форму и превращается в тип-метку. Присвоить такому
 * типу объект нельзя — сборка падает в той же строке, где появилось лишнее,
 * и называет, что именно.
 */

/**
 * Поля внутреннего профиля (`engine/src/types.ts`), которых не должно быть
 * ни в одном ответе API ни на одном уровне вложенности.
 *
 * Список один и тот же для компилятора и для проверки на выходе
 * (`server/src/http/guard.ts`): тип выводится из этого массива.
 */
export const FORBIDDEN_FIELDS = [
  "band",
  "code",
  "confidence",
  "coordinate",
  "coordinates",
  "dominantNode",
  "flags",
  "internalProfile",
  "llmTask",
  "nextPaidOffer",
  "nodes",
  "profile",
  "sources",
  "value",
] as const;

export type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number];

/** Имена запрещённых полей, найденные в типе. Пусто — тип чист. */
type Leaking<T> = T extends readonly (infer Item)[]
  ? Leaking<Item>
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? Extract<keyof T, ForbiddenField> | { [K in keyof T]-?: Leaking<T[K]> }[keyof T]
      : never;

/**
 * Во что превращается протёкший тип. Имя поля попадает в сообщение
 * компилятора, поэтому по ошибке сборки видно, что именно утекло.
 */
export interface CoordinateLeak<Field extends string> {
  readonly "координата наружу не отдаётся": Field;
}

/** Тип ответа API. Чистый тип проходит насквозь, протёкший — не собирается. */
export type Wire<T> = [Leaking<T>] extends [never] ? T : CoordinateLeak<Leaking<T> & string>;

// ── Вторая стена: публичный вид ───────────────────────────────────────────────

/**
 * Блоки, которые не показываются постороннему: узел (3), сюжет (4) и любой
 * купленный срез. `docs/11-ui-page-spec.md`, раздел «Виральность».
 */
export const PRIVATE_BLOCK_SLOTS = ["step3", "step4"] as const;

export type PrivateSlot = (typeof PRIVATE_BLOCK_SLOTS)[number] | `slice:${string}`;

/**
 * Закрытые места блоков, найденные среди типов полей. Ловится именно тип поля:
 * поле, объявленное как `BlockSlot`, способно принести `step3`, а поле,
 * объявленное как `"step1" | "step2"`, — нет.
 */
type LeakingSlot<T> = T extends readonly (infer Item)[]
  ? LeakingSlot<Item>
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? { [K in keyof T]-?: LeakingSlot<T[K]> }[keyof T]
      : Extract<T, PrivateSlot>;

export interface PrivateBlockLeak<Slot extends string> {
  readonly "этот блок в публичном виде не отдаётся": Slot;
}

/**
 * Тип ответа публичного вида. Форма, способная принести блок 3, 4 или срез,
 * перестаёт быть присваиваемой: спрятать блок фильтром на выходе, оставив
 * общий тип, не получится — общий тип не соберётся.
 */
export type Viewable<T> = [LeakingSlot<T>] extends [never] ? T : PrivateBlockLeak<LeakingSlot<T> & string>;

type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Утверждение для места объявления DTO: `Wire<T>` совпал с `T`, то есть тип чист.
 * Если появится запрещённое поле, значение `true` перестанет быть присваиваемым.
 */
export type AssertClean<T> = Exact<Wire<T>, T> extends true ? true : never;

/** То же для публичного вида: закрытых блоков в типе нет. */
export type AssertViewable<T> = Exact<Viewable<T>, T> extends true ? true : never;
