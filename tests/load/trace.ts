/**
 * Обёртка провайдера: логические такты и число одновременных вызовов.
 *
 * Настоящего времени нет: каждый вызов — один такт. Так проверяется, что
 * ожидание растёт как позиция в очереди, а не взрывается параллелизмом.
 *
 * Типы порта скопированы формой, без импорта `server/llm/src`: сборка тестов
 * не должна расширять `rootDir` на сервер.
 */

export interface GenerationRequest {
  instruction: string;
  data: string;
  expects: "текст" | "json";
  maxOutputTokens: number;
  temperature: number;
}

export interface GenerationResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface GenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly pricing: { inputKopecksPerMillion: number; outputKopecksPerMillion: number };
  generate: (request: GenerationRequest, signal: AbortSignal) => Promise<GenerationResult>;
}

export interface TraceStats {
  /** Максимум одновременных вызовов провайдера за весь прогон. */
  maxInflight: number;
  /** Такт старта каждого вызова в порядке поступления. */
  startedAtTick: number[];
}

export interface TracingProvider extends GenerationProvider {
  readonly stats: TraceStats;
}

export function tracingProvider(inner: GenerationProvider): TracingProvider {
  let inflight = 0;
  let tick = 0;
  let maxInflight = 0;
  const startedAtTick: number[] = [];
  const stats: TraceStats = {
    get maxInflight() {
      return maxInflight;
    },
    startedAtTick,
  };

  return {
    id: inner.id,
    model: inner.model,
    pricing: inner.pricing,
    stats,
    async generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult> {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      startedAtTick.push(tick);
      tick += 1;
      try {
        return await inner.generate(request, signal);
      } finally {
        inflight -= 1;
      }
    },
  };
}
