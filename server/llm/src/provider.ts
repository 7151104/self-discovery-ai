/**
 * Порт провайдера генерации (E4-01).
 *
 * Провайдер основателем не назван, и слой его не ждёт: наружу смотрит интерфейс,
 * внутри репозитория лежит поддельная реализация. Тот же приём, что у базы
 * (`server/src/db/driver.ts`): смена реализации — это новый модуль, а не правка
 * вызывающего кода.
 *
 * Что порт сознательно не умеет: он не знает ни о профиле, ни о ступенях, ни о
 * типах отчёта. На вход — текст задания и текст данных, на выход — текст модели и
 * расход токенов. Всё продуктовое знание живёт выше, в `prompt.ts` и `validator.ts`.
 */

/**
 * Цена модели. В копейках за миллион токенов: целые числа вместо копеечных
 * дробей, потому что предел себестоимости профиля тоже целый.
 */
export interface TokenPricing {
  inputKopecksPerMillion: number;
  outputKopecksPerMillion: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerationRequest {
  /**
   * Инструкция модели. Собрана из контента и пользовательского текста не
   * содержит: пользовательский текст приходит отдельным полем.
   */
  instruction: string;
  /** Данные задания вместе с изолированным пользовательским текстом. */
  data: string;
  /** Ожидаемая форма ответа. `json` означает машинный конверт из `output.ts`. */
  expects: "текст" | "json";
  maxOutputTokens: number;
  /** 0 — детерминированная выдача. Разбор не сочинение, разброс здесь не нужен. */
  temperature: number;
}

export interface GenerationResult {
  text: string;
  usage: TokenUsage;
  /** Модель, которая ответила: нужна журналу стоимости на стороне сервера. */
  model: string;
}

/** Почему вызов не удался. От вида зависит, повторять ли попытку. */
export type GenerationFailure =
  /** Сеть, таймаут, 5xx, превышение частоты у провайдера. */
  | "временный отказ"
  /** Ключ, права, неверный запрос, отказ модели: повтор ничего не изменит. */
  | "постоянный отказ";

export class GenerationError extends Error {
  constructor(
    readonly failure: GenerationFailure,
    /** Машинный код без текста ответа провайдера: в журнал не должен попасть ответ. */
    readonly code: string,
  ) {
    super(`llm:${failure}:${code}`);
    this.name = "GenerationError";
  }

  get retryable(): boolean {
    return this.failure === "временный отказ";
  }
}

export interface GenerationProvider {
  /** Устойчивый идентификатор реализации: `fake`, и дальше имя настоящего. */
  readonly id: string;
  readonly model: string;
  readonly pricing: TokenPricing;
  /**
   * Один вызов модели. Обязан прекратиться по `signal`: таймаутом управляет
   * вызывающий, а не провайдер.
   */
  generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult>;
}

/** Стоимость одного вызова в копейках, округление вверх: недосчитать хуже, чем пересчитать. */
export function costOf(usage: TokenUsage, pricing: TokenPricing): number {
  const input = (usage.inputTokens * pricing.inputKopecksPerMillion) / 1_000_000;
  const output = (usage.outputTokens * pricing.outputKopecksPerMillion) / 1_000_000;
  return Math.ceil(input + output);
}

/**
 * Оценка стоимости до вызова. Вход считается по длине запроса, выход — по
 * потолку, который вызывающий сам и задал: предел себестоимости обязан
 * срабатывать до вызова, а не после.
 *
 * Четыре знака на токен — грубая оценка для русского текста. Она нужна не для
 * отчётности, а для того, чтобы предел не пробивался одним крупным заданием.
 */
export function estimateCost(request: GenerationRequest, pricing: TokenPricing): number {
  const inputTokens = Math.ceil((request.instruction.length + request.data.length) / 4);
  return costOf({ inputTokens, outputTokens: request.maxOutputTokens }, pricing);
}
