/**
 * Адаптер OpenRouter. Сети нет: каждый вызов идёт в подставленный `fetch`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GenerationError, type GenerationRequest } from "./provider.js";
import { createGenerationProvider, knownLlmProviders, UnknownLlmProvider } from "./registry.js";
import {
  DEFAULT_OPENROUTER_MODEL,
  MissingLlmApiKey,
  OPENROUTER_DEFAULT_PRICING,
  OpenRouterProvider,
} from "./openrouter-provider.js";

const REQUEST: GenerationRequest = {
  instruction: "инструкция",
  data: "данные",
  expects: "json",
  maxOutputTokens: 400,
  temperature: 0,
};

const OK_BODY = {
  choices: [{ message: { role: "assistant", content: '{"текст":"ок"}' } }],
  usage: { prompt_tokens: 11, completion_tokens: 7 },
};

type Captured = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capturingFetch(handler: (captured: Captured) => Promise<Response> | Response): {
  calls: Captured[];
  fetch: typeof fetch;
} {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: (async (input, init) => {
      const captured = { url: String(input), init: init ?? {} };
      calls.push(captured);
      return handler(captured);
    }) as typeof fetch,
  };
}

test("реестр знает заглушку и OpenRouter и отказывается от чужого имени", () => {
  assert.deepEqual(knownLlmProviders(), ["stub", "openrouter"]);
  assert.throws(
    () =>
      createGenerationProvider({
        provider: "нет-такого",
        pricing: { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 },
        model: "",
      }),
    UnknownLlmProvider,
  );
});

test("без ключа адаптер не собирается", () => {
  assert.throws(
    () =>
      createGenerationProvider({
        provider: "openrouter",
        pricing: OPENROUTER_DEFAULT_PRICING,
        model: "",
      }),
    MissingLlmApiKey,
  );
  assert.throws(() => new OpenRouterProvider({ apiKey: "   " }), MissingLlmApiKey);
});

test("пустая модель берёт Sonnet 5, нулевая цена — опубликованный прайс", () => {
  const provider = createGenerationProvider({
    provider: "openrouter",
    apiKey: "test-key",
    model: "",
    pricing: { inputKopecksPerMillion: 0, outputKopecksPerMillion: 0 },
  });
  assert.equal(provider.id, "openrouter");
  assert.equal(provider.model, DEFAULT_OPENROUTER_MODEL);
  assert.deepEqual(provider.pricing, OPENROUTER_DEFAULT_PRICING);
});

test("заданная цена и модель не подменяются", () => {
  const provider = new OpenRouterProvider({
    apiKey: "test-key",
    model: "anthropic/claude-sonnet-4.6",
    pricing: { inputKopecksPerMillion: 3_000, outputKopecksPerMillion: 15_000 },
  });
  assert.equal(provider.model, "anthropic/claude-sonnet-4.6");
  assert.equal(provider.pricing.inputKopecksPerMillion, 3_000);
});

test("успешный вызов: роли, JSON-формат, мышление выключено, пин Anthropic", async () => {
  const fake = capturingFetch(() => jsonResponse(200, OK_BODY));
  const provider = new OpenRouterProvider({ apiKey: "secret-key", fetch: fake.fetch });
  const result = await provider.generate(REQUEST, new AbortController().signal);

  assert.equal(result.text, '{"текст":"ок"}');
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 });
  assert.equal(result.model, DEFAULT_OPENROUTER_MODEL);
  assert.equal(fake.calls.length, 1);
  const { url, init } = fake.calls[0]!;
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal((init.headers as Record<string, string>)["Authorization"], "Bearer secret-key");
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(body.model, DEFAULT_OPENROUTER_MODEL);
  assert.deepEqual(body.messages, [
    { role: "system", content: "инструкция" },
    { role: "user", content: "данные" },
  ]);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.reasoning, { enabled: false, exclude: true });
  assert.deepEqual(body.provider, { order: ["Anthropic"], allow_fallbacks: false, require_parameters: true });
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 400);
});

test("текстовый выход не требует json_object, чужой слаг не пинит Anthropic", async () => {
  const fake = capturingFetch(() => jsonResponse(200, OK_BODY));
  const provider = new OpenRouterProvider({
    apiKey: "test-key",
    model: "openai/gpt-4.1",
    fetch: fake.fetch,
  });
  await provider.generate({ ...REQUEST, expects: "текст" }, new AbortController().signal);
  const body = JSON.parse(String(fake.calls[0]!.init.body)) as Record<string, unknown>;
  assert.equal("response_format" in body, false);
  assert.equal("provider" in body, false);
});

test("429 и 503 — временный отказ, 401 — постоянный", async () => {
  const retryable = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: capturingFetch(() => jsonResponse(429, {})).fetch,
  });
  await assert.rejects(() => retryable.generate(REQUEST, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.failure, "временный отказ");
    assert.equal(error.code, "http-429");
    assert.equal(error.retryable, true);
    return true;
  });

  const down = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: capturingFetch(() => jsonResponse(503, {})).fetch,
  });
  await assert.rejects(() => down.generate(REQUEST, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, "http-503");
    assert.equal(error.retryable, true);
    return true;
  });

  const denied = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: capturingFetch(() => jsonResponse(401, {})).fetch,
  });
  await assert.rejects(() => denied.generate(REQUEST, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.failure, "постоянный отказ");
    assert.equal(error.code, "http-401");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("обрыв сети — временный, пустой ответ — постоянный", async () => {
  const net = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: capturingFetch(() => {
      throw new TypeError("fetch failed");
    }).fetch,
  });
  await assert.rejects(() => net.generate(REQUEST, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, "сеть");
    assert.equal(error.retryable, true);
    return true;
  });

  const empty = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: capturingFetch(() => jsonResponse(200, { choices: [{ message: { content: "  " } }] })).fetch,
  });
  await assert.rejects(() => empty.generate(REQUEST, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, "пусто");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("прекращённый сигнал не идёт в сеть и даёт временный отказ", async () => {
  let called = false;
  const provider = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: (async () => {
      called = true;
      return jsonResponse(200, OK_BODY);
    }) as typeof fetch,
  });
  const signal = AbortSignal.abort();
  await assert.rejects(() => provider.generate(REQUEST, signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, "прекращено");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(called, false);
});

test("аборт во время fetch раскладывается как таймаут", async () => {
  const provider = new OpenRouterProvider({
    apiKey: "test-key",
    fetch: (async (_input, init) => {
      const error = new Error("aborted");
      error.name = "AbortError";
      if (init?.signal?.aborted) throw error;
      throw error;
    }) as typeof fetch,
  });
  await assert.rejects(() => provider.generate(REQUEST, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, "таймаут");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("без usage токены оцениваются по длине, ключ в текст ошибки не попадает", async () => {
  const provider = new OpenRouterProvider({
    apiKey: "super-secret-value",
    fetch: capturingFetch(() => jsonResponse(200, { choices: [{ message: { content: "абвг" } }] })).fetch,
  });
  const result = await provider.generate(REQUEST, new AbortController().signal);
  assert.equal(result.usage.inputTokens, Math.ceil((REQUEST.instruction.length + REQUEST.data.length) / 4));
  assert.equal(result.usage.outputTokens, 1);
  try {
    await new OpenRouterProvider({
      apiKey: "super-secret-value",
      fetch: capturingFetch(() => jsonResponse(403, { error: { message: "nope" } })).fetch,
    }).generate(REQUEST, new AbortController().signal);
    assert.fail("ожидался отказ");
  } catch (error) {
    assert.ok(error instanceof GenerationError);
    assert.equal(String(error).includes("super-secret-value"), false);
  }
});
