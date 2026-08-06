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

export interface CreativeCopy {
  headline?: string | undefined;
  subheadline?: string | undefined;
  priceLabel?: string | undefined;
  productName?: string | undefined;
  slides?: string[] | undefined;
  caption?: string | undefined;
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
    return brief;
  }

  const brief: Record<string, unknown> = { headline: copy.headline };
  if (copy.subheadline) brief.subheadline = copy.subheadline;
  if (copy.priceLabel) brief.priceLabel = copy.priceLabel;
  if (photoUrl) brief.photoUrl = photoUrl;
  if (copy.caption) brief.caption = copy.caption;
  if (colorOverride) Object.assign(brief, colorOverride);
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
