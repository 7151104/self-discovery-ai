/**
 * Движение на странице (E6-09): появление блока, прокрутка к нему, пауза
 * «собираю» и снижение движения.
 *
 * Правило, из которого всё следует: **человек отвечает быстрее, чем едет
 * анимация, и не должен её ждать.** Поэтому движение здесь ничего не
 * возвращает и ничего не обещает: ответ обрабатывается сразу, а анимация в
 * этот момент просто сокращается. Ни одна функция этого модуля не отдаёт
 * промис, который вызывающему коду пришлось бы дожидаться перед приёмом
 * ответа.
 *
 * Снижение движения (`prefers-reduced-motion: reduce`) выключает переходы
 * целиком, а не замедляет их: пауза становится нулевой, прокрутка —
 * мгновенной, CSS-переходы гасятся правилом в `web/components/motion.css`.
 *
 * Браузера в тестах нет, поэтому окно, таймеры и элемент приходят
 * параметрами: то же дерево проверяется без DOM.
 */

import { COLLECTING_PAUSE_MS } from "../tokens/tokens.js";

/** Запрос, которым система сообщает о снижении движения. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Часть окна, которая нужна движению. Больше от браузера ничего не требуется. */
export interface MotionHost {
  matchMedia?: (query: string) => { matches: boolean };
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

/** Настоящее окно, когда код выполняется в браузере. */
export function windowHost(): MotionHost | null {
  if (typeof window === "undefined") return null;
  return {
    matchMedia: (query) => window.matchMedia(query),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}

/** Человек попросил меньше движения. Без `matchMedia` считаем, что не просил. */
export const motionReduced = (host: MotionHost): boolean =>
  host.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;

/** Признак для CSS: элемент показывается впервые и его можно проявить. */
export type EnterFlag = "on" | "off";

/**
 * Появление один раз. Блок, который человек уже видел, при следующей отрисовке
 * страницы не проявляется заново — так же, как маркер карты не приезжает
 * второй раз при скролле.
 */
export function enterFlag(id: string, seen: ReadonlySet<string>, reduced = false): EnterFlag {
  return reduced || seen.has(id) ? "off" : "on";
}

/** Элемент, к которому прокручивают. От DOM нужен один метод. */
export interface ScrollTarget {
  scrollIntoView: (options: { behavior: "smooth" | "auto"; block: "start" }) => void;
}

/**
 * Прокрутка к новому блоку. При снижении движения страница не едет, а
 * оказывается на месте: смысл прокрутки — показать, что страница выросла,
 * а не устроить путешествие.
 */
export function scrollToNewBlock(target: ScrollTarget, host: MotionHost): void {
  target.scrollIntoView({ behavior: motionReduced(host) ? "auto" : "smooth", block: "start" });
}

/** Пауза «собираю»: живёт сама, отменяется ответом. */
export interface Pause {
  /** Сколько миллисекунд она собиралась ждать. При снижении движения — ноль. */
  readonly ms: number;
  readonly done: boolean;
  /** Закончить немедленно. Вызывается повторно без последствий. */
  skip: () => void;
}

export interface PauseOptions {
  host: MotionHost;
  /** Что показать по окончании паузы: обычно — новый блок. */
  onDone: () => void;
  /** Своя длительность. По умолчанию — пауза «собираю» из токенов. */
  ms?: number;
}

/**
 * Пауза между последним ответом порции и появлением блока.
 *
 * При снижении движения паузы нет вовсе: `onDone` вызывается сразу, таймер не
 * заводится. В обычном случае пауза заводит один таймер и гарантирует, что
 * `onDone` случится ровно один раз — по времени или по `skip()`.
 */
export function collectingPause(options: PauseOptions): Pause {
  const ms = motionReduced(options.host) ? 0 : (options.ms ?? COLLECTING_PAUSE_MS);
  let done = false;
  let timer: number | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    if (timer !== null) options.host.clearTimeout(timer);
    timer = null;
    options.onDone();
  };

  if (ms === 0) finish();
  else timer = options.host.setTimeout(finish, ms);

  return {
    ms,
    get done() {
      return done;
    },
    skip: finish,
  };
}

/**
 * Ответ во время паузы или анимации.
 *
 * Порядок здесь и есть требование приёмки: сначала ответ, потом движение.
 * Ответ принимается синхронно и возвращает своё значение, а пауза лишь
 * сокращается — она не стоит между человеком и следующим вопросом.
 */
export function answerDuringMotion<T>(pause: Pause | null, accept: () => T): T {
  const result = accept();
  pause?.skip();
  return result;
}
