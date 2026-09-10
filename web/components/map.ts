/**
 * Визуальная карта (E6-07): семь полос, три состояния полосы и одна
 * категориальная полоса уязвимости.
 *
 * Главное ограничение продукта: наружу не выходят ни числа, ни проценты, ни
 * названия координат, ни машинные коды. Полоса — это ключ и состояние.
 * Поэтому позиция маркера не попадает в разметку числом: она сводится к одной
 * из семи именованных зон. Это ещё и защита значения координаты — точное
 * `position` от сервера почти и есть координата, а зона не восстанавливается
 * обратно.
 *
 * Состав полос задаёт `docs/11-ui-page-spec.md`; сервер отдаёт его в
 * `MapBarDto`, компонент состав не изобретает.
 */

import { h, type VNode } from "../src/dom.js";
import type { MapBarDto } from "../src/contract.js";

/**
 * Семь зон вместо числа. Слева направо; названия — машинные ключи,
 * человеку они не показываются.
 */
export const ZONES = ["far-low", "low", "mid-low", "center", "mid-high", "high", "far-high"] as const;

export type Zone = (typeof ZONES)[number];

/** Позиция 0..1 → зона. Обратно значение координаты не восстанавливается. */
export function zoneOf(position: number): Zone {
  const clamped = Math.min(Math.max(position, 0), 1);
  const index = Math.min(ZONES.length - 1, Math.floor(clamped * ZONES.length));
  return ZONES[index] as Zone;
}

export interface MapProps {
  bars: MapBarDto[];
  /** Имя карты. Видно заголовком и дублируется для скринридера. */
  label: string;
  /** Почему семь полос, а не шестнадцать. Из реестра, можно не передавать. */
  note?: string | null;
  /**
   * Ключи полос, маркер которых уже приезжал. Повторный показ страницы
   * не запускает анимацию заново.
   */
  animated?: ReadonlySet<string>;
  /**
   * Словесное описание положения маркера для текстовой альтернативы. Зависит
   * от полосы, потому что называется через её полюс: «перевес — импульсы».
   * Без него полоса остаётся без описания, но чисел всё равно нет.
   */
  zoneLabel?: (bar: MapBarDto, zone: Zone) => string;
  /** Названия состояний полосы словами: точная, предположительная, пустая. */
  fillLabels?: Record<MapBarDto["fill"], string>;
}

const animationFlag = (id: string, animated: ReadonlySet<string> | undefined): "on" | "off" =>
  animated?.has(id) === true ? "off" : "on";

/** Словесное описание полосы. Без чисел, процентов и названий координат. */
export function barDescription(bar: MapBarDto, props: MapProps): string | null {
  const fill = props.fillLabels?.[bar.fill];
  if (fill === undefined) return null;
  if (bar.fill === "empty") return `${bar.label}: ${fill}. ${bar.hint}`;
  if (bar.category !== null) {
    return bar.category.selected === null ? `${bar.label}: ${fill}` : `${bar.label}: ${bar.category.selected}. ${fill}`;
  }
  const zone = bar.position === null ? null : (props.zoneLabel?.(bar, zoneOf(bar.position)) ?? null);
  return zone === null ? `${bar.label}: ${fill}` : `${bar.label}: ${zone}. ${fill}`;
}

const renderPoles = (bar: MapBarDto): VNode | null =>
  bar.poles === null
    ? null
    : h(
        "div",
        { class: "bar__poles", "aria-hidden": "true" },
        h("span", { class: "bar__pole" }, bar.poles.low),
        h("span", { class: "bar__pole" }, bar.poles.high),
      );

const renderTrack = (bar: MapBarDto): VNode =>
  h(
    "span",
    { class: "bar__track" },
    bar.fill === "empty" || bar.position === null
      ? null
      : h("span", { class: "bar__marker", "data-zone": zoneOf(bar.position) }),
  );

const renderDots = (bar: MapBarDto): VNode | null => {
  if (bar.category === null) return null;
  return h(
    "ul",
    { class: "bar__dots" },
    bar.category.options.map((option) =>
      h(
        "li",
        { class: "bar__dot", "data-selected": option === bar.category?.selected ? "true" : "false" },
        h("span", { class: "visually-hidden" }, option),
      ),
    ),
  );
};

function renderBar(bar: MapBarDto, props: MapProps): VNode {
  const description = barDescription(bar, props);
  const head = [h("span", { class: "bar__label" }, bar.label), bar.category === null ? renderTrack(bar) : null];

  const body =
    bar.fill === "empty"
      ? h(
          "details",
          { class: "bar__explain" },
          h("summary", { class: "bar__row" }, ...head),
          h("p", { class: "bar__hint" }, bar.hint),
        )
      : h("div", { class: "bar__row" }, ...head);

  return h(
    "li",
    {
      class: "bar",
      "data-bar": bar.id,
      "data-fill": bar.fill,
      "data-kind": bar.category === null ? "axis" : "category",
      "data-animate": animationFlag(bar.id, props.animated),
    },
    description === null ? null : h("span", { class: "visually-hidden" }, description),
    body,
    renderDots(bar),
    bar.category?.selected ? h("p", { class: "bar__selected" }, bar.category.selected) : null,
    renderPoles(bar),
  );
}

export function renderMap(props: MapProps): VNode {
  const empty = props.bars.every((bar) => bar.fill === "empty");
  const bars = h(
    "ul",
    { class: "map__bars" },
    props.bars.map((bar) => renderBar(bar, props)),
  );
  const inventory = empty
    ? h(
        "details",
        { class: "map__fold" },
        h("summary", { class: "map__fold-summary" }, props.note ?? props.label),
        bars,
      )
    : [props.note ? h("p", { class: "section-note" }, props.note) : null, bars];
  return h(
    "section",
    { class: "map", "aria-label": props.label, "data-empty": empty ? "true" : "false" },
    h("p", { class: empty ? "section-title visually-hidden" : "section-title" }, props.label),
    ...(Array.isArray(inventory) ? inventory : [inventory]),
  );
}
