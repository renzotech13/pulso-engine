// Long-form articles for a tenant's own website, as opposed to the short
// social copy the local model writes. Deliberately NOT the local model:
// gemma is fine for a three-paragraph caption but an 800-word piece meant to
// rank on Google is a different job, and Gemini is already paid for.
//
// No relative imports (apps/web may bundle this — see image-gen.ts).

const GEMINI_TEXT_MODEL = "gemini-flash-latest";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Only tags the site's blog template styles. Anything else is stripped.
// `a` is tolerated but never invited: the prompt does not list it, because a
// model asked for links invents URLs that don't exist. If one shows up
// anyway it gets cleaned rather than silently deleted along with its text.
const ALLOWED_TAGS = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "br", "a"]);

export interface ArticleInput {
  businessName: string;
  rubro: string;
  /** The calendar slot's theme — the same idea the social post is about. */
  theme: string;
  /** The social piece's headline, so both read as the same campaign. */
  headline?: string | undefined;
  /** tone_description + voice_training: this IS copy, so the voice applies. */
  brandVoice?: string | undefined;
  /** Phrases the tenant banned; repeated here so the model avoids them up front. */
  bannedPhrases?: readonly string[] | undefined;
  city?: string | undefined;
  websiteUrl?: string | undefined;
}

export interface GeneratedArticle {
  title: string;
  slug: string;
  metaDescription: string;
  bodyHtml: string;
  wordCount: number;
}

export type ArticleResult =
  | { ok: true; value: GeneratedArticle; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; latencyMs: number };

interface GeminiTextResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  error?: { message: string };
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    slug: { type: "STRING" },
    metaDescription: { type: "STRING" },
    bodyHtml: { type: "STRING" },
  },
  required: ["title", "slug", "metaDescription", "bodyHtml"],
};

/** URL-safe, accent-free, hyphenated — this becomes the article's public path. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
}

/**
 * Keeps only the handful of tags the blog template styles, drops every
 * attribute except an href on links, and rejects anything script-ish. The
 * output goes straight into a static page, so treating the model's HTML as
 * untrusted is the whole point.
 */
