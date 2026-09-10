// Article agent: turns the morning's social piece into a real article on the
// tenant's own website.
//
// A post and an article are the same idea at two depths. The post is the
// hook and it dies in the feed within a day; the article is what Google
// indexes and what still brings people in months later. Until now Pulso only
// produced the first one, so every theme it wrote was thrown away.
//
// Runs off `creative.generated` rather than a tick of its own, so the article
// is written from the same theme the post was, in the same breath. It is
// deliberately incapable of breaking the post: everything here is caught, and
// a failure leaves the social piece exactly as it was.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { executeAgentRun } from "@pulso/publish/base-agent";
import type { Json } from "@pulso/db/types";
import { generateArticle } from "@pulso/shared/article-gen";
import { extractShell, EMPTY_SHELL, type SiteShell } from "@pulso/shared/article-html";
import { limaToday } from "@pulso/shared/time";
import { findBannedPhrase, findEmDash } from "./creative-helpers.js";
import { writeArticleFiles, writeMdxArticleFile, deployArticles } from "../site-publish.js";

/** Only the morning evergreen slot becomes an article. See the skip below. */
const ARTICLE_SLOT_INDEX = 0;

interface CreativeBrief {
  photoUrl?: string;
  headline?: string;
  [key: string]: unknown;
}

/**
 * The same two copy rules the social pieces are held to, applied to the
 * article. Gemini is asked for them in the prompt, but "asked for" has never
 * been good enough here: the check is what decides.
 */
export function findCopyViolation(
  fields: Record<string, string>,
  bannedPhrases: readonly string[],
): string | null {
  const banned = findBannedPhrase(fields, bannedPhrases);
  if (banned) return `frase prohibida "${banned.phrase}" en ${banned.field}`;
  const emDash = findEmDash(fields);
  if (emDash) return `raya (—) en ${emDash.field}`;
  return null;
}

async function loadShell(repoPath: string, shellPage: string | null): Promise<SiteShell> {
  if (!shellPage) return EMPTY_SHELL;
  try {
    return extractShell(await readFile(path.join(repoPath, shellPage), "utf8"));
  } catch {
    // A missing or moved shell page is not worth losing the article over:
    // the page still renders, just without the site's header and footer.
    return EMPTY_SHELL;
  }
}

