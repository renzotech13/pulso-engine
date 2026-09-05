/**
 * Pure functions used by the Creative agent — kept separate from creative.ts
 * (which needs the DB/LLM) so the slot→template mapping and brief shaping
 * can be unit tested without a database or a running LM Studio server.
 */

const SLOT_TYPE_TO_TEMPLATE_NAME: Record<string, string> = {
  post: "social-post",
  reel: "reel",
  story: "story-promo",
  carousel: "carousel",
};

/** null for slot types without a template yet — caller must skip, not fail. */
export function templateNameForSlotType(slotType: string): string | null {
  return SLOT_TYPE_TO_TEMPLATE_NAME[slotType] ?? null;
}

export function creativeTypeForTemplateType(templateType: "static" | "video"): "image" | "video" {
  return templateType === "video" ? "video" : "image";
}

export interface VideoEffects {
  hideLogo?: boolean | undefined;
  zoomOutBackground?: boolean | undefined;
  fadeInOverlay?: boolean | undefined;
}

export interface CreativeCopy {
  headline?: string | undefined;
  subheadline?: string | undefined;
  priceLabel?: string | undefined;
  productName?: string | undefined;
  slides?: string[] | undefined;
  caption?: string | undefined;
  videoEffects?: VideoEffects | undefined;
  /** 3-6 loose scene words the copywriter suggests for the background photo. Advisory only. */
  imageKeywords?: string[] | undefined;
}

/**
 * social-post and reel share the same brief shape as the LLM's raw output
 * (headline/subheadline/priceLabel), so it passes through unchanged.
 * story-promo only has one text slot, so headline+subheadline collapse into
 * a single `message`. carousel's copy is already an array (carouselCopySchema
 * in creative.ts), so it passes through as `slides` unchanged too. photoUrl
 * is resolved separately (pickProductPhoto) — it's not something the LLM
 * writes, just something it points at via productName.
 */
export interface ColorOverride {
  colorPrimary: string;
  colorSecondary: string;
}

export type PhotoSource = "product" | "bank" | "gemini" | "gradient";

/**
 * Where each photo came from, stamped on the brief so the choice is
 * observable later (stats, the day page) and so the bank-vs-Gemini rule can
 * read the last few decisions back. Until this existed the source could
 * only be guessed from URL prefixes.
 */
export interface PhotoMeta {
  photoSource: PhotoSource;
  photoAssetId?: string | undefined;
  /** Carousels: one entry per slide, parallel to `photoUrls`. */
  photoSources?: PhotoSource[] | undefined;
  photoAssetIds?: Array<string | undefined> | undefined;
}

function stampPhotoMeta(brief: Record<string, unknown>, photoMeta: PhotoMeta | undefined): void {
  if (!photoMeta) return;
  brief.photoSource = photoMeta.photoSource;
  if (photoMeta.photoAssetId) brief.photoAssetId = photoMeta.photoAssetId;
  if (photoMeta.photoSources) brief.photoSources = photoMeta.photoSources;
  if (photoMeta.photoAssetIds?.some(Boolean)) brief.photoAssetIds = photoMeta.photoAssetIds;
}

