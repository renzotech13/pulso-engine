// Deliberately not @pulso/shared's own createLogger (pulls in pino) — this
// module is imported directly into apps/web's webpack bundle (not just
// apps/workers'), and Next's bundler doesn't resolve this package's other
// relative "./x.js" imports (pointing at unbuilt .ts source) the way tsc
// does. console.warn avoids that cross-file import entirely.

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
 * Generates an image from a text prompt via the Gemini API. Reads
 * process.env.GEMINI_API_KEY directly instead of @pulso/shared's own
 * loadConfig() — that function requires REDIS_URL/LMSTUDIO_MODEL (worker-only
 * env vars), which would make this unusable from apps/web, the other real
 * caller (per-slide carousel regeneration from the dashboard).
 *
 * Never throws: no configured key, a network error, or a response shape that
 * doesn't match what's expected all just return null, and the caller falls
 * back to the plain gradient background (or, from the dashboard, shows an
 * error toast) exactly like before this existed.
 */
export async function generateThemedImage(prompt: string): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );

    const data = (await response.json()) as GeminiResponse;
    if (!response.ok || data.error) {
      console.warn("gemini image generation failed:", data.error?.message ?? response.statusText);
      return null;
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
    if (!imagePart?.inlineData) {
      console.warn("gemini response had no inline image data for prompt:", prompt);
      return null;
    }

    return Buffer.from(imagePart.inlineData.data, "base64");
  } catch (err) {
    console.warn("gemini image generation request failed:", err);
    return null;
  }
}
