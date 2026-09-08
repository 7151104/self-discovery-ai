/**
 * Витрина компонентов и состояний страницы (E6-12).
 *
 * Открывается по адресу `/web/showcase/` статического сервера (`npm run serve`).
 * Показывает каждый компонент во всех состояниях и каждое состояние страницы
 * `s0`–`paid_done` собранной страницей на моковых данных. Отдельный раздел —
 * `?section=…`: по разделу на снимок для визуальных регрессий E11-04.
 */

import type { QuestionDto } from "../src/contract.js";
import { h, isVNode, mount, type Child, type VNode } from "../src/dom.js";
import { TOKEN_GROUPS } from "../tokens/tokens.js";
import { renderBlock, blockFromDto } from "../components/block.js";
import { renderDoor, doorVisual, renderRoute, type DoorVisual } from "../components/door.js";
import { renderMap } from "../components/map.js";
import { renderOffer, renderPaymentStep } from "../components/offer.js";
import { renderOpenField, SUBMIT_FROM_WORDS } from "../components/open-field.js";
import { renderOptions } from "../components/option.js";
import { renderHead, renderHook } from "../components/page-head.js";
import { renderPortion, type PortionLabels } from "../components/portion.js";
import { renderScale } from "../components/scale.js";
import { renderIntro } from "../components/intro.js";
import { renderMissing } from "../components/missing.js";
import { renderWait } from "../components/wait.js";
import { introTexts, missingTexts, portionTexts, waitTexts } from "../src/page-copy.js";
import { EDGE_CASES } from "./edge-states.js";
import { viewLabels } from "./labels.js";
import * as mock from "./mocks.js";
import { renderPersonalPage } from "./page.js";
import { PAGE_STATE_CASES, pageStates } from "./page-states.js";

const section = (id: string, title: string, note: string, ...items: Child[]): VNode =>
  h(
    "section",
    { class: "showcase__section", id, "data-section": id },
    h("h2", { class: "showcase__title" }, title),
    h("p", { class: "showcase__note" }, note),
    ...items,
  );

/** Компонент в рамке телефона 360×640: то, для чего он спроектирован. */
const phone = (caption: string, node: Child): VNode => {
  const inner = isVNode(node) && node.attrs["class"] === "page" ? node : h("div", { class: "page" }, node);
  return h(
    "figure",
    { class: "showcase__case" },
    h("figcaption", { class: "showcase__caption" }, caption),
    h("div", { class: "showcase__phone" }, inner),
  );
};

const tokensSection = (): VNode =>
  section(
    "tokens",
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
    "typography",
    "Типографика и крючок",
    "Крупного текста на странице ровно два: имя и фраза-крючок.",
    phone("Шапка и крючок", h("div", { class: "showcase__stack" }, renderHead(mock.card), renderHook(mock.hook))),
  );

const entrySection = (): VNode =>
  section(
    "entry",
    "Вход и отсутствующий профиль",
    "Ступень 0: имя обязательно, дату можно пропустить. Профиля нет — понятная страница без кодов отказа.",
    phone(
      "Карточка входа",
      renderIntro({
        labels: {
          title: introTexts.title(),
          about: introTexts.about(),
          nameLabel: introTexts.nameLabel(),
          namePlaceholder: introTexts.namePlaceholder(),
          nameRequired: introTexts.nameRequired(),
          dateLabel: introTexts.dateLabel(),
          dateHint: introTexts.dateHint(),
          submit: introTexts.submit(),
        },
      }),
    ),
    phone(
      "Ссылка не открывается",
      renderMissing({ title: missingTexts.title(), text: missingTexts.text(), action: missingTexts.action() }),
    ),
  );

const inputSection = (): VNode =>
  section(
    "input",
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
  // Витрина читается и без браузера: тесты собирают то же дерево строкой.
  if (typeof document === "undefined") return host;
  queueMicrotask(() => {
    const element = document.querySelector('[data-live="field"]');
    if (element !== null) redraw(element);
  });
  return host;
}