export function buildBriefForComponentRef(
  componentRef: string,
  copy: CreativeCopy,
  photoUrl?: string,
  colorOverride?: ColorOverride,
  carouselPhotoUrls?: Array<string | undefined>,
  photoMeta?: PhotoMeta,
): Record<string, unknown> {
  if (componentRef === "story-promo") {
    const message = copy.subheadline ? `${copy.headline} — ${copy.subheadline}` : copy.headline;
    const brief: Record<string, unknown> = { message };
    if (photoUrl) brief.photoUrl = photoUrl;
    if (copy.caption) brief.caption = copy.caption;
    if (colorOverride) Object.assign(brief, colorOverride);
    stampPhotoMeta(brief, photoMeta);
    return brief;
  }

  if (componentRef === "carousel") {
    const brief: Record<string, unknown> = { slides: copy.slides ?? [] };
    // One photo per slide (each themed to that slide's own text) rather than
    // a single shared photoUrl — a slide with no photo of its own (Gemini
    // failed, no library photo left) just renders text-on-gradient, same as
    // today's fallback.
    if (carouselPhotoUrls?.some(Boolean)) brief.photoUrls = carouselPhotoUrls;
    if (colorOverride) Object.assign(brief, colorOverride);
    if (copy.caption) brief.caption = copy.caption;
    stampPhotoMeta(brief, photoMeta);
    return brief;
  }

  const brief: Record<string, unknown> = { headline: copy.headline };
  if (copy.subheadline) brief.subheadline = copy.subheadline;
  if (copy.priceLabel) brief.priceLabel = copy.priceLabel;
  if (photoUrl) brief.photoUrl = photoUrl;
  if (copy.caption) brief.caption = copy.caption;
  if (colorOverride) Object.assign(brief, colorOverride);
  // Only the reel composition (Remotion) actually reads these — social-post's
  // HTML template has no notion of "effects", so they're scoped to avoid
  // dead data on every other creative type.
  if (componentRef === "reel" && copy.videoEffects) brief.videoEffects = copy.videoEffects;
  stampPhotoMeta(brief, photoMeta);
  return brief;
}

export interface ProductPhotoLookup {
  name: string;
  photo_urls: readonly string[];
}

/**
 * The LLM already sees the full catalog when it writes the copy, so it's
 * the one deciding which product (if any) the piece is about — this just
 * resolves that name back to a real uploaded photo. Never invents a photo:
 * no match, or a match with no photos uploaded, both mean no photoUrl.
 */
export function pickProductPhoto(
  products: readonly ProductPhotoLookup[],
  productName: string | undefined,
): string | undefined {
  if (!productName) return undefined;

  const match = products.find((p) => p.name.toLowerCase() === productName.toLowerCase());
  return match?.photo_urls[0];
}

// Lowercase + strip diacritics + collapse whitespace, so "Sin Sustos",
// "SIN SUSTOS", a tenant-typed "sin sústos" and a caption that wraps the
// phrase across a line break (or a non-breaking space — local models emit
// both) all hit the same banned entry. `\s` covers NBSP and newlines.
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/gu, " ");
}

export interface BannedPhraseHit {
  phrase: string;
  field: string;
}

/**
 * Scans every string (and every string inside an array, e.g. carousel
 * slides) in a generated copy object for a tenant-banned phrase. Substring
 * match on purpose: "sinergias" must trip a ban on "sinergia". Returns the
 * first hit so the LLM retry prompt can name exactly what to remove.
 *
 * Exists because the ban already lived in the brand kit prose twice and the
 * local model used the phrase anyway on a real piece — the guard has to be
 * code, not a sentence in the prompt.
 */
export function findBannedPhrase(
  copy: Record<string, unknown>,
  bannedPhrases: readonly string[],
): BannedPhraseHit | null {
  const banned = bannedPhrases
    .map((phrase) => ({ raw: phrase, normalized: normalizeForMatch(phrase).trim() }))
    .filter((entry) => entry.normalized.length > 0);
  if (banned.length === 0) return null;

  for (const [field, value] of Object.entries(copy)) {
    const texts = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    for (const text of texts) {
      if (typeof text !== "string") continue;
      const haystack = normalizeForMatch(text);
      const hit = banned.find((entry) => haystack.includes(entry.normalized));
      if (hit) return { phrase: hit.raw, field };
    }
  }
  return null;
}

// ─── Theme-aware bank photo ranking ──────────────────────────────────────────
//
// The bank used to rotate blindly by last_used_at, so a post about "RUC 10 vs
// RUC 20" got a brainstorming-lightbulb photo purely because it was the one
// that had waited longest. Every photo now carries a description and tags
// (written once by Gemini vision, see media-tag-tick.ts) and the pick is a
// pure keyword overlap computed here — the weak local model is deliberately
// NOT on the critical path of this decision.

