/**
 * Ожидание сборки (E6-10).
 *
 * Ждать приходится только там, где текст действительно пишется: ступень 4 и
 * платный срез. Ступени 1–3 собираются lookup-ом и приходят вместе со
 * страницей, поэтому состояния загрузки у них нет вообще — не «мелькает
 * быстро», а нет.
 *
 * Экран ожидания говорит, что собирается, и не изображает размышление:
 * ни бегущих точек, ни «ИИ думает». Вместо имитации — форма будущего блока
 * и честный текст из реестра микрокопии.
 *
 * Наружу не выходят ни числа, ни проценты, ни названия координат: перечень
 * уточняемого собирается из подписей полос карты — тех самых, которые человек
 * уже видит. Полоса названа темой, а не координатой.
 */

import { h, type VNode } from "../src/dom.js";
import type { BlockDto, BlockSlot, MapBarDto, PageStateDto } from "../src/contract.js";

/** Что именно собирается. Определяет, какой текст покажет вызывающий код. */
export type WaitKind = "step4" | "slice" | "collecting";

/** Блоки, у которых бывает сборка. Остальные приходят готовыми. */
const waitKindOf = (id: BlockSlot): WaitKind | null => {
  if (id === "step4") return "step4";
  return id.startsWith("slice:") ? "slice" : null;
};

/**
 * Ожидание затянулось. Порог выбран так, чтобы обычная сборка до него не
 * доходила: сообщение о задержке, которое видит каждый, перестаёт быть
 * сообщением.
 */
export const LONG_WAIT_MS = 30_000;

export interface WaitState {
  kind: WaitKind;
  blockId: BlockSlot;
  /** Сборка идёт дольше обычного — об этом говорится текстом. */
  long: boolean;
  /** Человек вернулся на страницу, где сборка уже шла до его ухода. */
  resumed: boolean;
}

export interface WaitContext {
  /** Текущее время. Параметром, чтобы «затянулось» проверялось тестом. */
  now: number;
  /**
   * Страница открыта заново — переход по ссылке или F5. Состояние ожидания от
   * этого не меняется: оно выводится из данных сервера, а не из памяти вкладки.
   */
  reopened?: boolean;
}

/**
 * Состояние ожидания из состояния страницы.
 *
 * Чистая функция от того, что прислал сервер, — в этом и состоит устойчивость
 * к перезагрузке: после F5 приходит то же состояние страницы, значит человек
 * видит то же ожидание. Ни флага во вкладке, ни записи в браузере.
 */
export function waitFromPage(page: PageStateDto, context: WaitContext): WaitState | null {
  const pending = page.blocks.find((block: BlockDto) => block.generation?.status === "pending");
  if (pending === undefined) return null;

  const kind = waitKindOf(pending.id);
  // Ступени 1–3 приходят готовыми. Сборка на них — ошибка сервера, а не повод
  // показать человеку ожидание там, где ждать нечего.
  if (kind === null) return null;

  const started = Date.parse(page.updatedAt);
  const long = Number.isFinite(started) && context.now - started >= LONG_WAIT_MS;
  return { kind, blockId: pending.id, long, resumed: context.reopened === true };
}

/**
 * Темы, которые сейчас уточняются: подписи полос, ещё не ставших точными.
 *
 * Ни имён координат, ни номеров: подпись полосы — это тема, и она уже видна
 * человеку на карте. Категориальная полоса в перечень не идёт: она не
 * уточняется, она либо помечена, либо нет.
 */
export function waitTopics(bars: MapBarDto[], limit = 3): string[] {
  return bars
    .filter((bar) => bar.fill !== "precise" && bar.category === null)
    .slice(0, limit)
    .map((bar) => bar.label);
}

export interface WaitProps {
  /** Что собирается. Текст из группы WAIT реестра микрокопии. */
  title: string;
  /** Перечень уточняемого готовой строкой. null — перечислять нечего. */
  topics?: string | null;
  /** Сборка идёт дольше обычного. */
  longNote?: string | null;
  /** Возврат на страницу во время сборки. */
  resumedNote?: string | null;
  /** Сколько строк будущего текста наметить. */
  lines?: number;
  kind?: WaitKind;
  entering?: boolean;
}

const DEFAULT_LINES = 3;

/**
 * Форма будущего блока и текст рядом. Полосы намеренно неподвижны: движение
 * здесь изображало бы работу, которой человек не видит.
 */
export function renderWait(props: WaitProps): VNode {
  const lines = props.lines ?? DEFAULT_LINES;
  return h(
    "section",
    {
      class: "wait",
      "data-wait": props.kind ?? "step4",
      "data-enter": props.entering === true ? "on" : "off",
      "aria-live": "polite",
      "aria-busy": "true",
    },
    h("p", { class: "wait__title" }, props.title),
    props.topics ? h("p", { class: "wait__topics" }, props.topics) : null,
    props.resumedNote ? h("p", { class: "wait__note" }, props.resumedNote) : null,
    props.longNote ? h("p", { class: "wait__note" }, props.longNote) : null,
    h(
      "div",
      { class: "wait__shape", "aria-hidden": "true" },
      Array.from({ length: lines }, (_, index) =>
        h("span", { class: "wait__line", "data-line": index === lines - 1 ? "last" : "full" }),
      ),
    ),
  );
}