const blockSection = (): VNode =>
  section(
    "block",
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
    "map",
    "Визуальная карта",
    "Семь полос, три состояния и категориальная полоса. Ни чисел, ни процентов, ни названий координат.",
    phone(
      "Заполняется: точные, предположительные и пустые полосы",
      renderMap({ bars: mock.mapBars, label: mock.mapLabel, zoneLabel: mock.zoneLabel, fillLabels: mock.fillLabels }),
    ),
    phone(
      "Состояние s0: данных ещё нет, каждая полоса объясняет, чем откроется",
      renderMap({ bars: mock.emptyMapBars, label: mock.mapLabel, zoneLabel: mock.zoneLabel, fillLabels: mock.fillLabels }),
    ),
    phone(
      "Маркер уже приезжал: при повторном показе анимации нет",
      renderMap({
        bars: mock.mapBars,
        label: mock.mapLabel,
        zoneLabel: mock.zoneLabel,
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
    "door",
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
        doors: mock.doorsWithOffer,
        context: { offerSlice: mock.offer.slice, profiled: true },
        formatPrice: mock.formatPrice,
        notes: mock.doorNotes,
        label: mock.routeLabel,
      }),
    ),
  );

const paymentSection = (): VNode =>
  section(
    "payment",
    "Точка оплаты",
    "Одно предложение и ничего больше: ни таймеров, ни второй кнопки с другим продуктом.",
    phone("Первый шаг оплаты", renderPaymentStep({ offer: mock.offer, labels: mock.offerLabels })),
    phone("Предложение внутри страницы", renderOffer({ offer: mock.offer, labels: mock.offerLabels })),
  );

const portionCard = (index: number, total: number, question: QuestionDto, value?: string | null): VNode => {
  const labels: PortionLabels = {
    lead: mock.portionLead,
    progress: portionTexts.progress(index, total),
    back: mock.portionLabels.back,
    scaleMarks: mock.portionLabels.scaleMarks,
    scaleHint: mock.portionLabels.scaleHint,
    openHint: mock.portionLabels.openHint,
    openSubmit: mock.portionLabels.openSubmit,
    counterText: (state) => portionTexts.counter(state, SUBMIT_FROM_WORDS),
  };
  return renderPortion({
    id: `showcase-${question.kind}`,
    question,
    index,
    total,
    labels,
    value: value ?? null,
  });
};

const portionSection = (): VNode =>
  section(
    "portion",
    "Порция вопросов",
    "Карточка внизу заполненной части: один вопрос, прогресс внутри порции, общее число вопросов не заявляется.",
    phone(
      "Выбор: первый вопрос, кнопки «дальше» нет",
      portionCard(0, 4, {
        id: "Q1",
        kind: "выбор",
        text: mock.choiceQuestion.label,
        options: mock.choiceQuestion.options.map((option) => ({ key: option.value, text: option.text })),
        scale: null,
      }),
    ),
    phone(
      "Выбор: второй вопрос, есть «назад»",
      portionCard(1, 4, {
        id: "Q1",
        kind: "выбор",
        text: mock.choiceQuestion.label,
        options: mock.choiceQuestion.options.map((option) => ({ key: option.value, text: option.text })),
        scale: null,
      }),
    ),
    phone(
      "Шкала: пять отметок, подписи полюсов, без чисел",
      portionCard(1, 4, {
        id: "Q2",
        kind: "шкала",
        text: mock.scaleQuestion.label,
        options: [],
        scale: mock.scaleQuestion.poles,
      }),
    ),
    phone("Открытый: пусто, кнопка выключена", portionCard(0, 1, {
      id: "L12",
      kind: "открытый",
      text: mock.openQuestion.label,
      options: [],
      scale: null,
    }, "")),
    phone("Открытый: от пятнадцати слов кнопка включается", portionCard(0, 1, {
      id: "L12",
      kind: "открытый",
      text: mock.openQuestion.label,
      options: [],
      scale: null,
    }, mock.openQuestion.long)),
    phone("Число: две величины, поля подписаны", portionCard(2, 10, mock.numberQuestion)),
    phone("Число: обе величины введены", portionCard(2, 10, mock.numberQuestion, "4,1")),
  );