const STOPWORDS = new Set(
  (
    "de la el los las un una unos unas y o u a en por para con sin que como del al es son hay mas muy " +
    "este esta estos estas ese esa esos esas eso esto hoy ahora tu tus mi mis su sus nuestro nuestra " +
    "nuestros nuestras te se lo le les nos ya no si pero porque cuando donde cual cuales quien que qué " +
    "cómo cuánto cuanto cuantos cuantas todo toda todos todas cada vez ser estar tener hacer puede pueden " +
    "debe deben sobre entre hasta desde tras ante bajo contra hacia segun sino aun aunque mientras post " +
    "publicacion reel story carrusel slide dia dias semana mes"
  ).split(/\s+/),
);

// Crude stem: drop a Spanish plural, then keep six letters. Five collided in
// practice — "de forma" stemmed to the same thing as "formalización" (a
// tax-office photo ranked on a shop-tidying theme) and "Te contamos" to the
// same as "contabilidad". The plural strip is what lets six letters still
// treat "venta"/"ventas" and "cliente"/"clientes" as one word.
const STEM_LENGTH = 6;

function stemWord(word: string): string {
  const singular =
    word.length > 4 && word.endsWith("es")
      ? word.slice(0, -2)
      : word.length > 3 && word.endsWith("s")
        ? word.slice(0, -1)
        : word;
  return singular.slice(0, STEM_LENGTH);
}

/** Content words, normalized, stopwords and bare numbers dropped. Not stemmed. */
function contentWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeForMatch(text).split(/[^a-z0-9]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

export function tokenize(text: string): string[] {
  return [...new Set(contentWords(text).map(stemWord))];
}

/**
 * Query-side only: a theme that says "RUC" should also reach photos tagged
 * "sunat" or "formalizacion". Keyed by WHOLE WORDS, never stems — keying by
 * stem meant "contamos" pulled in the accounting group and "de forma" the
 * formalization one. The values get stemmed like anything else at match time.
 */
export const THEME_SYNONYMS: Record<string, readonly string[]> = {
  ruc: ["sunat", "formalizacion", "tributario", "negocio"],
  sunat: ["tributario", "impuesto", "declaracion"],
  declaracion: ["sunat", "impuesto", "tributario"],
  declarar: ["sunat", "impuesto"],
  impuesto: ["sunat", "tributario", "declaracion"],
  impuestos: ["sunat", "tributario", "declaracion"],
  tributario: ["sunat", "impuesto"],
  tributaria: ["sunat", "impuesto"],
  planilla: ["trabajador", "empleado", "equipo"],
  planillas: ["trabajador", "empleado", "equipo"],
  factura: ["venta", "cliente", "negocio"],
  facturas: ["venta", "cliente", "negocio"],
  facturar: ["venta", "cliente"],
  igv: ["impuesto", "sunat", "venta"],
  renta: ["impuesto", "sunat"],
  mype: ["empresa", "negocio", "tienda"],
  contabilidad: ["documento", "orden", "oficina"],
  contable: ["documento", "orden", "oficina"],
  ahorro: ["tranquilidad", "dinero"],
  ahorrar: ["tranquilidad", "dinero"],
  empresa: ["tienda", "taller", "negocio"],
  formalizacion: ["sunat", "ruc", "documento"],
  formalizar: ["sunat", "ruc", "documento"],
  formalizarse: ["sunat", "ruc", "documento"],
  socio: ["equipo", "reunion"],
  socios: ["equipo", "reunion"],
  credito: ["banco", "prestamo", "dinero"],
  banco: ["credito", "prestamo"],
  multa: ["sunat", "documento"],
  multas: ["sunat", "documento"],
  yape: ["celular", "venta", "cobro"],
  constitucion: ["formalizacion", "empresa", "documento"],
  constituir: ["formalizacion", "empresa", "documento"],
  cierre: ["documento", "orden"],
  fiscalizacion: ["sunat", "documento"],
  buzon: ["sunat", "notificacion"],
};

interface QueryTerm {
  stem: string;
  synonymStems: string[];
  /** Scored terms set the denominator; hint terms can only add. */
  scored: boolean;
}

function buildQueryTerms(scoredText: string, hintText: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  const seen = new Set<string>();

  const collect = (text: string, scored: boolean): void => {
    for (const word of contentWords(text)) {
      const stem = stemWord(word);
      if (seen.has(stem)) continue;
      seen.add(stem);
      const synonymStems = [...new Set((THEME_SYNONYMS[word] ?? []).map(stemWord))].filter((s) => s !== stem);
      terms.push({ stem, synonymStems, scored });
    }
  };

  collect(scoredText, true);
  collect(hintText, false);
  return terms;
}

export interface BankPhotoLookup {
  id: string;
  url: string;
  tags: readonly string[];
  description: string | null;
  has_people: boolean | null;
  orientation: string | null;
  last_used_at: string | null;
}

export interface RankedBankPhoto {
  asset: BankPhotoLookup;
  /** 0-1: share of the query's words the photo accounts for, weighted by where they matched. */
  score: number;
  matched: string[];
}

/** Scores at or above this mean "clearly about the theme"; below WEAK means "unrelated". */
export const BANK_STRONG_MATCH = 0.34;
export const BANK_WEAK_MATCH = 0.12;
export const MAX_BANK_CANDIDATES = 80;

const TAG_WEIGHT = 3;
const FILENAME_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
/**
 * A synonym hit, or a hit on a hint word, counts half of a direct one. Full
 * weight let a corner-shop photo tagged "negocio" tie a photo tagged "ruc"
 * on a RUC theme, and the last-used tiebreak then decided which went out.
 */
const LOOSE_MATCH_FACTOR = 0.5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The words of a stock filename minus the `library-{uuid}-` prefix, date stamp and extension. */
function filenameTokens(url: string): string[] {
  let name = url.split("/").pop() ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // leave as is
  }
  name = name.replace(/^library-[0-9a-f-]{36}-/i, "").replace(/\.[a-z0-9]+$/i, "");
  return tokenize(name);
}