export function sanitizeArticleHtml(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  return withoutBlocks
    .replace(/<([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (tag !== "a") return `<${tag}>`;
      // Links keep only an http(s) href — no javascript:, no on* handlers.
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(rawAttrs)?.[1] ?? "";
      return /^https?:\/\//i.test(href)
        ? `<a href="${href.replace(/"/g, "&quot;")}" rel="noopener">`
        : "<a>";
    })
    .replace(/<\/([a-zA-Z0-9]+)>/g, (match, rawTag: string) =>
      ALLOWED_TAGS.has(rawTag.toLowerCase()) ? `</${rawTag.toLowerCase()}>` : "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
}

function buildPrompt(input: ArticleInput): string {
  const banned = (input.bannedPhrases ?? []).filter((p) => p.trim());
  return [
    `Escribe un artículo de blog para el sitio web de "${input.businessName}", un negocio peruano del rubro "${input.rubro}"${input.city ? ` en ${input.city}` : ""}.`,
    ``,
    `Tema: ${input.theme}`,
    input.headline ? `La publicación de redes sobre este mismo tema se titula: "${input.headline}". El artículo desarrolla esa idea a fondo; no la repite.` : "",
    ``,
    `QUÉ TIENE QUE SER:`,
    `- Entre 700 y 900 palabras, en español de Perú, tuteando al lector.`,
    `- Útil de verdad: que alguien lo lea completo aunque nunca contrate al negocio. Explica el porqué, no solo el qué.`,
    `- Estructurado para leerse en pantalla: 4 a 6 subtítulos <h2>, párrafos cortos, alguna lista cuando ordene ideas de verdad (no por rellenar).`,
    `- Escrito para buscadores sin sonar a SEO: el tema y sus sinónimos aparecen naturalmente, nunca repetidos a la fuerza.`,
    `- Cierra invitando a escribir o reservar, en una sola frase y sin presionar.`,
    ``,
    `QUÉ NO:`,
    `- No inventes datos, precios, cifras, estudios ni testimonios. Si no lo sabes con certeza, no lo afirmes.`,
    `- No uses la raya "—" (em dash) en ningún texto: separa ideas con punto seguido o coma.`,
    banned.length > 0 ? `- Nunca uses estas frases ni variantes suyas: ${banned.map((p) => `"${p}"`).join(", ")}.` : "",
    `- Nada de "en el mundo actual", "en la era digital" ni aperturas de relleno: entra directo al tema.`,
    ``,
    input.brandVoice ? `VOZ DE LA MARCA (respétala):\n${input.brandVoice}` : "",
    ``,
    `FORMATO DE RESPUESTA (JSON):`,
    `- "title": el título del artículo, máximo 70 caracteres, concreto y sin dos puntos decorativos.`,
    `- "slug": el título en minúsculas, sin tildes, separado por guiones, máximo 60 caracteres.`,
    `- "metaDescription": 150-160 caracteres que resuman el artículo para el resultado de Google.`,
    `- "bodyHtml": el cuerpo en HTML usando SOLO estas etiquetas: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>. Sin <h1> (el título va aparte), sin clases, sin estilos, sin imágenes.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Never throws: a failure comes back as `{ ok: false }` so the caller can
 * decide (retry later, leave the article unwritten) without the social post
 * that triggered it being affected.
 */
export async function generateArticle(input: ArticleInput): Promise<ArticleResult> {
  const startedAt = Date.now();
  const latency = () => Date.now() - startedAt;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not set", retryable: false, latencyMs: latency() };

  try {
    const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7,
          // An 800-word article wrapped in JSON is ~2.5k tokens on its own, and
          // reasoning tokens are billed against this same budget: at 4096 the
          // model spent the allowance thinking and the JSON came back cut off
          // mid-string. Thinking is off (this is drafting, not reasoning) and
          // the ceiling is generous, since being truncated wastes the whole call.
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    const data = (await response.json()) as GeminiTextResponse;
    if (!response.ok || data.error) {
      const retryable = response.status === 429 || response.status >= 500;
      return { ok: false, error: data.error?.message ?? `HTTP ${response.status}`, retryable, latencyMs: latency() };
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.find((p) => p.text)?.text;
    if (!text) return { ok: false, error: "no text part in response", retryable: true, latencyMs: latency() };
    // Says so plainly instead of surfacing the resulting "unterminated string
    // in JSON", which sends whoever reads the log hunting the wrong bug.
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return {
        ok: false,
        error: `generation stopped early (${candidate.finishReason})`,
        retryable: candidate.finishReason === "MAX_TOKENS",
        latencyMs: latency(),
      };
    }

    const parsed = JSON.parse(text) as Partial<GeneratedArticle>;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const bodyHtml = sanitizeArticleHtml(typeof parsed.bodyHtml === "string" ? parsed.bodyHtml : "");
    if (!title || !bodyHtml) {
      return { ok: false, error: "response missing title or body", retryable: true, latencyMs: latency() };
    }

    const wordCount = countWords(bodyHtml);
    // A "long-form article" that came back as three sentences is a failure,
    // not something to publish to a client's website.
    if (wordCount < 300) {
      return { ok: false, error: `article too short (${wordCount} words)`, retryable: true, latencyMs: latency() };
    }

    return {
      ok: true,
      value: {
        title,
        slug: slugify(typeof parsed.slug === "string" && parsed.slug.trim() ? parsed.slug : title),
        metaDescription:
          typeof parsed.metaDescription === "string" ? parsed.metaDescription.trim().slice(0, 300) : "",
        bodyHtml,
        wordCount,
      },
      latencyMs: latency(),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true, latencyMs: latency() };
  }
}