const waitSection = (): VNode =>
  section(
    "wait",
    "Ожидание генерации",
    "Ждать приходится только ступень 4 и платный срез. Ступени 1–3 приходят готовыми, состояния загрузки у них нет.",
    phone(
      "Ступень 4: сюжет собирается",
      renderWait({
        title: waitTexts.title({ kind: "step4", blockId: "step4", long: false, resumed: false }),
        topics: waitTexts.topics(pageStates.s4Waiting),
        kind: "step4",
      }),
    ),
    phone(
      "Платный срез: что уточняется",
      renderWait({
        title: waitTexts.title({ kind: "slice", blockId: "slice:node_finish", long: false, resumed: false }),
        topics: waitTexts.topics(pageStates.paidWaiting),
        kind: "slice",
      }),
    ),
    phone(
      "Сборка идёт дольше обычного",
      renderWait({
        title: waitTexts.title({ kind: "step4", blockId: "step4", long: true, resumed: false }),
        longNote: waitTexts.longNote({ kind: "step4", blockId: "step4", long: true, resumed: false }),
        kind: "step4",
      }),
    ),
    phone(
      "Возврат на страницу во время сборки",
      renderWait({
        title: waitTexts.title({ kind: "step4", blockId: "step4", long: false, resumed: true }),
        resumedNote: waitTexts.resumedNote({ kind: "step4", blockId: "step4", long: false, resumed: true }),
        kind: "step4",
      }),
    ),
    phone("Пауза «собираю» между порцией и новым блоком", renderWait({ title: waitTexts.collecting(), kind: "collecting" })),
    ...PAGE_STATE_CASES.filter((item) => !item.spec).map((item) =>
      phone(item.caption, renderPersonalPage(pageStates[item.key], viewLabels(pageStates[item.key]))),
    ),
  );

const pageSection = (id: string, title: string, note: string, key: keyof typeof pageStates): VNode =>
  section(
    id,
    title,
    note,
    phone(note, renderPersonalPage(pageStates[key], viewLabels(pageStates[key]))),
  );

const specPageSections = (): Array<() => VNode> =>
  PAGE_STATE_CASES.filter((item) => item.spec).map(
    (item) => () => pageSection(item.id, `Состояние ${item.id}`, item.caption, item.key),
  );

const edgeSections = (): Array<() => VNode> =>
  EDGE_CASES.map((item) => () =>
    section(
      `edge-${item.id}`,
      item.situation,
      "Краевое состояние из docs/11-ui-page-spec.md. Собрано страницей, а не списком компонентов.",
      phone(
        item.situation,
        renderPersonalPage(item.page, viewLabels(item.page), {
          notice: item.notice,
          portionIndex: item.portionIndex,
          portionValue: item.portionValue,
        }),
      ),
    ),
  );

/**
 * Разделы витрины. Отдельный раздел открывается как `?section=map` — этим же
 * снимаются картинки для визуальных регрессий E11-04, по разделу за снимок.
 * Состояния страницы и краевые случаи — каждый своим адресом.
 */
export const SECTIONS = [
  tokensSection,
  typographySection,
  entrySection,
  inputSection,
  blockSection,
  mapSection,
  doorSection,
  paymentSection,
  portionSection,
  waitSection,
  ...specPageSections(),
  ...edgeSections(),
];

export function renderShowcase(only?: string | null): VNode {
  const sections = SECTIONS.map((build) => build()).filter(
    (node) => only === undefined || only === null || node.attrs["data-section"] === only,
  );

  return h(
    "main",
    { class: "showcase" },
    h("h1", { class: "showcase__heading" }, "Витрина компонентов"),
    h(
      "p",
      { class: "showcase__lead" },
      "Компоненты дизайн-системы во всех состояниях и состояния страницы s0–paid_done собранными страницами на моковых данных. Каждый раздел открывается как ?section=…",
    ),
    ...sections,
  );
}

const root = typeof document === "undefined" ? null : document.querySelector("#app");
if (root !== null) mount(renderShowcase(new URL(location.href).searchParams.get("section")), root);
