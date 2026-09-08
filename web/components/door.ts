/**
 * Дверь и маршрут (E6-08).
 *
 * Пять состояний двери из `docs/11-ui-page-spec.md`. Контракт отдаёт три
 * машинных состояния (`opens_with_answers`, `paid`, `open`), пятое и четвёртое
 * различаются контекстом страницы: подписи дверей переписываются под профиль
 * после ступени 3, а предложенная дверь — та, которую сервер выбрал офертой.
 *
 * Два продуктовых правила закреплены кодом, а не договорённостью:
 *   1. цена показывается ровно у одной двери — предложенной;
 *   2. хотя бы одна дверь на экране открывается ответами, иначе маршрут
 *      читается как витрина.
 * Нарушение любого из них — исключение при отрисовке, а не тихая витрина.
 */

import { h, type Handler, type VNode } from "../src/dom.js";
import type { DoorDto } from "../src/contract.js";

export type DoorVisual =
  | "locked_generic"
  | "locked_profiled"
  | "opens_with_answers"
  | "open"
  | "offered";

export interface RouteContext {
  /** Срез предложенной двери. null — предложения на экране нет. */
  offerSlice: string | null;
  /** Ступень 3 пройдена: подписи дверей уже под профиль. */
  profiled: boolean;
}

export function doorVisual(door: DoorDto, context: RouteContext): DoorVisual {
  if (door.state === "open") return "open";
  if (door.state === "opens_with_answers") return "opens_with_answers";
  if (door.slice !== null && door.slice === context.offerSlice) return "offered";
  return context.profiled ? "locked_profiled" : "locked_generic";
}

export const INTERACTIVE_VISUALS: DoorVisual[] = ["open", "opens_with_answers", "offered"];

export type RouteViolation = "many-prices" | "no-door-opens-with-answers" | "price-without-offer";

/** Проверка правил маршрута. Пустой список — маршрут можно показывать. */
export function routeViolations(doors: DoorDto[], context: RouteContext): RouteViolation[] {
  const violations: RouteViolation[] = [];
  const visuals = doors.map((door) => doorVisual(door, context));

  if (visuals.filter((visual) => visual === "offered").length > 1) violations.push("many-prices");
  if (doors.length > 0 && !visuals.includes("opens_with_answers")) violations.push("no-door-opens-with-answers");

  for (const [index, door] of doors.entries()) {
    if (door.price !== null && visuals[index] !== "offered") violations.push("price-without-offer");
  }

  return violations;
}

export interface DoorProps {
  door: DoorDto;
  visual: DoorVisual;
  /** Цена строкой — только у предложенной двери. Формат приходит снаружи. */
  priceText?: string | null;
  /** Пометка состояния: «откроется после четырёх вопросов» и подобные. */
  note?: string | null;
  onSelect?: Handler;
}

export function renderDoor(props: DoorProps): VNode {
  const interactive = INTERACTIVE_VISUALS.includes(props.visual);
  const priceText = props.visual === "offered" ? (props.priceText ?? null) : null;

  const inner = [
    h("span", { class: "door__mark", "aria-hidden": "true" }),
    h(
      "span",
      { class: "door__body" },
      h("span", { class: "door__title" }, props.door.title),
      props.note ? h("span", { class: "door__note" }, props.note) : null,
    ),
    priceText === null ? null : h("span", { class: "door__price" }, priceText),
  ];

  return h(
    "li",
    { class: "door", "data-door": props.door.id, "data-state": props.visual },
    interactive
      ? h("button", { class: "door__face", type: "button", onClick: props.onSelect }, ...inner)
      : h("div", { class: "door__face", "data-static": "true" }, ...inner),
  );
}

export interface RouteProps {
  doors: DoorDto[];
  context: RouteContext;
  /** Цена строкой по числовой цене двери. */
  formatPrice: (price: number) => string;
  /** Пометки состояний по ключу двери: тексты приходят из контента. */
  notes?: Record<string, string>;
  /** Имя списка для скринридера. */
  label: string;
  onSelect?: (door: DoorDto) => void;
}

export function renderRoute(props: RouteProps): VNode {
  const violations = routeViolations(props.doors, props.context);
  if (violations.length > 0) throw new Error(`маршрут нарушает правила: ${violations.join(", ")}`);

  return h(
    "ul",
    { class: "route", "aria-label": props.label },
    props.doors.map((door) => {
      const visual = doorVisual(door, props.context);
      return renderDoor({
        door,
        visual,
        priceText: door.price === null ? null : props.formatPrice(door.price),
        note: props.notes?.[door.id] ?? null,
        onSelect: props.onSelect === undefined ? undefined : () => props.onSelect?.(door),
      });
    }),
  );
}
