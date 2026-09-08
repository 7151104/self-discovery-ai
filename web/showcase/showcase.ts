/**
 * Витрина компонентов.
 *
 * Открывается по адресу `/web/showcase/` статического сервера (`npm run serve`).
 * Показывает каждый компонент во всех состояниях на моковых данных и на ширине
 * базового телефона 360 px — той, от которой проектируется вёрстка.
 *
 * Состояния страницы `s0`–`paid_done` целиком добавит E6-12: для них нужны
 * тексты микрокопии (E5-03) и состояния ожидания (E6-10). Сейчас витрина
 * закрывает приёмку компонентов E6-05…E6-08 и служит источником снимков
 * для визуальных регрессий E11-04.
 */

import { h, mount, type Child, type VNode } from "../src/dom.js";
import { TOKEN_GROUPS } from "../tokens/tokens.js";
import { renderBlock, blockFromDto } from "../components/block.js";
import { renderDoor, doorVisual, renderRoute, type DoorVisual } from "../components/door.js";
import { renderMap } from "../components/map.js";
import { renderOffer, renderPaymentStep } from "../components/offer.js";
import { renderOpenField } from "../components/open-field.js";
import { renderOptions } from "../components/option.js";
import { renderHead, renderHook } from "../components/page-head.js";
import { renderScale } from "../components/scale.js";
import * as mock from "./mocks.js";

const section = (title: string, note: string, ...items: Child[]): VNode =>
  h(
    "section",
    { class: "showcase__section" },
    h("h2", { class: "showcase__title" }, title),
    h("p", { class: "showcase__note" }, note),
    ...items,
  );

/** Компонент в рамке телефона 360×640: то, для чего он спроектирован. */
const phone = (caption: string, node: Child): VNode =>
  h(
    "figure",
    { class: "showcase__case" },
    h("figcaption", { class: "showcase__caption" }, caption),
    h("div", { class: "showcase__phone" }, h("div", { class: "page" }, node)),
  );

const tokensSection = (): VNode =>
  section(
    "Токены",
    "Единственный источник значений. Всё, что ниже, собрано из web/tokens/tokens.ts.",
    ...TOKEN_GROUPS.map((group) =>
      h(
        "div",
        { class: "showcase__tokens" },
        h("h3", { class: "showcase__subtitle" }, group.title),
        h(
          "ul",
          { class: "showcase__token-list" },
          group.items.map((item) =>
            h(
              "li",
              { class: "showcase__token" },
              item.value.startsWith("#")
                ? h("span", { class: "showcase__swatch", style: `background:${item.value}` })
                : null,
              h("code", { class: "showcase__token-name" }, `--${item.name}`),
              h("span", { class: "showcase__token-value" }, item.value),
              h("span", { class: "showcase__token-purpose" }, item.purpose),
            ),
          ),
        ),
      ),
    ),
  );

const typographySection = (): VNode =>
  section(
    "Типографика и крючок",
    "Крупного текста на странице ровно два: имя и фраза-крючок.",
    phone("Шапка и крючок", h("div", { class: "showcase__stack" }, renderHead(mock.card), renderHook(mock.hook))),
  );

const inputSection = (): VNode =>
  section(
    "Ввод",
    "Цель нажатия — не меньше 44 px. Фокус проверяется клавишей Tab: кольцо видно на каждом состоянии.",
    phone(
      "Вариант ответа: покой, выбранное",
      renderOptions({ group: mock.choiceQuestion.group, label: mock.choiceQuestion.label, options: mock.choiceQuestion.options, selected: "C" }),
    ),
    phone(
      "Вариант ответа: отключено",
      renderOptions({
        group: `${mock.choiceQuestion.group}-off`,
        label: mock.choiceQuestion.label,
        options: mock.choiceQuestion.options,
        selected: null,
        disabled: true,
      }),
    ),
    phone(
      "Шкала: покой",
      renderScale({ group: "scale-rest", label: mock.scaleQuestion.label, poles: mock.scaleQuestion.poles, markLabels: mock.scaleQuestion.markLabels }),
    ),
    phone(
      "Шкала: выбрана отметка",
      renderScale({ group: "scale-set", label: mock.scaleQuestion.label, poles: mock.scaleQuestion.poles, markLabels: mock.scaleQuestion.markLabels, value: 4 }),
    ),
    phone(
      "Шкала: отключена",
      renderScale({ group: "scale-off", label: mock.scaleQuestion.label, poles: mock.scaleQuestion.poles, markLabels: mock.scaleQuestion.markLabels, disabled: true }),
    ),
    phone("Открытое поле: пусто, счётчика нет, кнопка выключена", openField("field-empty", "")),
    phone("Открытое поле: счётчик появился после пяти слов", openField("field-counter", mock.openQuestion.medium)),
    phone("Открытое поле: от пятнадцати слов кнопка включается", openField("field-ready", mock.openQuestion.long)),
    phone("Открытое поле: отключено", openField("field-off", mock.openQuestion.medium, true)),
    phone("Открытое поле: живой ввод", liveField()),
  );

const openField = (id: string, value: string, disabled = false): VNode =>
  renderOpenField({
    id,
    label: mock.openQuestion.label,
    hint: mock.openQuestion.hint,
    value,
    submitLabel: mock.openQuestion.submitLabel,
    counterText: mock.openQuestion.counterText,
    disabled,
  });