export interface RankBankPhotosQuery {
  /**
   * What the photo is judged against — normally just the slot theme. These
   * words set the denominator, so keep them few: folding the headline in
   * here dropped a perfectly tagged photo from 0.50 to 0.12 on filler words
   * alone, and pushed the decision back onto the local model's phrasing.
   */
  texts: readonly (string | undefined)[];
  /**
   * Extra context — headline, subheadline, the copywriter's imageKeywords.
   * A match adds to the score at half weight; a miss costs nothing. This is
   * what keeps the weak local model off the critical path.
   */
  hints?: readonly (string | undefined)[] | undefined;
  now: Date;
  excludeIds?: readonly string[] | undefined;
  preferPortrait?: boolean | undefined;
}

const joinTexts = (texts: readonly (string | undefined)[] | undefined): string =>
  (texts ?? []).filter((text): text is string => Boolean(text)).join(" ");

export function rankBankPhotos(
  assets: readonly BankPhotoLookup[],
  query: RankBankPhotosQuery,
): RankedBankPhoto[] {
  const terms = buildQueryTerms(joinTexts(query.texts), joinTexts(query.hints));
  const excluded = new Set(query.excludeIds ?? []);
  const nowMs = query.now.getTime();
  // Only the scored terms (the theme) size the denominator — synonyms and
  // hints widen what can match without ever diluting.
  const maxScore = TAG_WEIGHT * terms.filter((term) => term.scored).length;

  const ranked: RankedBankPhoto[] = [];
  for (const asset of assets.slice(0, MAX_BANK_CANDIDATES)) {
    if (excluded.has(asset.id)) continue;

    const tagTokens = new Set(asset.tags.flatMap((tag) => tokenize(tag)));
    const fileTokens = new Set(filenameTokens(asset.url));
    const descriptionTokens = new Set(tokenize(asset.description ?? ""));
    const weightOf = (word: string) =>
      tagTokens.has(word) ? TAG_WEIGHT : fileTokens.has(word) ? FILENAME_WEIGHT : descriptionTokens.has(word) ? DESCRIPTION_WEIGHT : 0;

    let sum = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const directWeight = weightOf(term.stem);
      let weight = directWeight;
      let via = term.stem;
      if (directWeight === 0) {
        for (const synonym of term.synonymStems) {
          const synonymWeight = weightOf(synonym) * LOOSE_MATCH_FACTOR;
          if (synonymWeight > weight) {
            weight = synonymWeight;
            via = `${term.stem}→${synonym}`;
          }
        }
      }
      if (weight === 0) continue;
      // A hint is advisory context, not what the photo is judged on.
      if (!term.scored) weight *= LOOSE_MATCH_FACTOR;
      sum += weight;
      matched.push(term.scored && via === term.stem ? via : `~${via}`);
    }

    // Hints and synonyms can push the numerator past the denominator; the
    // score stays a 0-1 "how well does this photo fit" for the thresholds.
    let score = maxScore > 0 ? Math.min(1, sum / maxScore) : 0;
    if (asset.last_used_at) {
      const ageDays = (nowMs - Date.parse(asset.last_used_at)) / DAY_MS;
      if (ageDays <= 3) score *= 0.2;
      else if (ageDays <= 14) score *= 0.5;
    }
    if (query.preferPortrait !== undefined) {
      if (asset.orientation === "portrait") score *= query.preferPortrait ? 1.15 : 0.85;
      else if (asset.orientation === "landscape") score *= query.preferPortrait ? 0.85 : 1;
    }

    ranked.push({ asset, score, matched });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aUsed = a.asset.last_used_at ? Date.parse(a.asset.last_used_at) : -Infinity;
    const bUsed = b.asset.last_used_at ? Date.parse(b.asset.last_used_at) : -Infinity;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return a.asset.id < b.asset.id ? -1 : a.asset.id > b.asset.id ? 1 : 0;
  });
  return ranked;
}

