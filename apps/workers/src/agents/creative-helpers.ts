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

/** Crude stem: lowercase, no diacritics, first 5 letters — "formalización"/"formalizar" agree. */
const STEM_LENGTH = 5;

export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of normalizeForMatch(text).split(/[^a-z0-9]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    const stem = raw.slice(0, STEM_LENGTH);
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
  }
  return out;
}

/**
 * Query-side only: a theme that says "RUC" should also reach photos tagged
 * "sunat" or "formalizacion". Keys and values are stems (see tokenize).
 */
export const THEME_SYNONYMS: Record<string, readonly string[]> = {
  ruc: ["sunat", "forma", "tribu", "negoc"],
  sunat: ["tribu", "impue", "decla"],
  decla: ["sunat", "impue", "tribu"],
  impue: ["sunat", "tribu", "decla"],
  tribu: ["sunat", "impue"],
  plani: ["traba", "emple", "equip"],
  factu: ["venta", "clien", "negoc"],
  igv: ["impue", "sunat", "venta"],
  renta: ["impue", "sunat"],
  mype: ["empre", "negoc", "tiend"],
  conta: ["docum", "orden", "ofici"],
  ahorr: ["tranq", "diner"],
  empre: ["tiend", "talle", "negoc", "empre"],
  forma: ["sunat", "ruc", "docum"],
  socio: ["equip", "reuni"],
  credi: ["banco", "prest", "diner"],
  banco: ["credi", "prest"],
  multa: ["sunat", "docum"],
  yape: ["celul", "venta", "cobro"],
  const: ["forma", "empre", "docum"],
  cierr: ["docum", "orden"],
  fisca: ["sunat", "docum"],
  buzon: ["sunat", "notif"],
};

/** A query token plus its synonyms — matching ANY of them counts as matching the token. */
function tokenGroup(token: string): string[] {
  return [token, ...(THEME_SYNONYMS[token] ?? [])];
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
  texts: readonly (string | undefined)[];
  now: Date;
  excludeIds?: readonly string[] | undefined;
  preferPortrait?: boolean | undefined;
}

export function rankBankPhotos(
  assets: readonly BankPhotoLookup[],
  query: RankBankPhotosQuery,
): RankedBankPhoto[] {
  const queryTokens = tokenize(query.texts.filter((t): t is string => Boolean(t)).join(" "));
  const excluded = new Set(query.excludeIds ?? []);
  const nowMs = query.now.getTime();
  // Synonyms widen what a token can match but never inflate the denominator:
  // a one-word theme that hits its photo squarely scores 1.0, not 1/(1+n).
  const maxScore = TAG_WEIGHT * queryTokens.length;

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
    for (const token of queryTokens) {
      let bestWeight = 0;
      let bestWord = token;
      for (const word of tokenGroup(token)) {
        const weight = weightOf(word);
        if (weight > bestWeight) {
          bestWeight = weight;
          bestWord = word;
        }
      }
      if (bestWeight === 0) continue;
      sum += bestWeight;
      // "ruc→sunat" in the decision log says which synonym did the work.
      matched.push(bestWord === token ? token : `${token}→${bestWord}`);
    }

    let score = maxScore > 0 ? sum / maxScore : 0;
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
  if (!input.geminiAvailable) return "bank";
  if (input.geminiShare === null || input.geminiShare === 0) return "bank";

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
