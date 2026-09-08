/**
 * Опрос статуса генерации (E7-08).
 *
 * Не цикл: один таймер, следующий ставится только после ответа предыдущего
 * тика и только если тик сказал «продолжить». Останавливается явно — уход со
 * страницы, отказ генерации, готовый блок.
 *
 * Интервал живёт здесь одним числом: и клиент, и тесты читают его отсюда.
 * Таймер отделён от движения страницы: пауза «собираю» при снижении движения
 * схлопывается в ноль, а опрос от этого схлопываться не должен — иначе тики
 * пойдут синхронно без остановки.
 */

/** Пауза между опросами статуса, миллисекунды. */
export const GENERATION_POLL_MS = 2_000;

/** Часы, которых достаточно опросу. Движение страницы сюда не подмешивается. */
export interface TimerHost {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

/** Настоящее окно, когда код выполняется в браузере. */
export function windowTimer(): TimerHost | null {
  if (typeof window === "undefined") return null;
  return {
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}

export interface Poller {
  /** Прекратить опрос. Повтор безопасен. */
  stop: () => void;
  readonly stopped: boolean;
  /**
   * Дождаться тика, который сейчас выполняется. Нужно тестам: таймер только
   * запускает тик, а сеть внутри него асинхронна.
   */
  idle: () => Promise<void>;
}

export interface PollOptions {
  host: TimerHost;
  /** Свой интервал. По умолчанию — `GENERATION_POLL_MS`. */
  intervalMs?: number;
  /**
   * Один запрос статуса. `true` — поставить следующий тик, `false` — остановиться.
   * Ошибка внутри считается временной: опрос продолжается, пока его не остановили.
   */
  tick: () => Promise<boolean>;
}

/**
 * Периодический опрос. Первый тик ставится сразу: после перезагрузки генерация
 * могла уже закончиться, и ждать интервал незачем.
 */
export function startPoll(options: PollOptions): Poller {
  const intervalMs = options.intervalMs ?? GENERATION_POLL_MS;
  let stopped = false;
  let timer: number | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let epoch = 0;

  const clear = (): void => {
    if (timer === null) return;
    options.host.clearTimeout(timer);
    timer = null;
  };

  const run = async (): Promise<void> => {
    const mine = epoch;
    if (stopped) return;
    let cont = false;
    try {
      cont = await options.tick();
    } catch {
      cont = !stopped;
    }
    if (stopped || mine !== epoch) return;
    if (!cont) {
      stopped = true;
      return;
    }
    schedule(intervalMs);
  };

  const schedule = (ms: number): void => {
    if (stopped) return;
    clear();
    timer = options.host.setTimeout(() => {
      timer = null;
      inFlight = run();
    }, ms);
    // В Node таймер держит процесс. Тесты и остановленный сервер иначе не
    // завершаются: опрос продолжается вхолостую после ухода со страницы.
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  };

  schedule(0);

  return {
    stop() {
      epoch += 1;
      stopped = true;
      clear();
    },
    get stopped() {
      return stopped;
    },
    idle: () => inFlight,
  };
}
