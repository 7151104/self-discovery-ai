/**
 * Стена типов между внутренним профилем и клиентом.
 *
 * Продуктовое решение из `docs/14-state.md`: значения координат наружу не уходят.
 * Здесь оно перестаёт быть договорённостью и становится проверкой компилятора:
 * тип, в котором на любой глубине встретилось поле из `ForbiddenField`, теряет
 * свою форму и превращается в `CoordinateLeak`. Присвоить такому типу объект
 * нельзя — сборка падает в той же строке, где появилось лишнее поле.
 */

/**
 * Поля внутреннего профиля (`engine/src/types.ts`), которых не должно быть
 * ни в одном ответе API ни на одном уровне вложенности.
 */
export type ForbiddenField =
  | "band"
  | "code"
  | "confidence"
  | "coordinate"
  | "coordinates"
  | "dominantNode"
  | "flags"
  | "internalProfile"
  | "llmTask"
  | "nextPaidOffer"
  | "nodes"
  | "profile"
  | "sources"
  | "value";

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

type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Утверждение для места объявления DTO: `Wire<T>` совпал с `T`, то есть тип чист.
 * Если появится запрещённое поле, значение `true` перестанет быть присваиваемым.
 */
export type AssertClean<T> = Exact<Wire<T>, T> extends true ? true : never;
