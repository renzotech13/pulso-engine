/**
 * Pure functions used by the Publish agent — kept separate from publish.ts
 * (which needs the DB/Graph API) so caption composition can be unit tested
 * without a database or network access.
 */

/**
 * social-post/reel briefs have headline/subheadline/priceLabel;
 * story-promo has a single message field instead; carousel has a `slides`
 * array instead of any of those; photo-frame has a plain `caption` the
 * tenant typed by hand (no LLM copy at all). Either way, produce one caption
 * string for the post — no template-specific branching needed here beyond
 * picking whichever fields are actually present.
 */
export function buildCaption(brief: Record<string, unknown>): string {
  const headline = typeof brief.headline === "string" ? brief.headline : undefined;
  const subheadline = typeof brief.subheadline === "string" ? brief.subheadline : undefined;
  const priceLabel = typeof brief.priceLabel === "string" ? brief.priceLabel : undefined;
  const message = typeof brief.message === "string" ? brief.message : undefined;
  const caption = typeof brief.caption === "string" ? brief.caption : undefined;
  const slides = Array.isArray(brief.slides) ? brief.slides.filter((s): s is string => typeof s === "string") : undefined;

  if (message) {
    return priceLabel ? `${message}\n\n${priceLabel}` : message;
  }

  if (caption) {
    return caption;
  }

  if (slides && slides.length > 0) {
    return slides.join("\n\n");
  }

  return [headline, subheadline, priceLabel].filter((part): part is string => Boolean(part)).join("\n\n");
}
