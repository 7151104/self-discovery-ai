/**
 * Блок разбора (E6-06).
 *
 * Анатомия из `docs/11-ui-page-spec.md`: заголовок, абзацы, сшивка, два мелких
 * действия. Сшивка визуально сильнее абзацев — она и есть кандидат на
 * скриншот, — но сильнее не цветом: крупнее, плотнее и с линейкой слева,
 * поэтому разница видна в градациях серого.
 *
 * «Не согласен» — обязательный элемент, а не вежливость: несогласие
 * понижает confidence координаты (`docs/08-legal-safety.md`).
 * Тексты действий приходят параметрами.
 */

import { h, type Handler, type VNode } from "../src/dom.js";
import type { BlockDto } from "../src/contract.js";

export type BlockState = "rest" | "purchased" | "stale" | "disagreed" | "pending";

export interface BlockAction {
  id: string;
  label: string;
  onSelect?: Handler;
}

export interface BlockPicker {
  title: string;
  options: BlockAction[];
  note?: string | null;
}

export interface BlockProps {
  id: string;
  heading: string;
  paragraphs: string[];
  /** Фраза-сшивка. null — пары не сработали, блок остаётся из абзацев. */
  highlight?: string | null;
  /** Подпись сшивки из реестра. Пусто — выделенный абзац без каталожного ярлыка. */
  stitchLabel?: string | null;
  actions?: BlockAction[];
  /** Пометка «обновилось» или отметка о расхождении: текст приходит снаружи. */
  note?: string | null;
  purchased?: boolean;
  stale?: boolean;
  disagreed?: boolean;
  pending?: boolean;
  /**
   * Блок появился только что и проявляется один раз (E6-09). Блок, который
   * человек уже видел, при следующей отрисовке страницы не мигает.
   */
  entering?: boolean;
  /**
   * Выбор варианта несогласия. Не модальное окно: открывается в самом блоке,
   * на пути прохождения модалок нет (`docs/11-ui-page-spec.md`).
   */
  picker?: BlockPicker | null;
}

export function blockState(props: BlockProps): BlockState {
  if (props.pending === true) return "pending";
  if (props.disagreed === true) return "disagreed";
  if (props.stale === true) return "stale";
  if (props.purchased === true) return "purchased";
  return "rest";
}

export function renderBlock(props: BlockProps): VNode {
  const state = blockState(props);
  return h(
    "article",
    {
      class: "block",
      "data-block": props.id,
      "data-state": state,
      "data-enter": props.entering === true ? "on" : "off",
    },
    h("h2", { class: "block__heading" }, props.heading),
    props.note ? h("p", { class: "block__note" }, props.note) : null,
    ...props.paragraphs.map((paragraph) => h("p", { class: "block__paragraph" }, paragraph)),
    props.highlight
      ? h(
          "figure",
          { class: "block__stitch" },
          props.stitchLabel ? h("figcaption", { class: "block__stitch-label" }, props.stitchLabel) : null,
          h("p", { class: "block__highlight" }, props.highlight),
        )
      : null,
    props.picker
      ? h(
          "div",
          { class: "block__picker", "data-picker": "disagree" },
          h("p", { class: "block__picker-title" }, props.picker.title),
          h(
            "div",
            { class: "block__choices" },
            props.picker.options.map((option) =>
              h(
                "button",
                {
                  class: "block__choice",
                  type: "button",
                  "data-action": "disagree-kind",
                  "data-kind": option.id,
                  onClick: option.onSelect,
                },
                option.label,
              ),
            ),
          ),
          props.picker.note ? h("p", { class: "block__picker-note" }, props.picker.note) : null,
        )
      : null,
    props.actions && props.actions.length > 0
      ? h(
          "div",
          { class: "block__actions" },
          props.actions.map((action) =>
            h(
              "button",
              { class: "block__action", type: "button", "data-action": action.id, onClick: action.onSelect },
              action.label,
            ),
          ),
        )
      : null,
  );
}

/**
 * Блок из состояния страницы. Тексты действий и пометок берутся из контента
 * вызывающим кодом: компонент их не знает.
 */
export function blockFromDto(dto: BlockDto, labels: { actions: BlockAction[]; note?: string | null }): BlockProps {
  return {
    id: dto.id,
    heading: dto.heading,
    paragraphs: dto.paragraphs,
    highlight: dto.highlight,
    actions: labels.actions,
    note: dto.stale ? (labels.note ?? null) : null,
    purchased: dto.purchased,
    stale: dto.stale,
    disagreed: dto.disagreed,
    pending: dto.generation?.status === "pending",
  };
}
