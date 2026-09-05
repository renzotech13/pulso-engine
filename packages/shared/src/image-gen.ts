// Deliberately not @pulso/shared's own createLogger (pulls in pino) — this
// module is imported directly into apps/web's webpack bundle (not just
// apps/workers'), and Next's bundler doesn't resolve this package's other
// relative "./x.js" imports (pointing at unbuilt .ts source) the way tsc
// does. console.warn avoids that cross-file import entirely.

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Real per-minute rate limits have been hit on this endpoint before; one
// short wait is worth more than failing the piece outright.
const RATE_LIMIT_RETRY_DELAY_MS = 15_000;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message: string };
}

export type ImageAspectRatio = "1:1" | "9:16" | "4:5";

export type ImageGenResult =
  | { ok: true; buffer: Buffer; latencyMs: number }
  | { ok: false; error: string; rateLimited: boolean; latencyMs: number };

export interface ImageGenOptions {
  aspectRatio?: ImageAspectRatio | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestImage(
  apiKey: string,
  prompt: string,
  aspectRatio: ImageAspectRatio | undefined,
): Promise<{ status: number; data: GeminiResponse }> {
  const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(aspectRatio ? { generationConfig: { imageConfig: { aspectRatio } } } : {}),
    }),
  });
  return { status: response.status, data: (await response.json()) as GeminiResponse };
}

/**
 * Like `generateThemedImage` but tells the caller WHY it failed (and how
 * long it took), so the creative agent can decide between a bank photo and
 * the gradient, and can audit every call. Optionally asks for an aspect
 * ratio; if the API rejects that field (shape mismatch on some model
 * versions) the request is repeated once without it rather than failing.
 * On a rate limit (429) or outage (5xx) it waits once and retries once.
 */
export async function generateThemedImageDetailed(prompt: string, options: ImageGenOptions = {}): Promise<ImageGenResult> {
  const startedAt = Date.now();
  const latency = () => Date.now() - startedAt;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not set", rateLimited: false, latencyMs: latency() };

  let aspectRatio = options.aspectRatio;
  let retriedRateLimit = false;

  try {
    for (;;) {
      const { status, data } = await requestImage(apiKey, prompt, aspectRatio);
      const message = data.error?.message ?? "";

      if (status === 400 && aspectRatio && /imageConfig|aspectRatio|aspect_ratio/i.test(message)) {
        aspectRatio = undefined;
        continue;
      }
      if ((status === 429 || status >= 500) && !retriedRateLimit) {
        retriedRateLimit = true;
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        continue;
      }
      if (status < 200 || status >= 300 || data.error) {
        console.warn("gemini image generation failed:", message || `HTTP ${status}`);
        return { ok: false, error: message || `HTTP ${status}`, rateLimited: status === 429, latencyMs: latency() };
      }

      const imagePart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
      if (!imagePart?.inlineData) {
        console.warn("gemini response had no inline image data for prompt:", prompt);
        return { ok: false, error: "no inline image data in response", rateLimited: false, latencyMs: latency() };
      }
      return { ok: true, buffer: Buffer.from(imagePart.inlineData.data, "base64"), latencyMs: latency() };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("gemini image generation request failed:", error);
    return { ok: false, error, rateLimited: false, latencyMs: latency() };
  }
}

/**
 * Thin wrapper kept for the callers that only ever needed a Buffer (the
 * dashboard's per-slide regenerate and the CLI scripts). See
 * `generateThemedImageDetailed` for the reasoning behind the retries.
 */
export async function generateThemedImage(prompt: string): Promise<Buffer | null> {
  const result = await generateThemedImageDetailed(prompt);
  return result.ok ? result.buffer : null;
}
