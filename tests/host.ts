/**
 * Поддельное окно для живого клиента в тестах качества.
 *
 * Снижение движения включено: пауза «собираю» не ждёт таймер, дерево
 * обновляется сразу после ответа. Сеть — настоящий тестовый сервер.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const reducedMotion = () => ({
  matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION_QUERY }),
  setTimeout: (handler: () => void) => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
});

export const hostOf = (origin: string, pathname = "/") => {
  const location = { pathname };
  const focus = { selector: null as string | null };
  return {
    location,
    origin,
    fetch,
    history: {
      pushState: (_data: unknown, _title: string, url: string) => {
        location.pathname = new URL(String(url), origin).pathname;
      },
    },
    motion: reducedMotion(),
    focus,
    focusRoot: {
      querySelector: (selector: string) => {
        if (!selector) return null;
        return {
          focus: () => {
            focus.selector = selector;
          },
        };
      },
    },
  };
};
