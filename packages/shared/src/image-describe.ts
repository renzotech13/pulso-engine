// Gemini VISION (image understanding), as opposed to image-gen.ts which is
// image GENERATION. Same key, different model and quota. Reads
// process.env.GEMINI_API_KEY directly for the same reason image-gen.ts does,
// and keeps no relative imports so apps/web can bundle it if it ever needs to.

// An ALIAS, not a pinned version: gemini-2.5-flash was pinned here and
// Google retired it for new keys mid-flight, which burned every photo's
// retry budget before anyone noticed. The alias tracks whatever the current
// flash is, so tagging keeps working across those rotations. Measured
// against the flash-lite tiers on real bank photos it was also the only one
// that reliably produced the rubro-topic tags this whole design depends on
// ("sunat", "impuestos") instead of only visible-object ones; it is ~3x
// slower, which is irrelevant for a once-per-photo job.
const GEMINI_VISION_MODEL = "gemini-flash-latest";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 40;

export interface BankPhotoDescription {
  description: string;
  tags: string[];
  hasPeople: boolean;
  orientation: "landscape" | "portrait" | "square";
}

export type DescribeResult =
  | { ok: true; value: BankPhotoDescription; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; latencyMs: number };

interface GeminiTextResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message: string };
}

// The two tag families matter: visible things ("emprendedora", "taller") let
// a photo match a scene, but MARKETING topics of the rubro ("formalizacion",
// "sunat") are what let "RUC 10 vs RUC 20" find a photo at all — that
// semantic step happens here, once, instead of at every post with the weak
// local model.
function buildPrompt(rubro: string): string {
  return [
    `Describe esta foto para el banco de imágenes de marketing de un negocio peruano del rubro "${rubro}". La foto irá de fondo en publicaciones de Facebook/Instagram y hay que poder elegirla según el tema de cada publicación.`,
    `Devuelve JSON con:`,
    `- "description": 1 o 2 oraciones en español, concretas y literales: quién aparece (edad aproximada, rol que sugiere), qué hace, dónde está, qué objetos se ven, ambiente.`,
    `- "tags": entre 10 y 16 etiquetas cortas en español, en minúsculas, sin tildes, en singular. Mezcla DOS tipos: (a) lo visible: personas, lugar, objetos, acción (ej. "emprendedora", "taller", "laptop", "calculadora", "documento", "mercado", "tienda", "oficina", "reunion", "cliente"); (b) temas de marketing del rubro "${rubro}" para los que esta foto encaja bien (ej. para contabilidad: "formalizacion", "impuestos", "sunat", "ruc", "planilla", "factura", "ventas", "ahorro", "emprendimiento", "orden", "tranquilidad"). Nada de etiquetas genéricas como "foto", "imagen", "persona", "negocio".`,
    `- "hasPeople": true si hay al menos una persona reconocible.`,
    `- "orientation": "landscape", "portrait" o "square" según la proporción real de la imagen.`,
    `Responde solo con el JSON pedido.`,
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    description: { type: "STRING" },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    hasPeople: { type: "BOOLEAN" },
    orientation: { type: "STRING", enum: ["landscape", "portrait", "square"] },
  },
  required: ["description", "tags", "hasPeople", "orientation"],
};

/** Same normalization the ranker applies to query words, so tags and queries agree. */
export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9ñ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH);
}

export function normalizeTags(tags: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Describes one bank photo. Never throws: every failure comes back as
 * `{ ok: false }` with `retryable` telling the caller whether trying again
 * later makes sense (rate limit / outage) or not (bad key, oversized file,
 * a response the model refused to shape).
 */
export async function describeBankPhoto(input: { imageUrl: string; rubro: string }): Promise<DescribeResult> {
  const startedAt = Date.now();
  const latency = () => Date.now() - startedAt;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not set", retryable: false, latencyMs: latency() };

  let mimeType = "image/jpeg";
  let base64: string;
  try {
    const imageResponse = await fetch(input.imageUrl);
    if (!imageResponse.ok) {
      return { ok: false, error: `image fetch failed: ${imageResponse.status}`, retryable: imageResponse.status >= 500, latencyMs: latency() };
    }
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image too large (${bytes.byteLength} bytes)`, retryable: false, latencyMs: latency() };
    }
    mimeType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim() || mimeType;
    base64 = bytes.toString("base64");
  } catch (err) {
    return { ok: false, error: `image fetch error: ${err instanceof Error ? err.message : String(err)}`, retryable: true, latencyMs: latency() };
  }

  try {
    const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType, data: base64 } }, { text: buildPrompt(input.rubro) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
      }),
    });
    const data = (await response.json()) as GeminiTextResponse;
    if (!response.ok || data.error) {
      const retryable = response.status === 429 || response.status >= 500;
      return { ok: false, error: data.error?.message ?? `HTTP ${response.status}`, retryable, latencyMs: latency() };
    }

    const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!text) return { ok: false, error: "no text part in vision response", retryable: true, latencyMs: latency() };

    const parsed = JSON.parse(text) as Partial<BankPhotoDescription> & { tags?: unknown[] };
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    const tags = normalizeTags(Array.isArray(parsed.tags) ? parsed.tags : []);
    const orientation =
      parsed.orientation === "portrait" || parsed.orientation === "square" ? parsed.orientation : "landscape";
    if (!description || tags.length === 0) {
      return { ok: false, error: "vision response missing description or tags", retryable: true, latencyMs: latency() };
    }
    return { ok: true, value: { description, tags, hasPeople: Boolean(parsed.hasPeople), orientation }, latencyMs: latency() };
  } catch (err) {
    return { ok: false, error: `vision request error: ${err instanceof Error ? err.message : String(err)}`, retryable: true, latencyMs: latency() };
  }
}
