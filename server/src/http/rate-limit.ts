/**
 * Ограничение частоты (E3-10).
 *
 * Скользящее окно в памяти процесса: ни зависимости, ни таблицы, ни внешнего
 * хранилища. Ограничение решения записано в журнале — при втором процессе
 * счётчики придётся вынести наружу; пока процесс один, это лишняя подсистема.
 *
 * Лимитер стоит до обработчика, поэтому превышение не доходит до базы и не
 * создаёт записей.
 */

export type Bucket = "createProfile" | "portion" | "state" | "miss";

export interface BucketRule {
  /** Сколько запросов разрешено в окне. */
  limit: number;
  /** Длина окна в миллисекундах. */
  windowMs: number;
}

export type RateRules = Record<Bucket, BucketRule>;

export interface Decision {
  allowed: boolean;
  /** Через сколько миллисекунд освободится место. */
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly rules: RateRules,
    private readonly enabled: boolean,
  ) {}

  /**
   * Учитывает попытку и говорит, пропускать ли её.
   * Ключ — корзина плюс клиент: у разных клиентов счётчики не общие.
   */
  take(bucket: Bucket, client: string, at: number = Date.now()): Decision {
    if (!this.enabled) return { allowed: true, retryAfterMs: 0 };

    const rule = this.rules[bucket];
    const key = `${bucket}:${client}`;
    const from = at - rule.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((moment) => moment > from);

    if (recent.length >= rule.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? at;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - at) };
    }

    recent.push(at);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Освобождает память от клиентов, которые давно не приходили. */
  sweep(at: number = Date.now()): void {
    const longest = Math.max(...Object.values(this.rules).map((rule) => rule.windowMs));
    for (const [key, moments] of this.hits) {
      const alive = moments.filter((moment) => moment > at - longest);
      if (alive.length) this.hits.set(key, alive);
      else this.hits.delete(key);
    }
  }
}
