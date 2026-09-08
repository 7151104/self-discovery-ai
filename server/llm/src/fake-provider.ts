/**
 * Поддельный провайдер (E4-01).
 *
 * Своя реализация, без зависимостей и без сети: тесты слоя не имеют права
 * зависеть ни от ключа, ни от интернета. Он же нужен для сквозных прогонов
 * сервера, пока настоящий провайдер не назван.
 *
 * Что он умеет, кроме ответа: отдавать заготовленные ответы по очереди, падать
 * заданным отказом, зависать до прекращения по `signal` и вести журнал вызовов.
 * Без этого не проверить ни повторы, ни таймауты, ни предел стоимости.
 */

import { GenerationError, type GenerationProvider, type GenerationRequest, type GenerationResult, type TokenPricing } from "./provider.js";

/** Один заготовленный ход провайдера. */
export type FakeTurn =
  /** Ответить этим текстом. */
  | { kind: "ответ"; text: string; usage?: { inputTokens: number; outputTokens: number } }
  /** Упасть отказом. */
  | { kind: "отказ"; failure: "временный отказ" | "постоянный отказ"; code?: string }
  /** Зависнуть: завершится только прекращением по `signal`. */
  | { kind: "зависание" };

export interface FakeProviderOptions {
  /** Ходы по очереди. Когда закончились — берётся последний. */
  turns: FakeTurn[];
  pricing?: TokenPricing;
  model?: string;
}

/**
 * Цена по умолчанию — ноль: у подделки нет прайса, а выдуманное число в тестах
 * читалось бы как настоящая себестоимость. Тесты предела задают цену явно.
 */
const FREE: TokenPricing = { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 };

export class FakeProvider implements GenerationProvider {
  readonly id = "fake";
  readonly model: string;
  readonly pricing: TokenPricing;

  /** Все вызовы в порядке поступления: тест смотрит, что ушло в модель. */
  readonly calls: GenerationRequest[] = [];

  private readonly turns: FakeTurn[];
  private index = 0;

  constructor(options: FakeProviderOptions) {
    if (!options.turns.length) throw new Error("FakeProvider: не задано ни одного хода");
    this.turns = [...options.turns];
    this.pricing = options.pricing ?? FREE;
    this.model = options.model ?? "fake-1";
  }

  /** Сколько раз провайдера вызвали. */
  get callCount(): number {
    return this.calls.length;
  }

  async generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult> {
    this.calls.push(request);
    const turn = this.turns[Math.min(this.index, this.turns.length - 1)]!;
    this.index += 1;

    if (turn.kind === "отказ") throw new GenerationError(turn.failure, turn.code ?? "подделка");

    if (turn.kind === "зависание") {
      return await new Promise<GenerationResult>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new GenerationError("временный отказ", "прекращено"));
          return;
        }
        signal.addEventListener("abort", () => reject(new GenerationError("временный отказ", "прекращено")), {
          once: true,
        });
      });
    }

    return {
      text: turn.text,
      usage: turn.usage ?? {
        inputTokens: Math.ceil((request.instruction.length + request.data.length) / 4),
        outputTokens: Math.ceil(turn.text.length / 4),
      },
      model: this.model,
    };
  }
}

/** Провайдер, который всегда отвечает одним и тем же текстом. */
export const answering = (text: string, options: Omit<FakeProviderOptions, "turns"> = {}): FakeProvider =>
  new FakeProvider({ ...options, turns: [{ kind: "ответ", text }] });
