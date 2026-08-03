import OpenAI from "openai";
import type { z } from "zod";
import { loadConfig } from "./config.js";
import { AppError } from "./errors.js";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export class LlmOutputError extends AppError {
  constructor(
    message: string,
    public readonly usage: LlmUsage,
    cause?: unknown,
  ) {
    super(message, "LLM_OUTPUT_INVALID", cause);
    this.name = "LlmOutputError";
  }
}

let client: OpenAI | undefined;

// A hung local model must not hang the agent (and its BullMQ concurrency
// slot) forever — fail eventually so the job can retry/error out. Measured
// against gemma-4-e4b on real prompts: a reasoning-heavy completion can take
// ~180s (759 of 841 completion tokens were the "thinking" trace), so 120s
// was cutting off completions that were about to succeed. 4 minutes leaves
// headroom above that observed worst case.
const REQUEST_TIMEOUT_MS = 240_000;

function getClient(): OpenAI {
  if (!client) {
    const config = loadConfig();
    // LM Studio doesn't check the key, but the SDK requires a non-empty string.
    client = new OpenAI({
      baseURL: config.LMSTUDIO_BASE_URL,
      apiKey: "lm-studio",
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0, // callLlmStructured already retries on validation failure
    });
  }
  return client;
}

/**
 * Local models wrap JSON in prose or markdown fences far more often than a
 * hosted frontier model does, even when told not to — pull the first {...}
 * block out instead of assuming `content` is pure JSON.
 */
function extractJson(text: string): string {
  const withoutFences = text.replace(/```(?:json)?/gi, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return withoutFences;
  return withoutFences.slice(start, end + 1);
}

// Reasoning-capable local models (e.g. Gemma) spend a chunk of the budget on
// an internal "thinking" trace (returned separately as reasoning_content)
// before ever writing the final answer. Without a generous cap, a request
// has no natural stopping point and can run for minutes; with too small a
// cap, generation gets cut off mid-thought before any content is written at
// all (empty content, finish_reason "length") — 4096 leaves headroom for both.
const DEFAULT_MAX_TOKENS = 4096;

export interface CallLlmStructuredOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Extra attempts after the first, feeding the validation error back to the model. */
  maxRetries?: number;
  /** Overrides LMSTUDIO_MODEL — e.g. a per-agent model from agents_registry. */
  model?: string;
}

export interface CallLlmStructuredResult<T> {
  data: T;
  usage: LlmUsage;
}

async function callLlmStructuredInternal<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  options: CallLlmStructuredOptions,
): Promise<CallLlmStructuredResult<z.infer<S>>> {
  const config = loadConfig();
  const openai = getClient();
  const model = options.model ?? config.LMSTUDIO_MODEL;
  const maxRetries = options.maxRetries ?? 1;

  let lastError: string | undefined;
  let lastUsage: LlmUsage = { promptTokens: 0, completionTokens: 0 };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userContent = lastError
      ? `${prompt}\n\nTu respuesta anterior no calzó con el formato esperado (${lastError}). Responde de nuevo, solo con el JSON, sin texto adicional ni markdown.`
      : prompt;

    const response = await openai.chat.completions.create({
      model,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
        { role: "user" as const, content: userContent },
      ],
    });

    // Free with every response — this is what makes token observability
    // possible without any extra calls to the model.
    lastUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };

    const raw = response.choices[0]?.message.content ?? "";

    try {
      const parsedJson: unknown = JSON.parse(extractJson(raw));
      return { data: schema.parse(parsedJson), usage: lastUsage };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new LlmOutputError(
    `model output failed schema validation after ${maxRetries + 1} attempt(s): ${lastError}`,
    lastUsage,
  );
}

/**
 * Calls the local model (LM Studio) and validates the reply against `schema`.
 * Local models are far less disciplined than a hosted frontier model at
 * strict JSON output, so on a validation failure this retries with the
 * error appended to the prompt before giving up — never lets malformed
 * output reach a caller.
 */
export async function callLlmStructured<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  options: CallLlmStructuredOptions = {},
): Promise<z.infer<S>> {
  const { data } = await callLlmStructuredInternal(prompt, schema, options);
  return data;
}

/**
 * Same as `callLlmStructured`, but also returns token usage — for callers
 * (like the agents_registry-aware wrapper in apps/workers) that need to
 * record it, e.g. for cost/observability tracking.
 */
export async function callLlmStructuredWithUsage<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  options: CallLlmStructuredOptions = {},
): Promise<CallLlmStructuredResult<z.infer<S>>> {
  return callLlmStructuredInternal(prompt, schema, options);
}
