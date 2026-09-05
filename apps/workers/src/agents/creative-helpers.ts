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

export function buildBriefForComponentRef(
  componentRef: string,
  copy: CreativeCopy,
  photoUrl?: string,
  colorOverride?: ColorOverride,
  carouselPhotoUrls?: Array<string | undefined>,
): Record<string, unknown> {
  if (componentRef === "story-promo") {
    const message = copy.subheadline ? `${copy.headline} — ${copy.subheadline}` : copy.headline;
    const brief: Record<string, unknown> = { message };
    if (photoUrl) brief.photoUrl = photoUrl;
    if (copy.caption) brief.caption = copy.caption;
    if (colorOverride) Object.assign(brief, colorOverride);
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

// Lowercase + strip diacritics, so "Sin Sustos", "SIN SUSTOS" and a
// tenant-typed "sin sústos" all hit the same banned entry.
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
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
