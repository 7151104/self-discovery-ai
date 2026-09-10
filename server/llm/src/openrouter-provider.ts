/**
 * Настоящий адаптер провайдера: OpenRouter + Claude Sonnet 5 (вопрос 5).
 *
 * Задача продукта — короткий литературный JSON на «ты», а не кодинг. Флагманы
 * вроде Fable 5.1 здесь не выигрывают качеством и съедают предел 30 ₽ на
 * повторах. Sonnet 5 на OpenRouter — $2 / $10 за миллион токенов; при курсе
 * 100 ₽/$ это 20 000 / 100 000 копеек за миллион. Мышление модели по умолчанию
 * на Sonnet 5 включено и дорогое: для машинного конверта его выключаем.
 *
 * Шлюз один, модель меняется переменной. Пин `Anthropic` без подмены: у того же
 * слага на Bedrock мышление выключить нельзя. Тесты подставляют `fetch` и в
 * сеть не ходят. Ключ в репозитории не лежит: пустой — отказ на старте.
 */

import {
  GenerationError,
  type GenerationFailure,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type TokenPricing,
  type TokenUsage,
} from "./provider.js";

/** Слаг на OpenRouter. Версию `:latest` не берём: смена модели должна быть явной. */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5";

/**
 * Прайс Sonnet 5, если переменные цены не заданы. Курс заложен 100 ₽ за доллар:
 * пересчитать безопаснее, чем недосчитать и пробить предел профиля.
 */
export const OPENROUTER_DEFAULT_PRICING: TokenPricing = {
  inputKopecksPerMillion: 20_000,
  outputKopecksPerMillion: 100_000,
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class MissingLlmApiKey extends Error {
  constructor() {
    super("llm:missing-api-key");
    this.name = "MissingLlmApiKey";
  }
}

export interface OpenRouterProviderOptions {
  apiKey: string;
  model?: string;
  pricing?: TokenPricing;
  fetch?: typeof fetch;
  endpoint?: string;
}

type ChatMessage = { role: string; content?: unknown };
type ChatChoice = { message?: ChatMessage; finish_reason?: string | null };
type ChatUsage = { prompt_tokens?: number; completion_tokens?: number };
type ChatResponse = { choices?: ChatChoice[]; usage?: ChatUsage; error?: { message?: string } };

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

function statusFailure(status: number): { failure: GenerationFailure; code: string } {
  if (status === 429 || status === 408 || status === 409 || status >= 500) {
    return { failure: "временный отказ", code: `http-${status}` };
  }
  return { failure: "постоянный отказ", code: `http-${status}` };
}

function contentOf(message: ChatMessage | undefined): string {
  const raw = message?.content;
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function tokensOf(value: number | undefined, fallbackText: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.ceil(value);
  return Math.max(1, Math.ceil(fallbackText.length / 4));
}

function pricingOf(pricing: TokenPricing | undefined): TokenPricing {
  if (!pricing) return OPENROUTER_DEFAULT_PRICING;
  if (pricing.inputKopecksPerMillion === 0 && pricing.outputKopecksPerMillion === 0) {
    return OPENROUTER_DEFAULT_PRICING;
  }
  return pricing;
}

/**
 * Пин только у моделей Anthropic: чужой слаг с пином Anthropic не вызовется.
 * Подмены дешёвым клоном нет; запасной Bedrock не берём — там мышление не гасится.
 */
function providerPin(model: string): Record<string, unknown> | undefined {
  if (!model.startsWith("anthropic/")) return undefined;
  return { order: ["Anthropic"], allow_fallbacks: false, require_parameters: true };
}

export class OpenRouterProvider implements GenerationProvider {
  readonly id = "openrouter";
  readonly model: string;
  readonly pricing: TokenPricing;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;

  constructor(options: OpenRouterProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new MissingLlmApiKey();
    this.#apiKey = apiKey;
    this.model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
    this.pricing = pricingOf(options.pricing);
    this.#fetch = options.fetch ?? fetch;
    this.#endpoint = options.endpoint ?? ENDPOINT;
  }

  async generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult> {
    if (signal.aborted) throw new GenerationError("временный отказ", "прекращено");

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: request.instruction },
        { role: "user", content: request.data },
      ],
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      reasoning: { enabled: false, exclude: true },
    };
    if (request.expects === "json") body.response_format = { type: "json_object" };
    const pin = providerPin(this.model);
    if (pin) body.provider = pin;

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://wordpop.ru",
          "X-Title": "Smart Basket",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw new GenerationError("временный отказ", "таймаут");
      throw new GenerationError("временный отказ", "сеть");
    }

    if (!response.ok) {
      const mapped = statusFailure(response.status);
      throw new GenerationError(mapped.failure, mapped.code);
    }

    let payload: ChatResponse;
    try {
      payload = (await response.json()) as ChatResponse;
    } catch {
      throw new GenerationError("временный отказ", "json");
    }

    if (payload.error) throw new GenerationError("постоянный отказ", "отказ");

    const choice = payload.choices?.[0];
    const text = contentOf(choice?.message).trim();
    if (!text) throw new GenerationError("постоянный отказ", "пусто");

    const usage: TokenUsage = {
      inputTokens: tokensOf(payload.usage?.prompt_tokens, request.instruction + request.data),
      outputTokens: tokensOf(payload.usage?.completion_tokens, text),
    };

    return { text, usage, model: this.model };
  }
}

/** Сборка из реестра: пустой ключ — отказ на старте, а не при первом вызове. */
export function createOpenRouterProvider(options: OpenRouterProviderOptions): OpenRouterProvider {
  return new OpenRouterProvider(options);
}
