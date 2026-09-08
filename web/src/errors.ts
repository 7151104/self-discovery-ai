/**
 * Клиентский сбор ошибок (E10-06).
 *
 * Браузер ловит необработанные исключения и шлёт их на `POST /api/errors`.
 * Сервер чистит и кладёт в тот же приёмник, что серверные падения. Здесь нет
 * ни профиля, ни ответов — только класс ошибки и сообщение.
 *
 * Адрес зашит строкой, а не импортом реестра: реестр — серверный модуль, и
 * его появление в графе клиента ломает бюджет первой загрузки.
 */

/** Тот же путь, что `API.reportError` в контракте. */
export const ERROR_ENDPOINT = "/api/errors";

export interface ClientErrorPayload {
  errorName: string;
  message: string;
}

export function payloadFromError(error: unknown): ClientErrorPayload {
  if (error instanceof Error) {
    return { errorName: error.name || "Error", message: error.message };
  }
  if (typeof error === "string") return { errorName: "Error", message: error };
  return { errorName: "Error", message: "unknown" };
}

export interface ErrorReporterOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  target?: Pick<EventTarget, "addEventListener">;
}

/**
 * Ставит слушатели `error` и `unhandledrejection`. Без `window` и без `fetch`
 * ничего не делает: в Node-тестах витрины это вызов без эффекта.
 */
export function installClientErrorReporter(options: ErrorReporterOptions = {}): void {
  const target = options.target ?? (typeof globalThis !== "undefined" && "addEventListener" in globalThis
    ? (globalThis as unknown as EventTarget)
    : null);
  const send = options.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (!target || !send) return;

  const endpoint = options.endpoint ?? ERROR_ENDPOINT;
  const report = (error: unknown): void => {
    const payload = payloadFromError(error);
    void send(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  };

  target.addEventListener("error", (event) => {
    const failure = event as ErrorEvent;
    report(failure.error ?? failure.message);
  });
  target.addEventListener("unhandledrejection", (event) => {
    report((event as PromiseRejectionEvent).reason);
  });
}

/** Прямая отправка: нужно тесту, который поднимает искусственную ошибку. */
export async function reportClientError(
  error: unknown,
  options: { endpoint?: string; fetch?: typeof fetch } = {},
): Promise<void> {
  const send = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? ERROR_ENDPOINT;
  const payload = payloadFromError(error);
  await send(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