/** Единственное живое место витрины: пороги счётчика видно на своём тексте. */
function liveField(): VNode {
  const host = h("div", { class: "showcase__live" });
  let value = "";

  const redraw = (element: Element) => {
    element.replaceChildren();
    mount(
      renderOpenField({
        id: "field-live",
        label: mock.openQuestion.label,
        hint: mock.openQuestion.hint,
        value,
        submitLabel: mock.openQuestion.submitLabel,
        counterText: mock.openQuestion.counterText,
        onInput: (event) => {
          const target = event.target as HTMLTextAreaElement;
          const caret = target.selectionStart;
          value = target.value;
          redraw(element);
          const next = element.querySelector("textarea");
          if (next !== null) {
            next.focus();
            next.setSelectionRange(caret, caret);
          }
        },
      }),
      element,
    );
  };

  host.attrs["data-live"] = "field";
  queueMicrotask(() => {
    const element = document.querySelector('[data-live="field"]');
    if (element !== null) redraw(element);
  });
  return host;
}

const blockSection = (): VNode =>
  section(
    "Блок разбора",
    "Сшивка сильнее абзацев размером, начертанием и линейкой слева — разница видна и без цвета.",
    phone("Покой", renderBlock(blockFromDto(mock.block, { actions: mock.blockActions }))),
    phone(
      "Без сшивки: пары не сработали",
      renderBlock(blockFromDto({ ...mock.block, highlight: null }, { actions: mock.blockActions })),
    ),
    phone(
      "Отмечено несогласие",
      renderBlock(blockFromDto({ ...mock.block, disagreed: true }, { actions: mock.blockActions })),
    ),
    phone(
      "Обновилось после правки ответа",
      renderBlock(blockFromDto({ ...mock.block, stale: true }, { actions: mock.blockActions, note: mock.staleNote })),
    ),
    phone(
      "Куплено: при правке ответов не переписывается",
      renderBlock(blockFromDto({ ...mock.block, id: "slice:node_finish", purchased: true }, { actions: mock.blockActions })),
    ),
  );

const mapSection = (): VNode =>
  section(
    "Визуальная карта",
    "Семь полос, три состояния и категориальная полоса. Ни чисел, ни процентов, ни названий координат.",
    phone(
      "Заполняется: точные, предположительные и пустые полосы",
      renderMap({ bars: mock.mapBars, label: mock.mapLabel, zoneLabels: mock.zoneLabels, fillLabels: mock.fillLabels }),
    ),
    phone(
      "Состояние s0: данных ещё нет, каждая полоса объясняет, чем откроется",
      renderMap({ bars: mock.emptyMapBars, label: mock.mapLabel, zoneLabels: mock.zoneLabels, fillLabels: mock.fillLabels }),
    ),
    phone(
      "Маркер уже приезжал: при повторном показе анимации нет",
      renderMap({
        bars: mock.mapBars,
        label: mock.mapLabel,
        zoneLabels: mock.zoneLabels,
        fillLabels: mock.fillLabels,
        animated: new Set(mock.mapBars.map((bar) => bar.id)),
      }),
    ),
  );

const doorStates: { visual: DoorVisual; caption: string }[] = [
  { visual: "locked_generic", caption: "Закрыта, тема неизвестна" },
  { visual: "locked_profiled", caption: "Закрыта, тема известна" },
  { visual: "opens_with_answers", caption: "Открывается ответами" },
  { visual: "open", caption: "Открыта" },
  { visual: "offered", caption: "Платная, предложена — единственная цена на экране" },
];

const doorSection = (): VNode =>
  section(
    "Двери и маршрут",
    "Маршрут виден с первого экрана. Цена — только у предложенной двери, закрытые платные без цен.",
    phone(
      "Пять состояний двери",
      h(
        "ul",
        { class: "route" },
        doorStates.map((state, index) => {
          const door = mock.doors[Math.min(index, mock.doors.length - 1)] as (typeof mock.doors)[number];
          return renderDoor({
            door: { ...door, id: `${door.id}-${state.visual}` },
            visual: state.visual,
            priceText: state.visual === "offered" ? mock.formatPrice(mock.offer.price) : null,
            note: state.caption,
          });
        }),
      ),
    ),
    phone(
      "Маршрут до ступени 3: подписи общие",
      renderRoute({
        doors: mock.doors,
        context: { offerSlice: null, profiled: false },
        formatPrice: mock.formatPrice,
        notes: mock.doorNotes,
        label: mock.routeLabel,
      }),
    ),
    phone(
      "Маршрут после ступени 3: подписи под профиль, одна дверь предложена",
      renderRoute({
        doors: mock.doors,
        context: { offerSlice: mock.offer.slice, profiled: true },
        formatPrice: mock.formatPrice,
        notes: mock.doorNotes,
        label: mock.routeLabel,
      }),
    ),
  );

const paymentSection = (): VNode =>
  section(
    "Точка оплаты",
    "Одно предложение и ничего больше: ни таймеров, ни второй кнопки с другим продуктом.",
    phone("Первый шаг оплаты", renderPaymentStep({ offer: mock.offer, labels: mock.offerLabels, formatPrice: mock.formatPrice })),
    phone("Предложение внутри страницы", renderOffer({ offer: mock.offer, labels: mock.offerLabels, formatPrice: mock.formatPrice })),
  );

export function renderShowcase(): VNode {
  return h(
    "main",
    { class: "showcase" },
    h("h1", { class: "showcase__heading" }, "Витрина компонентов"),
    h(
      "p",
      { class: "showcase__lead" },
      "Компоненты дизайн-системы во всех состояниях на моковых данных. Состояния страницы s0–paid_done добавит E6-12.",
    ),
    tokensSection(),
    typographySection(),
    inputSection(),
    blockSection(),
    mapSection(),
    doorSection(),
    paymentSection(),
  );
}

const root = typeof document === "undefined" ? null : document.querySelector("#app");
if (root !== null) mount(renderShowcase(), root);
