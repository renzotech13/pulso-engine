import { loadConfig } from "@pulso/shared/config";
import { createLogger } from "@pulso/shared/logger";

const logger = createLogger({ agent: "image-gen" });

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message: string };
}

/**
 * Generates an image from a text prompt via the Gemini API — the fallback
 * for when there's no catalog photo to composite (pickProductPhoto in
 * creative-helpers.ts came up empty). Never throws: no configured key, a
 * network error, or a response shape that doesn't match what's expected all
 * just return null, and the caller falls back to the plain gradient
 * background exactly like it did before this existed. Not yet verified
 * against a real API key — if Gemini's actual response shape differs, this
 * is the one place that needs adjusting.
 */
export async function generateThemedImage(prompt: string): Promise<Buffer | null> {
  const config = loadConfig();
  if (!config.GEMINI_API_KEY) return null;

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );

    const data = (await response.json()) as GeminiResponse;
    if (!response.ok || data.error) {
      logger.warn({ err: data.error?.message ?? response.statusText }, "gemini image generation failed");
      return null;
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
    if (!imagePart?.inlineData) {
      logger.warn({ prompt }, "gemini response had no inline image data");
      return null;
    }

    return Buffer.from(imagePart.inlineData.data, "base64");
  } catch (err) {
    logger.warn({ err }, "gemini image generation request failed");
    return null;
  }
}