export async function runArticleAgentForCreative(
  tenantId: string,
  creativeId: string,
  correlationId: string,
): Promise<void> {
  await executeAgentRun(
    { agent: "article", tenantId, trigger: "creative.generated", correlationId },
    async (ctx) => {
      const site = await ctx.db.getSiteTarget();
      // Most tenants have no website wired up. Not a skip worth logging:
      // it would put a decision_log row under every creative of every tenant.
      if (!site || !site.enabled) return;

      const skip = async (rationale: string, observed: Json) => {
        await ctx.db.insertDecisionLog({
          agent: "article",
          observed,
          decision: { action: "skip" },
          rationale,
          correlation_id: correlationId,
        });
      };

      const creative = await ctx.db.getCreativeById(creativeId);
      if (!creative?.calendar_slot_id) {
        await skip("El creative ya no existe o no tiene slot.", { creative_id: creativeId });
        return;
      }

      const slot = await ctx.db.getContentCalendarSlotById(creative.calendar_slot_id);
      if (!slot) {
        await skip("El slot del calendario ya no existe.", { creative_id: creativeId });
        return;
      }

      // The afternoon slot is news: it quotes someone else's story, it ages
      // badly as a permanent page, and it is exactly the kind of thin
      // rewritten-headline page search engines punish a site for. The
      // morning slot is evergreen, which is what a blog wants.
      if (slot.slot_index !== ARTICLE_SLOT_INDEX || slot.slot_type === "news") {
        await skip("Solo la pieza evergreen de la mañana se convierte en artículo.", {
          calendar_slot_id: slot.id,
          slot_index: slot.slot_index,
          slot_type: slot.slot_type,
        });
        return;
      }

      const existing = await ctx.db.getArticleByCalendarSlotId(slot.id);
      if (existing) {
        await skip("Este slot ya tiene un artículo.", {
          calendar_slot_id: slot.id,
          article_id: existing.id,
        });
        return;
      }

      const tenant = await ctx.db.getTenant();
      const brandKit = await ctx.db.getBrandKit();
      const bannedPhrases = brandKit?.banned_phrases ?? [];
      const brief = (creative.brief ?? {}) as CreativeBrief;

      // Two attempts, same reason the copy agent has them: the guard below
      // rejects work the model was already told not to produce, and a second
      // roll usually lands. Beyond that, leaving the article unwritten is
      // better than shipping banned copy to a client's own website.
      let generated: Awaited<ReturnType<typeof generateArticle>> | undefined;
      let violation: string | null = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        generated = await generateArticle({
          businessName: tenant.name,
          rubro: tenant.rubro ?? "negocio local",
          theme: slot.theme,
          headline: brief.headline,
          brandVoice: [brandKit?.tone_description, brandKit?.voice_training]
            .filter((part): part is string => Boolean(part?.trim()))
            .join("\n\n"),
          bannedPhrases,
          // No city column anywhere yet. Left out rather than guessed: a
          // wrong district in a local-business article is worse than none.
          websiteUrl: brandKit?.website_url ?? undefined,
        });

        if (!generated.ok) {
          if (!generated.retryable) break;
          continue;
        }

        violation = findCopyViolation(
          {
            title: generated.value.title,
            metaDescription: generated.value.metaDescription,
            bodyHtml: generated.value.bodyHtml,
          },
          bannedPhrases,
        );
        if (!violation) break;
      }

      if (!generated?.ok) {
        await skip(`No se pudo redactar el artículo: ${generated?.error ?? "sin respuesta"}.`, {
          calendar_slot_id: slot.id,
          theme: slot.theme,
        });
        return;
      }
      if (violation) {
        await skip(`El artículo generado no pasó las reglas de copy (${violation}).`, {
          calendar_slot_id: slot.id,
          theme: slot.theme,
        });
        return;
      }

      const article = generated.value;
      // blog_dir is where the FILE goes (relative to repo_path); the public
      // URL path is usually the same folder (Aura's static site serves it
      // directly) but not always — AZ's files sit in content/blog while its
      // own Next.js route serves them at /blog. public_path overrides for
      // exactly that case; null means "same as blog_dir", today's behavior.
      const blogPath = `/${(site.public_path ?? site.blog_dir).replace(/^\/+|\/+$/g, "")}`;
      const baseUrl = site.base_url.replace(/\/$/, "");

      const row = await ctx.db.insertArticle({
        calendar_slot_id: slot.id,
        slug: article.slug,
        title: article.title,
        meta_description: article.metaDescription,
        body_html: article.bodyHtml,
        // The same photo the post uses, so the two read as one campaign.
        hero_image_url: brief.photoUrl ?? null,
        word_count: article.wordCount,
        status: "ready",
        url: `${baseUrl}${blogPath}/${article.slug}`,
      });

      // Written to disk either way. auto_publish only decides whether anyone
      // has to look at it before it goes live, and the file on disk is what
      // a person would be looking at.
      const publishedAt = new Date().toISOString();
      const written =
        site.format === "mdx"
          ? await writeMdxArticleFile({ site, article: { ...article, publishedAt } })
          : await writeArticleFiles({
              site,
              businessName: tenant.name,
              shell: await loadShell(site.repo_path, site.shell_page),
              article: { ...article, heroImageUrl: brief.photoUrl, publishedAt },
              // The index is rewritten whole from the database, so it can
              // never drift from the pages that actually exist.
              indexEntries: [
                {
                  slug: article.slug,
                  title: article.title,
                  metaDescription: article.metaDescription,
                  publishedAt,
                  heroImageUrl: brief.photoUrl,
                },
                ...(await ctx.db.listPublishedArticles()).map((a) => ({
                  slug: a.slug,
                  title: a.title,
                  metaDescription: a.meta_description ?? "",
                  publishedAt: a.published_at ?? undefined,
                  heroImageUrl: a.hero_image_url ?? undefined,
                })),
              ],
            });

      let deployed = false;
      if (site.auto_publish) {
        const result = await deployArticles(site, `blog: ${article.title}`, written.files);
        deployed = result.ok;
        if (!result.ok) {
          await ctx.db.insertDecisionLog({
            agent: "article",
            observed: { article_id: row.id, repo_path: site.repo_path },
            decision: { action: "deploy_failed" },
            rationale: result.error,
            correlation_id: correlationId,
          });
        }
      }

      if (deployed) {
        await ctx.db.updateArticle(row.id, { status: "published", published_at: publishedAt });
      }

      await ctx.db.insertDecisionLog({
        agent: "article",
        observed: { calendar_slot_id: slot.id, theme: slot.theme, date: limaToday() },
        decision: {
          article_id: row.id,
          slug: article.slug,
          word_count: article.wordCount,
          files: written.files,
          deployed,
        },
        rationale: deployed
          ? `Artículo publicado en ${row.url}.`
          : `Artículo escrito en disco; falta desplegar${site.auto_publish ? " (el despliegue falló)" : " (auto_publish apagado)"}.`,
        correlation_id: correlationId,
      });
    },
  );
}
