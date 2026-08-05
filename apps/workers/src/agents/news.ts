import Parser from "rss-parser";
import { z } from "zod";
import { createServiceRoleClient, getActivePrompt } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";
import { callAgentLlm } from "../agent-llm.js";
import { executeAgentRun } from "./base-agent.js";
import { dedupeHeadlines, formatHeadlinesForPrompt, mapRelevantPicks, type NewsHeadline } from "./news-helpers.js";

const logger = createLogger({ agent: "news-tick" });

// Free, no-key-required RSS — Google News search feeds are the most
// reliable of the three (stable, documented URL format independent of any
// one outlet's own feed structure); Gestión's is a real Arc Publishing feed
// but more likely to break if they restructure. Either failing just yields
// fewer headlines for that run (see the try/catch in fetchTodaysHeadlines),
// never blocks the others.
const NEWS_FEEDS: Array<{ name: string; url: string }> = [
  {
    name: "Google News Perú — Economía",
    url: "https://news.google.com/rss/search?q=economia%20Peru&hl=es-419&gl=PE&ceid=PE:es-419",
  },
  {
    name: "Google News Perú — Negocios",
    url: "https://news.google.com/rss/search?q=negocios%20Peru&hl=es-419&gl=PE&ceid=PE:es-419",
  },
  {
    name: "Gestión — Economía",
    url: "https://gestion.pe/arc/outboundfeeds/rss/category/economia/?outputType=xml",
  },
];

const MAX_ITEMS_PER_FEED = 12;
// One fetch shared across every tenant in a tick (headlines don't vary by
// tenant, only the relevance judgment does) instead of one per tenant.
const CACHE_MS = 60 * 60 * 1000;

const relevanceSchema = z.object({
  relevant: z.array(
    z.object({
      index: z.number().int().min(1),
      angle: z.string().min(1),
    }),
  ),
});

let cachedHeadlines: { items: NewsHeadline[]; fetchedAt: number } | undefined;

async function fetchTodaysHeadlines(): Promise<NewsHeadline[]> {
  if (cachedHeadlines && Date.now() - cachedHeadlines.fetchedAt < CACHE_MS) {
    return cachedHeadlines.items;
  }

  const parser = new Parser();
  const items: NewsHeadline[] = [];

  for (const feed of NEWS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const entry of (parsed.items ?? []).slice(0, MAX_ITEMS_PER_FEED)) {
        if (!entry.title || !entry.link) continue;
        items.push({
          title: entry.title,
          link: entry.link,
          source: feed.name,
          summary: entry.contentSnippet ?? "",
          publishedAt: entry.isoDate ?? null,
        });
      }
    } catch (err) {
      logger.warn({ err, feed: feed.name }, "failed to fetch news feed, skipping");
    }
  }

  const deduped = dedupeHeadlines(items);
  cachedHeadlines = { items: deduped, fetchedAt: Date.now() };
  return deduped;
}

function renderPrompt(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

/**
 * Fetches today's headlines (shared across tenants via the module-level
 * cache above), asks the local LLM which ones this tenant's rubro can
 * actually use, and writes each pick as a `news_suggestions` row — always
 * 'pending', regardless of hitl_mode. Unlike calendar slots, a news-driven
 * idea never auto-schedules; a human reviews the list at /news and decides
 * whether (and for which day) to turn one into a real calendar entry.
 */
export async function runNewsAgentForTenant(
  tenantId: string,
  correlationId: string,
  jobId?: string,
): Promise<void> {
  await executeAgentRun(
    { agent: "news", tenantId, trigger: "news.digest.requested", correlationId },
    async (ctx) => {
      const headlines = await fetchTodaysHeadlines();
      if (headlines.length === 0) {
        await ctx.db.insertDecisionLog({
          agent: "news",
          observed: { headline_count: 0 },
          decision: { action: "skip" },
          rationale: "No se pudo obtener ningún titular de los feeds configurados hoy.",
          correlation_id: correlationId,
        });
        return;
      }

      const tenant = await ctx.db.getTenant();
      const service = createServiceRoleClient();
      const promptTemplate = await getActivePrompt(service, "news.relevance");

      const prompt = renderPrompt(promptTemplate, {
        RUBRO: tenant.rubro ?? "general",
        HEADLINES: formatHeadlinesForPrompt(headlines),
      });

      const result = await callAgentLlm({
        agentName: "news",
        tenantId,
        ...(jobId ? { jobId } : {}),
        correlationId,
        prompt,
        schema: relevanceSchema,
      });

      const drafts = mapRelevantPicks(headlines, result.relevant);
      let insertedCount = 0;

      for (const draft of drafts) {
        // Unique (tenant_id, source_url) — a rerun of the same day (or a
        // headline still in the shared cache from an earlier tick) just
        // no-ops instead of duplicating the suggestion.
        const { error } = await service
          .from("news_suggestions")
          .upsert(
            {
              tenant_id: tenantId,
              headline: draft.headline,
              source_url: draft.sourceUrl,
              source_name: draft.sourceName,
              summary: draft.summary,
              angle: draft.angle,
              published_at: draft.publishedAt,
            },
            { onConflict: "tenant_id,source_url", ignoreDuplicates: true },
          )
          .select("id");

        if (error) {
          ctx.logger.warn({ err: error, sourceUrl: draft.sourceUrl }, "failed to insert news_suggestion");
        } else {
          insertedCount++;
        }
      }

      await ctx.db.insertDecisionLog({
        agent: "news",
        observed: { headline_count: headlines.length, rubro: tenant.rubro },
        decision: { suggested_count: insertedCount },
        rationale: `El LLM evaluó ${headlines.length} titulares y encontró ${result.relevant.length} relevantes para este rubro.`,
        correlation_id: correlationId,
      });

      await publishEvent(service, {
        tenantId,
        type: "news.suggestions.generated",
        payload: { count: insertedCount },
        correlationId,
      });
    },
  );
}

/**
 * Daily fan-out (mirrors planner.ts's runPlannerTick): emits
 * `news.digest.requested` for every active tenant so each run traces back
 * to an outbox event, same as the rest of the agent system.
 */
export async function runNewsTick(): Promise<void> {
  const service = createServiceRoleClient();
  const { data: tenants, error } = await service.from("tenants").select("id").eq("status", "active");

  if (error) {
    logger.error({ err: error }, "failed to list active tenants for news tick");
    return;
  }

  for (const tenant of tenants ?? []) {
    await publishEvent(service, {
      tenantId: tenant.id,
      type: "news.digest.requested",
      payload: {},
      correlationId: newCorrelationId(),
    });
  }

  logger.info({ tenantCount: tenants?.length ?? 0 }, "news tick complete");
}
