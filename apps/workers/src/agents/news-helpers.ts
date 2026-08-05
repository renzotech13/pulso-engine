/**
 * Pure functions used by the News agent — kept separate from news.ts (which
 * needs the DB/LLM/RSS fetch) so prompt formatting and the LLM response
 * mapping can be unit tested without a network call or a running LM Studio
 * server.
 */

export interface NewsHeadline {
  title: string;
  link: string;
  source: string;
  summary: string;
  publishedAt: string | null;
}

/**
 * Numbered so the LLM can reference a headline by index instead of having
 * to echo back the (long, easy-to-mangle) URL — mapRelevantPicks then
 * resolves those indices back to the real headline objects.
 */
export function formatHeadlinesForPrompt(headlines: readonly NewsHeadline[]): string {
  if (headlines.length === 0) return "(sin titulares hoy)";
  return headlines
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.summary ? ` — ${h.summary}` : ""}`)
    .join("\n");
}

export interface RelevantPick {
  index: number;
  angle: string;
}

export interface NewsSuggestionDraft {
  headline: string;
  sourceUrl: string;
  sourceName: string;
  summary: string | null;
  angle: string;
  publishedAt: string | null;
}

/**
 * Resolves the LLM's 1-based indices back to real headlines, silently
 * dropping anything out of range instead of throwing — a hallucinated
 * index shouldn't fail the whole run, just contribute one fewer suggestion.
 */
export function mapRelevantPicks(
  headlines: readonly NewsHeadline[],
  picks: readonly RelevantPick[],
): NewsSuggestionDraft[] {
  const drafts: NewsSuggestionDraft[] = [];
  for (const pick of picks) {
    const headline = headlines[pick.index - 1];
    if (!headline) continue;
    drafts.push({
      headline: headline.title,
      sourceUrl: headline.link,
      sourceName: headline.source,
      summary: headline.summary || null,
      angle: pick.angle,
      publishedAt: headline.publishedAt,
    });
  }
  return drafts;
}

/**
 * Feed items arrive with duplicates across sources fairly often (the same
 * wire story picked up by multiple outlets, or the same feed queried twice
 * in one run) — de-duped by link, keeping the first occurrence, before
 * anything gets shown to the LLM (fewer, cleaner headlines to reason about).
 */
export function dedupeHeadlines(headlines: readonly NewsHeadline[]): NewsHeadline[] {
  const seen = new Set<string>();
  const result: NewsHeadline[] = [];
  for (const h of headlines) {
    if (seen.has(h.link)) continue;
    seen.add(h.link);
    result.push(h);
  }
  return result;
}
