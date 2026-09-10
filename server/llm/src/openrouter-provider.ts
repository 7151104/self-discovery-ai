/**
 * OpenAI-совместимый адаптер (вопрос 5, уточнение по доступности из РФ).
 *
 * Anthropic Console из России требует заграничный паспорт и фото — основатель
 * это уже проверил. OpenRouter с российским биллингом с июня 2026 закрывает
 * тройку OpenAI / Anthropic / Google. Поэтому рабочий контур — не аккаунт
 * Claude, а любой шлюз с тем же HTTP, что у Chat Completions: прямой OpenAI
 * или уполномоченный посредник. Модель по умолчанию у `openai` — `gpt-5`:
 * литературный JSON на «ты», $1.25 / $10 за миллион, мышление выключено.
 *
 * `openrouter` остаётся в реестре для тех, у кого шлюз доступен. Человеку на
 * сайте VPN не нужен: браузер говорит только с нашим сервером. Тесты
 * подставляют `fetch` и в сеть не ходят. Ключ в репозитории не лежит.
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

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** Слаг на OpenRouter. Версию `:latest` не берём: смена модели должна быть явной. */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5";

/** Имя у прямого OpenAI и у совместимых шлюзов. */
export const DEFAULT_OPENAI_MODEL = "gpt-5";

/** Прайс Sonnet 5: $2 / $10 при 100 ₽/$. */
export const OPENROUTER_DEFAULT_PRICING: TokenPricing = {
  inputKopecksPerMillion: 20_000,
  outputKopecksPerMillion: 100_000,
};

/** Прайс GPT-5: $1.25 / $10 при 100 ₽/$. */
export const OPENAI_DEFAULT_PRICING: TokenPricing = {
  inputKopecksPerMillion: 12_500,
  outputKopecksPerMillion: 100_000,
};

export class MissingLlmApiKey extends Error {
  constructor() {
    super("llm:missing-api-key");
    this.name = "MissingLlmApiKey";
  }
}

export interface OpenRouterProviderOptions {
  apiKey: string;
  /** `openrouter` или `openai`: пишется в журнал вызовов. */
  id?: "openrouter" | "openai";
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

function pricingOf(pricing: TokenPricing | undefined, fallback: TokenPricing): TokenPricing {
  if (!pricing) return fallback;
  if (pricing.inputKopecksPerMillion === 0 && pricing.outputKopecksPerMillion === 0) return fallback;
  return pricing;
}

function isOpenRouterEndpoint(endpoint: string): boolean {
  return endpoint.includes("openrouter.ai");
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("anthropic/") || model.startsWith("claude");
}

/**
 * Мышление у Sonnet 5 и у GPT-5 по умолчанию включено и дорогое.
 * Для машинного конверта его гасим: иначе JSON и предел 30 ₽ разъедутся.
 */
function reasoningOf(model: string): Record<string, unknown> {
  if (isAnthropicModel(model)) return { enabled: false, exclude: true };
  return { effort: "none", exclude: true };
}

/**
 * Пин Anthropic только на OpenRouter и только у слага Anthropic: на Bedrock
 * мышление не гасится, а чужой слаг с этим пином просто не вызовется.
 */
function providerPin(model: string, endpoint: string): Record<string, unknown> | undefined {
  if (!isOpenRouterEndpoint(endpoint) || !isAnthropicModel(model)) return undefined;
  return { order: ["Anthropic"], allow_fallbacks: false, require_parameters: true };
}

export class OpenRouterProvider implements GenerationProvider {
  readonly id: "openrouter" | "openai";
  readonly model: string;
  readonly pricing: TokenPricing;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;

  constructor(options: OpenRouterProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new MissingLlmApiKey();
    this.#apiKey = apiKey;
    this.id = options.id ?? "openrouter";
    const fallbackModel = this.id === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_OPENROUTER_MODEL;
    const fallbackPricing = this.id === "openai" ? OPENAI_DEFAULT_PRICING : OPENROUTER_DEFAULT_PRICING;
    const fallbackEndpoint = this.id === "openai" ? OPENAI_ENDPOINT : OPENROUTER_ENDPOINT;
    this.model = options.model?.trim() || fallbackModel;
    this.pricing = pricingOf(options.pricing, fallbackPricing);
    this.#fetch = options.fetch ?? fetch;
    this.#endpoint = options.endpoint?.trim() || fallbackEndpoint;
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
      reasoning: reasoningOf(this.model),
    };
    if (request.expects === "json") body.response_format = { type: "json_object" };
    const pin = providerPin(this.model, this.#endpoint);
    if (pin) body.provider = pin;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
    };
    if (isOpenRouterEndpoint(this.#endpoint)) {
      headers["HTTP-Referer"] = "https://wordpop.ru";
      headers["X-Title"] = "Smart Basket";
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers,
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

export function createOpenRouterProvider(options: OpenRouterProviderOptions): OpenRouterProvider {
  return new OpenRouterProvider({ ...options, id: options.id ?? "openrouter" });
}

export function createOpenAiProvider(options: OpenRouterProviderOptions): OpenRouterProvider {
  return new OpenRouterProvider({ ...options, id: "openai" });
}