export interface PhotoSourceDecisionInput {
  /** null = the bank is empty. */
  bestBankScore: number | null;
  geminiAvailable: boolean;
  /** Newest first. */
  recentSources: readonly PhotoSource[];
  /** tenants.gemini_share; null = legacy behaviour (bank whenever it has anything). */
  geminiShare: number | null;
}

/**
 * Bank or Gemini for a regular post. Deterministic on purpose — a streak
 * guard keeps three bank photos or two generated images from running back
 * to back, and the tenant's share settles everything in between. A weak
 * match never wins by itself: an unrelated person photo is exactly the
 * complaint this replaces.
 */
export function decidePhotoSource(input: PhotoSourceDecisionInput): "bank" | "gemini" | "gradient" {
  if (input.bestBankScore === null) return input.geminiAvailable ? "gemini" : "gradient";
  // Legacy first: a tenant with no share configured keeps pure rotation,
  // relevant photo or not — exactly what it had before this policy existed.
  if (input.geminiShare === null || input.geminiShare === 0) return "bank";
  // Share configured but Gemini is out (no key, or the daily budget spent):
  // still never publish an unrelated photo — that is the whole complaint
  // this replaces. The gradient is the honest fallback.
  if (!input.geminiAvailable) return input.bestBankScore >= BANK_WEAK_MATCH ? "bank" : "gradient";

  const recent = input.recentSources.filter((s) => s === "bank" || s === "gemini");
  const lastN = (n: number) => recent.slice(0, n);
  const allBankStreak = lastN(3).length === 3 && lastN(3).every((s) => s === "bank");
  const geminiStreak = lastN(2).length === 2 && lastN(2).every((s) => s === "gemini");

  if (input.bestBankScore >= BANK_STRONG_MATCH && !allBankStreak) return "bank";
  if (input.bestBankScore < BANK_WEAK_MATCH) return "gemini";
  if (geminiStreak) return "bank";
  if (allBankStreak) return "gemini";

  const geminiPct = recent.length > 0 ? (recent.filter((s) => s === "gemini").length / recent.length) * 100 : 0;
  return geminiPct < input.geminiShare ? "gemini" : "bank";
}
